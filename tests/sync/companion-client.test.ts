import { describe, expect, it, vi } from "vitest";
import { CompanionClient, selectSyncBatch } from "../../src/sync/companion-client";
import type { CaptureRecord, DeliveryStatus } from "../../src/shared/models";

function record(id: string, status: DeliveryStatus, capturedAt: string, markdown = "# Captured article"): CaptureRecord {
  return {
    schemaVersion: 1,
    id,
    source: {
      originalUrl: `https://example.com/${id}`,
      canonicalUrl: `https://example.com/${id}`,
      title: `Article ${id}`,
    },
    content: { markdown, wordCount: 2, imageUrls: [] },
    capture: {
      capturedAt,
      extractor: "readability",
      contentHash: `hash-${id}`,
      warnings: [],
    },
    user: {},
    delivery: { status, attempts: 0 },
  };
}

describe("future Companion sync contract", () => {
  it("selects queued and failed records in deterministic capture order within the batch limit", () => {
    const records = [
      ...Array.from({ length: 21 }, (_, index) =>
        record(`queued-${index}`, "queued", `2026-09-${String(22 - index).padStart(2, "0")}T00:00:00.000Z`)
      ),
      record("failed", "failed", "2026-09-01T00:00:00.000Z"),
      record("duplicate", "duplicate", "2026-08-01T00:00:00.000Z"),
      record("synced", "synced", "2026-08-02T00:00:00.000Z"),
    ];

    const batch = selectSyncBatch(records, { maxRecords: 20, maxBytes: 5 * 1024 * 1024 });

    expect(batch.records).toHaveLength(20);
    expect(batch.records.every((item) => item.delivery.status === "queued" || item.delivery.status === "failed")).toBe(true);
    expect(batch.records.some((item) => item.delivery.status === "duplicate")).toBe(false);
    expect(batch.records.map((item) => item.id)).toEqual(["failed", ...Array.from({ length: 19 }, (_, index) => `queued-${20 - index}`)]);
  });

  it("keeps a batch below its UTF-8 JSON payload limit", () => {
    const first = record("first", "queued", "2026-09-01T00:00:00.000Z", "中文正文");
    const second = record("second", "failed", "2026-09-02T00:00:00.000Z", "第二篇正文");
    const oneRecordBytes = new TextEncoder().encode(JSON.stringify({ records: [first] })).byteLength;

    expect(selectSyncBatch([second, first], { maxRecords: 20, maxBytes: oneRecordBytes }).records).toEqual([first]);
    expect(selectSyncBatch([first], { maxRecords: 20, maxBytes: oneRecordBytes - 1 }).records).toEqual([]);
  });

  it("posts a selected batch, including stable ids and content hashes, without automatic retries", async () => {
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { id: "accepted", status: "accepted", inboxId: "inbox-1" },
            { id: "duplicate", status: "duplicate" },
            { id: "rejected", status: "rejected", message: "invalid source" },
            { id: "retryable", status: "retryable_error", message: "offline" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );
    const client = new CompanionClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchStub });
    const records = [
      record("accepted", "queued", "2026-09-01T00:00:00.000Z"),
      record("duplicate", "failed", "2026-09-02T00:00:00.000Z"),
    ];

    await expect(client.sendBatch(records)).resolves.toEqual({
      results: [
        { id: "accepted", status: "accepted", inboxId: "inbox-1" },
        { id: "duplicate", status: "duplicate" },
        { id: "rejected", status: "rejected", message: "invalid source" },
        { id: "retryable", status: "retryable_error", message: "offline" },
      ],
    });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/captures:batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ records }),
    });
    const sent = JSON.parse(fetchStub.mock.calls[0]![1].body as string) as { records: CaptureRecord[] };
    expect(sent.records.map((item) => ({ id: item.id, contentHash: item.capture.contentHash }))).toEqual([
      { id: "accepted", contentHash: "hash-accepted" },
      { id: "duplicate", contentHash: "hash-duplicate" },
    ]);
  });

  it("exposes a typed health check without performing retries", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    const client = new CompanionClient({ baseUrl: "http://127.0.0.1:8787/", fetch: fetchStub });

    await expect(client.health()).resolves.toEqual({ status: "ok" });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub).toHaveBeenCalledWith("http://127.0.0.1:8787/api/v1/health", { method: "GET" });
  });

  it("does not retry a failed request automatically", async () => {
    const fetchStub = vi.fn().mockRejectedValue(new Error("Companion unavailable"));
    const client = new CompanionClient({ baseUrl: "http://127.0.0.1:8787", fetch: fetchStub });

    await expect(client.sendBatch([record("failed", "queued", "2026-09-01T00:00:00.000Z")])).rejects.toThrow(
      "Companion unavailable"
    );
    expect(fetchStub).toHaveBeenCalledTimes(1);
  });
});
