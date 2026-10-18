import { describe, expect, it } from "vitest";
import { createBackgroundController, type CaptureRepositoryPort } from "../../src/background/service-worker";
import type { CaptureRecord, ExtractedCapture, SaveOutcome } from "../../src/shared/models";
import { createFakeChromePort } from "../helpers/chrome";

const extracted: ExtractedCapture = {
  source: {
    originalUrl: "https://example.com/article",
    canonicalUrl: "https://example.com/article",
    title: "Captured article",
  },
  content: { markdown: "# Captured article", wordCount: 2, imageUrls: [] },
  capture: {
    capturedAt: "2026-09-19T00:00:00.000Z",
    extractor: "readability",
    contentHash: "hash-a",
    warnings: [],
  },
};

const record: CaptureRecord = {
  ...extracted,
  schemaVersion: 1,
  id: "capture-1",
  user: { note: "original note" },
  delivery: { status: "queued", attempts: 0 },
};

function createRepository(records: CaptureRecord[] = [record]): CaptureRepositoryPort & { calls: string[]; failure?: Error } {
  let currentRecords = records;
  const repository: CaptureRepositoryPort & { calls: string[]; failure?: Error } = {
    calls: [],
    async saveConfirmed(capture, note) {
      repository.calls.push(`saveConfirmed:${capture.capture.contentHash}:${note}`);
      if (repository.failure) throw repository.failure;
      return { kind: "saved", record: { ...record, ...capture, user: { note } } } as SaveOutcome;
    },
    async list() {
      repository.calls.push("list");
      if (repository.failure) throw repository.failure;
      return currentRecords;
    },
    async updateNote(id, note) {
      repository.calls.push(`updateNote:${id}:${note}`);
      if (repository.failure) throw repository.failure;
      return id === record.id ? { ...record, user: { note } } : undefined;
    },
    async delete(id) {
      repository.calls.push(`delete:${id}`);
      if (repository.failure) throw repository.failure;
    },
    async promoteDuplicate(id) {
      repository.calls.push(`promoteDuplicate:${id}`);
      if (repository.failure) throw repository.failure;
      return id === record.id ? { ...record, delivery: { status: "queued", attempts: 0 } } : undefined;
    },
    async markCompleted(ids, completedAt) {
      repository.calls.push(`markCompleted:${ids.join(",")}`);
      if (repository.failure) throw repository.failure;
      currentRecords = currentRecords.map((candidate) => ids.includes(candidate.id)
        ? { ...candidate, completedAt: candidate.completedAt ?? completedAt }
        : candidate);
    },
    async countByStatus() {
      repository.calls.push("countByStatus");
      if (repository.failure) throw repository.failure;
      return { queued: 3, duplicate: 1, syncing: 0, synced: 0, failed: 0 };
    },
  };
  return repository;
}

describe("background message controller", () => {
  it("rejects empty extraction responses before showing a successful capture", async () => {
    const empty = { ...extracted, content: { ...extracted.content, markdown: " \n " } };
    const repository = createRepository();
    const controller = createBackgroundController({ chromePort: createFakeChromePort(empty), repository });

    await expect(controller.handle({ type: "EXTRACT_ACTIVE_TAB" })).resolves.toMatchObject({ ok: false });
    expect(repository.calls).toEqual([]);
  });

  it("does not persist a confirmed capture with an empty Markdown body", async () => {
    const repository = createRepository();
    const controller = createBackgroundController({ chromePort: createFakeChromePort(extracted), repository });
    const empty = { ...extracted, content: { ...extracted.content, markdown: " \n " } };

    await expect(controller.handle({ type: "SAVE_CAPTURE", extracted: empty })).resolves.toMatchObject({ ok: false });
    expect(repository.calls).toEqual([]);
  });

  it("extracts the active tab only after injecting content.js", async () => {
    const chromePort = createFakeChromePort(extracted);
    const repository = createRepository();
    const controller = createBackgroundController({ chromePort, repository });

    await expect(controller.handle({ type: "EXTRACT_ACTIVE_TAB" })).resolves.toEqual({
      ok: true,
      type: "EXTRACTION",
      extracted,
    });
    expect(chromePort.calls).toEqual(["getActiveTab", "injectCaptureScript:17", "requestExtraction:17"]);
    expect(repository.calls).toEqual([]);
  });

  it("saves a confirmed capture and refreshes the queued badge", async () => {
    const chromePort = createFakeChromePort(extracted);
    const repository = createRepository();
    const controller = createBackgroundController({ chromePort, repository });

    await expect(controller.handle({ type: "SAVE_CAPTURE", extracted, note: "keep this" })).resolves.toMatchObject({
      ok: true,
      type: "SAVED",
      outcome: { kind: "saved" },
    });
    expect(repository.calls).toEqual(["saveConfirmed:hash-a:keep this", "countByStatus"]);
    expect(chromePort.calls).toEqual(["setBadge:3"]);
  });

  it("filters listed captures by requested delivery status", async () => {
    const chromePort = createFakeChromePort(extracted);
    const queued = { ...record, id: "queued", delivery: { status: "queued" as const, attempts: 0 } };
    const duplicate = { ...record, id: "duplicate", delivery: { status: "duplicate" as const, attempts: 0 } };
    const controller = createBackgroundController({ chromePort, repository: createRepository([queued, duplicate]) });

    await expect(controller.handle({ type: "LIST_CAPTURES", status: "queued" })).resolves.toEqual({
      ok: true,
      type: "CAPTURES",
      records: [queued],
    });
  });

  it("updates a capture note and refreshes the queued badge", async () => {
    const chromePort = createFakeChromePort(extracted);
    const repository = createRepository();
    const controller = createBackgroundController({ chromePort, repository });

    await expect(controller.handle({ type: "UPDATE_CAPTURE_NOTE", id: "capture-1", note: "revised" })).resolves.toEqual({
      ok: true,
      type: "RECORD",
      record: { ...record, user: { note: "revised" } },
    });
    expect(repository.calls).toEqual(["updateNote:capture-1:revised", "countByStatus"]);
    expect(chromePort.calls).toEqual(["setBadge:3"]);
  });

  it("deletes a capture and returns the remaining captures after refreshing the badge", async () => {
    const chromePort = createFakeChromePort(extracted);
    const repository = createRepository([]);
    const controller = createBackgroundController({ chromePort, repository });

    await expect(controller.handle({ type: "DELETE_CAPTURE", id: "capture-1" })).resolves.toEqual({
      ok: true,
      type: "CAPTURES",
      records: [],
    });
    expect(repository.calls).toEqual(["delete:capture-1", "countByStatus", "list"]);
    expect(chromePort.calls).toEqual(["setBadge:3"]);
  });

  it("promotes a duplicate and refreshes the queued badge", async () => {
    const chromePort = createFakeChromePort(extracted);
    const repository = createRepository();
    const controller = createBackgroundController({ chromePort, repository });

    await expect(controller.handle({ type: "PROMOTE_DUPLICATE", id: "capture-1" })).resolves.toEqual({
      ok: true,
      type: "RECORD",
      record: { ...record, delivery: { status: "queued", attempts: 0 } },
    });
    expect(repository.calls).toEqual(["promoteDuplicate:capture-1", "countByStatus"]);
    expect(chromePort.calls).toEqual(["setBadge:3"]);
  });

  it("moves exported records into completed history and refreshes the badge", async () => {
    const chromePort = createFakeChromePort(extracted);
    const repository = createRepository();
    const controller = createBackgroundController({ chromePort, repository });

    const response = await controller.handle({ type: "MARK_CAPTURES_COMPLETE", ids: [record.id] });

    expect(response).toMatchObject({
      ok: true,
      type: "CAPTURES",
      records: [{ id: record.id, completedAt: expect.any(String) }],
    });
    expect(repository.calls).toEqual([`markCompleted:${record.id}`, "countByStatus", "list"]);
    expect(chromePort.calls).toEqual(["setBadge:3"]);
  });

  it("rejects an empty completion batch without changing the queue", async () => {
    const repository = createRepository();
    const controller = createBackgroundController({ chromePort: createFakeChromePort(extracted), repository });

    await expect(controller.handle({ type: "MARK_CAPTURES_COMPLETE", ids: [] })).resolves.toMatchObject({ ok: false });
    expect(repository.calls).toEqual([]);
  });

  it("returns the queue count and opens the requested local or source page", async () => {
    const chromePort = createFakeChromePort(extracted);
    const controller = createBackgroundController({ chromePort, repository: createRepository() });

    await expect(controller.handle({ type: "GET_QUEUE_COUNT" })).resolves.toEqual({ ok: true, type: "QUEUE_COUNT", count: 3 });
    await expect(controller.handle({ type: "OPEN_QUEUE" })).resolves.toEqual({ ok: true, type: "OPENED" });
    await expect(controller.handle({ type: "OPEN_SOURCE", url: "https://example.com/article" })).resolves.toEqual({ ok: true, type: "OPENED" });
    expect(chromePort.calls).toEqual(["openExtensionPage:queue.html", "openUrl:https://example.com/article"]);
  });

  it("returns an explicit error when the active tab has no id", async () => {
    const chromePort = createFakeChromePort(extracted);
    chromePort.activeTab = {};
    const controller = createBackgroundController({ chromePort, repository: createRepository() });

    await expect(controller.handle({ type: "EXTRACT_ACTIVE_TAB" })).resolves.toEqual({
      ok: false,
      code: "NO_ACTIVE_TAB",
      message: "No active tab is available for capture.",
    });
  });

  it("converts repository failures into an explicit extension error", async () => {
    const chromePort = createFakeChromePort(extracted);
    const repository = createRepository();
    repository.failure = new Error("IndexedDB unavailable");
    const controller = createBackgroundController({ chromePort, repository });

    await expect(controller.handle({ type: "LIST_CAPTURES" })).resolves.toEqual({
      ok: false,
      code: "REQUEST_FAILED",
      message: "IndexedDB unavailable",
    });
  });
});
