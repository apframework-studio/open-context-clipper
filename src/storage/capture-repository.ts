import type { CaptureRecord, DeliveryStatus, ExtractedCapture, SaveOutcome } from "../shared/models";

const DATABASE_NAME = "ocf-clipper";
const DATABASE_VERSION = 1;
const CAPTURES_STORE = "captures";

type StatusCounts = Record<DeliveryStatus, number>;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const store = database.objectStoreNames.contains(CAPTURES_STORE)
        ? request.transaction!.objectStore(CAPTURES_STORE)
        : database.createObjectStore(CAPTURES_STORE, { keyPath: "id" });

      if (!store.indexNames.contains("status")) {
        store.createIndex("status", "delivery.status");
      }
      if (!store.indexNames.contains("canonicalUrl")) {
        store.createIndex("canonicalUrl", "source.canonicalUrl");
      }
      if (!store.indexNames.contains("contentHash")) {
        store.createIndex("contentHash", "capture.contentHash");
      }
      if (!store.indexNames.contains("capturedAt")) {
        store.createIndex("capturedAt", "capture.capturedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function recordFrom(
  extracted: ExtractedCapture,
  note: string,
  delivery: CaptureRecord["delivery"],
  links: Pick<CaptureRecord, "supersedes" | "duplicateOf"> = {}
): CaptureRecord {
  return {
    ...extracted,
    schemaVersion: 1,
    id: crypto.randomUUID(),
    user: { note },
    delivery,
    ...links,
  };
}

function replacementFrom(existing: CaptureRecord, extracted: ExtractedCapture, note: string): CaptureRecord {
  return {
    ...extracted,
    schemaVersion: 1,
    id: existing.id,
    user: { note },
    delivery: { status: "queued", attempts: 0 },
    ...(existing.supersedes ? { supersedes: existing.supersedes } : {}),
    ...(existing.duplicateOf ? { duplicateOf: existing.duplicateOf } : {}),
  };
}

function latest(records: CaptureRecord[]): CaptureRecord {
  return [...records].sort((left, right) =>
    right.capture.capturedAt.localeCompare(left.capture.capturedAt) || right.id.localeCompare(left.id)
  )[0]!;
}

function firstOriginal(records: CaptureRecord[]): CaptureRecord {
  const original = records.find((record) => record.duplicateOf === undefined);
  if (original) return original;

  return [...records].sort((left, right) =>
    left.capture.capturedAt.localeCompare(right.capture.capturedAt) ||
    left.source.canonicalUrl.localeCompare(right.source.canonicalUrl) ||
    left.source.originalUrl.localeCompare(right.source.originalUrl)
  )[0]!;
}

export class CaptureRepository {
  private async withStore<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => Promise<T>
  ): Promise<T> {
    const database = await openDatabase();
    const transaction = database.transaction(CAPTURES_STORE, mode);
    try {
      const result = await operation(transaction.objectStore(CAPTURES_STORE));
      await transactionDone(transaction);
      return result;
    } finally {
      database.close();
    }
  }

  async saveConfirmed(extracted: ExtractedCapture, note: string): Promise<SaveOutcome> {
    return this.withStore("readwrite", async (store) => {
      const sameUrl = await requestResult<CaptureRecord[]>(
        store.index("canonicalUrl").getAll(extracted.source.canonicalUrl)
      );
      const exact = sameUrl.find((record) => record.capture.contentHash === extracted.capture.contentHash);
      if (exact) {
        return { kind: "unchanged-duplicate", record: exact };
      }

      if (sameUrl.length > 0) {
        const previous = latest(sameUrl);
        if (previous.delivery.status !== "synced") {
          const updated = replacementFrom(previous, extracted, note);
          await requestResult(store.put(updated));
          return { kind: "updated-unsynced", record: updated };
        }

        const version = recordFrom(extracted, note, { status: "queued", attempts: 0 }, { supersedes: previous.id });
        await requestResult(store.add(version));
        return { kind: "new-version", record: version };
      }

      const sameHash = await requestResult<CaptureRecord[]>(
        store.index("contentHash").getAll(extracted.capture.contentHash)
      );
      if (sameHash.length > 0) {
        const candidate = recordFrom(extracted, note, { status: "duplicate", attempts: 0 }, { duplicateOf: firstOriginal(sameHash).id });
        await requestResult(store.add(candidate));
        return { kind: "duplicate-candidate", record: candidate };
      }

      const record = recordFrom(extracted, note, { status: "queued", attempts: 0 });
      await requestResult(store.add(record));
      return { kind: "saved", record };
    });
  }

  async list(): Promise<CaptureRecord[]> {
    return this.withStore("readonly", (store) => requestResult<CaptureRecord[]>(store.index("capturedAt").getAll()));
  }

  async get(id: string): Promise<CaptureRecord | undefined> {
    return this.withStore("readonly", (store) => requestResult<CaptureRecord | undefined>(store.get(id)));
  }

  async updateNote(id: string, note: string): Promise<CaptureRecord | undefined> {
    return this.withStore("readwrite", async (store) => {
      const record = await requestResult<CaptureRecord | undefined>(store.get(id));
      if (!record) return undefined;
      const updated = { ...record, user: { note } };
      await requestResult(store.put(updated));
      return updated;
    });
  }

  async delete(id: string): Promise<void> {
    await this.withStore("readwrite", async (store) => {
      await requestResult(store.delete(id));
    });
  }

  async promoteDuplicate(id: string): Promise<CaptureRecord | undefined> {
    return this.withStore("readwrite", async (store) => {
      const record = await requestResult<CaptureRecord | undefined>(store.get(id));
      if (!record) return undefined;
      const promoted = {
        ...record,
        delivery: { ...record.delivery, status: "queued" as const },
      };
      await requestResult(store.put(promoted));
      return promoted;
    });
  }

  async countByStatus(): Promise<StatusCounts> {
    return this.withStore("readonly", async (store) => {
      const records = await requestResult<CaptureRecord[]>(store.getAll());
      return records.reduce<StatusCounts>(
        (counts, record) => {
          counts[record.delivery.status] += 1;
          return counts;
        },
        { queued: 0, duplicate: 0, syncing: 0, synced: 0, failed: 0 }
      );
    });
  }
}
