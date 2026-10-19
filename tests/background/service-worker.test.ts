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

function createRepository(records: CaptureRecord[] = [record]): CaptureRepositoryPort & { calls: string[]; failure?: Error; cleanupFailure?: Error } {
  let currentRecords = records;
  const repository: CaptureRepositoryPort & { calls: string[]; failure?: Error; cleanupFailure?: Error } = {
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
    async deleteExpiredCompleted(cutoffIso, enabledAt) {
      repository.calls.push(`deleteExpiredCompleted:${cutoffIso}:${enabledAt}`);
      if (repository.cleanupFailure) throw repository.cleanupFailure;
      return 0;
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

  it("defaults history retention to forever and never cleans on a count request", async () => {
    const chromePort = createFakeChromePort(extracted);
    const repository = createRepository();
    const controller = createBackgroundController({ chromePort, repository });

    await expect(controller.handle({ type: "GET_HISTORY_SETTINGS" })).resolves.toEqual({
      ok: true, type: "HISTORY_SETTINGS", settings: { days: null },
    });
    await controller.handle({ type: "GET_QUEUE_COUNT" });
    await controller.handle({ type: "LIST_CAPTURES" });
    expect(repository.calls).not.toContain(expect.stringContaining("deleteExpiredCompleted"));
  });

  it("saves a timed preference once and cleans only on the next list after its grace period", async () => {
    const chromePort = createFakeChromePort(extracted);
    const repository = createRepository();
    let currentTime = "2026-10-19T00:00:00.000Z";
    const controller = createBackgroundController({
      chromePort, repository, now: () => new Date(currentTime),
    });

    await expect(controller.handle({ type: "UPDATE_HISTORY_SETTINGS", days: 30 })).resolves.toEqual({
      ok: true, type: "HISTORY_SETTINGS", settings: { days: 30, enabledAt: "2026-10-19T00:00:00.000Z" },
    });
    await controller.handle({ type: "GET_QUEUE_COUNT" });
    expect(repository.calls).not.toContain(expect.stringContaining("deleteExpiredCompleted"));
    await expect(controller.handle({ type: "LIST_CAPTURES" })).resolves.toMatchObject({ ok: true, type: "CAPTURES" });
    expect(repository.calls).toContain("deleteExpiredCompleted:2026-09-19T00:00:00.000Z:2026-10-19T00:00:00.000Z");
    currentTime = "2026-11-20T00:00:00.000Z";
    await controller.handle({ type: "UPDATE_HISTORY_SETTINGS", days: 30 });
    expect(chromePort.historySettings).toEqual({ days: 30, enabledAt: "2026-10-19T00:00:00.000Z" });
    await controller.handle({ type: "UPDATE_HISTORY_SETTINGS", days: 90 });
    expect(chromePort.historySettings).toEqual({ days: 90, enabledAt: currentTime });
  });

  it("rejects unsupported retention values and resets to forever", async () => {
    const chromePort = createFakeChromePort(extracted);
    const repository = createRepository();
    const controller = createBackgroundController({ chromePort, repository, now: () => new Date("2026-10-19T00:00:00.000Z") });

    await expect(controller.handle({ type: "UPDATE_HISTORY_SETTINGS", days: 7 } as never)).resolves.toMatchObject({ ok: false });
    expect(chromePort.historySettings).toBeUndefined();
    await controller.handle({ type: "UPDATE_HISTORY_SETTINGS", days: 90 });
    await expect(controller.handle({ type: "UPDATE_HISTORY_SETTINGS", days: null })).resolves.toEqual({
      ok: true, type: "HISTORY_SETTINGS", settings: { days: null },
    });
  });

  it("treats a malformed saved grace timestamp as permanent retention", async () => {
    const chromePort = createFakeChromePort(extracted);
    chromePort.historySettings = { days: 30, enabledAt: "2026" } as never;
    const repository = createRepository();
    const controller = createBackgroundController({ chromePort, repository });

    await expect(controller.handle({ type: "GET_HISTORY_SETTINGS" })).resolves.toEqual({
      ok: true, type: "HISTORY_SETTINGS", settings: { days: null },
    });
    await controller.handle({ type: "LIST_CAPTURES" });
    expect(repository.calls).not.toContain(expect.stringContaining("deleteExpiredCompleted"));
  });

  it("still lists records when cleanup fails and returns a warning", async () => {
    const chromePort = createFakeChromePort(extracted);
    chromePort.historySettings = { days: 30, enabledAt: "2026-08-01T00:00:00.000Z" };
    const repository = createRepository();
    repository.cleanupFailure = new Error("IndexedDB cleanup failed");
    const controller = createBackgroundController({
      chromePort, repository, now: () => new Date("2026-10-19T00:00:00.000Z"),
    });

    await expect(controller.handle({ type: "LIST_CAPTURES" })).resolves.toMatchObject({
      ok: true, type: "CAPTURES", records: [record], cleanupWarning: expect.any(String),
    });
  });

  it("does not acknowledge a new preference while a cleanup using the old preference is running", async () => {
    const chromePort = createFakeChromePort(extracted);
    chromePort.historySettings = { days: 30, enabledAt: "2026-08-01T00:00:00.000Z" };
    const repository = createRepository();
    let cleanupStarted!: () => void;
    let finishCleanup!: () => void;
    const started = new Promise<void>((resolve) => { cleanupStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { finishCleanup = resolve; });
    repository.deleteExpiredCompleted = async () => { cleanupStarted(); await blocked; return 0; };
    const controller = createBackgroundController({
      chromePort, repository, now: () => new Date("2026-10-19T00:00:00.000Z"),
    });

    const listing = controller.handle({ type: "LIST_CAPTURES" });
    await started;
    const change = controller.handle({ type: "UPDATE_HISTORY_SETTINGS", days: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chromePort.historySettings.days).toBe(30);
    finishCleanup();
    await Promise.all([listing, change]);
    expect(chromePort.historySettings).toEqual({ days: null });
  });

  it("serializes rapid preference changes so the most recent choice wins", async () => {
    const chromePort = createFakeChromePort(extracted);
    let firstSaveStarted!: () => void;
    let finishFirstSave!: () => void;
    const started = new Promise<void>((resolve) => { firstSaveStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { finishFirstSave = resolve; });
    let saves = 0;
    chromePort.setHistoryRetentionSetting = async (setting) => {
      saves += 1;
      if (saves === 1) { firstSaveStarted(); await blocked; }
      chromePort.historySettings = setting;
    };
    const controller = createBackgroundController({
      chromePort, repository: createRepository(), now: () => new Date("2026-10-19T00:00:00.000Z"),
    });

    const first = controller.handle({ type: "UPDATE_HISTORY_SETTINGS", days: 30 });
    await started;
    const second = controller.handle({ type: "UPDATE_HISTORY_SETTINGS", days: 90 });
    finishFirstSave();
    await Promise.all([first, second]);
    expect(chromePort.historySettings?.days).toBe(90);
  });

  it("waits for an in-progress re-export before checking completed history for expiry", async () => {
    const chromePort = createFakeChromePort(extracted);
    chromePort.historySettings = { days: 30, enabledAt: "2026-08-01T00:00:00.000Z" };
    const repository = createRepository();
    let markStarted!: () => void;
    let finishMark!: () => void;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const blocked = new Promise<void>((resolve) => { finishMark = resolve; });
    const events: string[] = [];
    repository.markCompleted = async () => { markStarted(); await blocked; events.push("mark"); };
    repository.deleteExpiredCompleted = async () => { events.push("cleanup"); return 0; };
    const controller = createBackgroundController({
      chromePort, repository, now: () => new Date("2026-10-19T00:00:00.000Z"),
    });

    const marking = controller.handle({ type: "MARK_CAPTURES_COMPLETE", ids: [record.id] });
    await started;
    const listing = controller.handle({ type: "LIST_CAPTURES" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([]);
    finishMark();
    await Promise.all([marking, listing]);
    expect(events).toEqual(["mark", "cleanup"]);
  });

  it("does not report cleanup failure after completed records were deleted", async () => {
    const chromePort = createFakeChromePort(extracted);
    chromePort.historySettings = { days: 30, enabledAt: "2026-08-01T00:00:00.000Z" };
    chromePort.setBadge = async () => { throw new Error("Badge unavailable"); };
    const repository = createRepository();
    repository.deleteExpiredCompleted = async () => 1;
    const controller = createBackgroundController({
      chromePort, repository, now: () => new Date("2026-10-19T00:00:00.000Z"),
    });

    await expect(controller.handle({ type: "LIST_CAPTURES" })).resolves.toEqual({
      ok: true, type: "CAPTURES", records: [record],
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

  it("recognizes a Chrome internal page before attempting to inject the capture script", async () => {
    const chromePort = createFakeChromePort(extracted);
    chromePort.activeTab = { id: 17, url: "chrome://extensions/" };
    const controller = createBackgroundController({ chromePort, repository: createRepository() });

    await expect(controller.handle({ type: "EXTRACT_ACTIVE_TAB" })).resolves.toMatchObject({
      ok: false,
      code: "RESTRICTED_PAGE",
    });
    expect(chromePort.calls).toEqual(["getActiveTab"]);
  });

  it("converts Chrome's restricted-page injection errors into a stable response", async () => {
    for (const url of ["chrome://extensions/", "chrome-extension://example/queue.html"]) {
      const chromePort = createFakeChromePort(extracted);
      chromePort.injectCaptureScript = async () => { throw new Error(`Cannot access a ${url} URL`); };
      const controller = createBackgroundController({ chromePort, repository: createRepository() });

      await expect(controller.handle({ type: "EXTRACT_ACTIVE_TAB" })).resolves.toMatchObject({
        ok: false,
        code: "RESTRICTED_PAGE",
      });
    }
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
