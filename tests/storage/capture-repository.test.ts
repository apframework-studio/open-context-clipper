import { beforeEach, describe, expect, it } from "vitest";
import { CaptureRepository } from "../../src/storage/capture-repository";
import type { ExtractedCapture } from "../../src/shared/models";
import { replaceCaptureRecord, replaceCaptureRecords, resetIndexedDb } from "../helpers/indexeddb";

const capture = (canonicalUrl: string, contentHash: string, capturedAt = "2026-09-19T00:00:00.000Z"): ExtractedCapture => ({
  source: {
    originalUrl: canonicalUrl,
    canonicalUrl,
    title: "Offline capture",
  },
  content: {
    markdown: "# Offline capture\n\nBody",
    excerpt: "Offline capture Body",
    wordCount: 3,
    imageUrls: [],
  },
  capture: {
    capturedAt,
    extractor: "readability",
    contentHash,
    warnings: [],
  },
});

describe("CaptureRepository", () => {
  let repository: CaptureRepository;

  beforeEach(async () => {
    await resetIndexedDb();
    repository = new CaptureRepository();
  });

  it("saves a newly confirmed capture with its optional note", async () => {
    const first = capture("https://example.com/post", "hash-a");

    await expect(repository.saveConfirmed(first, "重点阅读")).resolves.toMatchObject({
      kind: "saved",
      record: {
        schemaVersion: 1,
        source: { canonicalUrl: "https://example.com/post" },
        capture: { contentHash: "hash-a" },
        user: { note: "重点阅读" },
        delivery: { status: "queued", attempts: 0 },
      },
    });
  });

  it("returns the original record for the same canonical URL and content hash", async () => {
    const first = capture("https://example.com/post", "hash-a");
    const saved = await repository.saveConfirmed(first, "重点阅读");

    await expect(repository.saveConfirmed(capture("https://example.com/post", "hash-a"), "new note")).resolves.toMatchObject({
      kind: "unchanged-duplicate",
      record: { id: saved.record.id, user: { note: "重点阅读" } },
    });
    expect(await repository.list()).toHaveLength(1);
  });

  it("updates a queued URL match and resets all delivery state", async () => {
    const saved = await repository.saveConfirmed(capture("https://example.com/post", "hash-a"), "old note");
    const existing = await repository.get(saved.record.id);
    if (!existing) throw new Error("Expected saved capture");
    existing.delivery = {
      status: "queued",
      attempts: 3,
      lastAttemptAt: "2026-09-19T01:00:00.000Z",
      lastError: "offline",
      remoteId: "remote-1",
    };
    await replaceCaptureRecord(existing);

    await expect(repository.saveConfirmed(capture("https://example.com/post", "hash-b"), "updated note")).resolves.toMatchObject({
      kind: "updated-unsynced",
      record: {
        id: saved.record.id,
        capture: { contentHash: "hash-b" },
        user: { note: "updated note" },
        delivery: { status: "queued", attempts: 0 },
      },
    });
    expect(await repository.get(saved.record.id)).toEqual(expect.objectContaining({
      delivery: { status: "queued", attempts: 0 },
    }));
    expect(await repository.get(saved.record.id)).not.toHaveProperty("delivery.lastAttemptAt");
    expect(await repository.get(saved.record.id)).not.toHaveProperty("delivery.lastError");
    expect(await repository.get(saved.record.id)).not.toHaveProperty("delivery.remoteId");
  });

  it("creates a version after a synced URL match and links it to the prior record", async () => {
    const saved = await repository.saveConfirmed(capture("https://example.com/post", "hash-a"), "first");
    const existing = await repository.get(saved.record.id);
    if (!existing) throw new Error("Expected saved capture");
    existing.delivery = { status: "synced", attempts: 1, remoteId: "remote-1" };
    await replaceCaptureRecord(existing);

    await expect(repository.saveConfirmed(capture("https://example.com/post", "hash-b"), "second")).resolves.toMatchObject({
      kind: "new-version",
      record: {
        id: expect.not.stringMatching(new RegExp(`^${saved.record.id}$`)),
        supersedes: saved.record.id,
        delivery: { status: "queued", attempts: 0 },
      },
    });
    expect(await repository.list()).toHaveLength(2);
  });

  it("stores a matching hash at a different URL as a duplicate candidate", async () => {
    const saved = await repository.saveConfirmed(capture("https://example.com/first", "hash-a"), "first");

    await expect(repository.saveConfirmed(capture("https://example.com/second", "hash-a"), "candidate")).resolves.toMatchObject({
      kind: "duplicate-candidate",
      record: {
        source: { canonicalUrl: "https://example.com/second" },
        delivery: { status: "duplicate", attempts: 0 },
        duplicateOf: saved.record.id,
      },
    });
  });

  it("links every same-hash candidate back to the first non-candidate record", async () => {
    const first = await repository.saveConfirmed(
      capture("https://example.com/first", "hash-a", "2026-09-19T00:00:00.000Z"),
      "first"
    );
    const second = await repository.saveConfirmed(
      capture("https://example.com/second", "hash-a", "2026-09-19T00:00:00.000Z"),
      "second"
    );
    const third = await repository.saveConfirmed(
      capture("https://example.com/third", "hash-a", "2026-09-19T00:00:00.000Z"),
      "third"
    );

    expect(second).toMatchObject({ kind: "duplicate-candidate", record: { duplicateOf: first.record.id } });
    expect(third).toMatchObject({ kind: "duplicate-candidate", record: { duplicateOf: first.record.id } });
  });

  it("uses source URLs rather than random IDs when legacy history has only candidates", async () => {
    await repository.saveConfirmed(capture("https://example.com/original", "hash-a"), "original");
    await repository.saveConfirmed(capture("https://example.com/second", "hash-a"), "second");
    await repository.saveConfirmed(capture("https://example.com/third", "hash-a"), "third");
    const candidates = (await repository.list()).filter((record) => record.duplicateOf !== undefined);

    await replaceCaptureRecords([
      {
        ...candidates[0]!,
        id: "z-candidate",
        source: { ...candidates[0]!.source, originalUrl: "https://example.com/a", canonicalUrl: "https://example.com/a" },
      },
      {
        ...candidates[1]!,
        id: "a-candidate",
        source: { ...candidates[1]!.source, originalUrl: "https://example.com/z", canonicalUrl: "https://example.com/z" },
      },
    ]);

    await expect(repository.saveConfirmed(capture("https://example.com/fourth", "hash-a"), "fourth")).resolves.toMatchObject({
      kind: "duplicate-candidate",
      record: { duplicateOf: "z-candidate" },
    });
  });

  it("updates a failed URL match and clears prior delivery metadata", async () => {
    const saved = await repository.saveConfirmed(capture("https://example.com/post", "hash-a"), "old note");
    const existing = await repository.get(saved.record.id);
    if (!existing) throw new Error("Expected saved capture");
    existing.delivery = {
      status: "failed",
      attempts: 3,
      lastAttemptAt: "2026-09-19T01:00:00.000Z",
      lastError: "offline",
      remoteId: "remote-1",
    };
    await replaceCaptureRecord(existing);

    const outcome = await repository.saveConfirmed(capture("https://example.com/post", "hash-b"), "updated note");

    expect(outcome).toMatchObject({
      kind: "updated-unsynced",
      record: {
        id: saved.record.id,
        delivery: { status: "queued", attempts: 0 },
      },
    });
    expect(outcome.record.delivery).not.toHaveProperty("lastAttemptAt");
    expect(outcome.record.delivery).not.toHaveProperty("lastError");
    expect(outcome.record.delivery).not.toHaveProperty("remoteId");
  });

  it("lists, updates, promotes, deletes, and counts persisted records", async () => {
    const saved = await repository.saveConfirmed(capture("https://example.com/first", "hash-a"), "first");
    const candidate = await repository.saveConfirmed(capture("https://example.com/second", "hash-a"), "candidate");

    await repository.updateNote(saved.record.id, "revised");
    expect(await repository.get(saved.record.id)).toEqual(expect.objectContaining({ user: { note: "revised" } }));
    expect(await repository.countByStatus()).toEqual({ queued: 1, duplicate: 1, syncing: 0, synced: 0, failed: 0 });

    await repository.promoteDuplicate(candidate.record.id);
    expect(await repository.get(candidate.record.id)).toEqual(expect.objectContaining({
      delivery: { status: "queued", attempts: 0 },
      duplicateOf: saved.record.id,
    }));
    expect(await repository.countByStatus()).toEqual({ queued: 2, duplicate: 0, syncing: 0, synced: 0, failed: 0 });

    await repository.delete(saved.record.id);
    expect(await repository.get(saved.record.id)).toBeUndefined();
    expect(await repository.list()).toHaveLength(1);
  });
});
