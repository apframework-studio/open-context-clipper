import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { createQueueController, type QueueMessageClient } from "../../src/queue/main";
import type { ExtensionRequest, ExtensionResponse } from "../../src/shared/messages";
import type { CaptureRecord } from "../../src/shared/models";

const queued: CaptureRecord = {
  schemaVersion: 1,
  id: "capture-queued",
  source: {
    originalUrl: "https://example.com/queued",
    canonicalUrl: "https://example.com/queued",
    title: "待同步文章",
  },
  content: { markdown: "待同步内容", excerpt: "待同步摘要", wordCount: 24, imageUrls: [] },
  capture: {
    capturedAt: "2026-09-19T08:00:00.000Z",
    extractor: "readability",
    contentHash: "hash-queued",
    warnings: [],
  },
  user: { note: "初始备注" },
  delivery: { status: "queued", attempts: 0 },
};

const duplicate: CaptureRecord = {
  ...queued,
  id: "capture-duplicate",
  source: {
    originalUrl: "https://other.example.com/duplicate",
    canonicalUrl: "https://other.example.com/duplicate",
    title: "重复候选文章",
  },
  delivery: { status: "duplicate", attempts: 0 },
  duplicateOf: queued.id,
};

class FakeMessageClient implements QueueMessageClient {
  readonly requests: ExtensionRequest[] = [];
  records = [queued, duplicate];

  async send(request: ExtensionRequest): Promise<ExtensionResponse> {
    this.requests.push(request);
    switch (request.type) {
      case "LIST_CAPTURES":
        return { ok: true, type: "CAPTURES", records: this.records };
      case "UPDATE_CAPTURE_NOTE": {
        const record = this.records.find((candidate) => candidate.id === request.id)!;
        const updated = { ...record, user: { note: request.note } };
        this.records = this.records.map((candidate) => (candidate.id === updated.id ? updated : candidate));
        return { ok: true, type: "RECORD", record: updated };
      }
      case "PROMOTE_DUPLICATE": {
        const record = this.records.find((candidate) => candidate.id === request.id)!;
        const updated = { ...record, delivery: { ...record.delivery, status: "queued" as const } };
        this.records = this.records.map((candidate) => (candidate.id === updated.id ? updated : candidate));
        return { ok: true, type: "RECORD", record: updated };
      }
      case "DELETE_CAPTURE":
        this.records = this.records.filter((record) => record.id !== request.id);
        return { ok: true, type: "CAPTURES", records: this.records };
      case "OPEN_SOURCE":
        return { ok: true, type: "OPENED" };
      default:
        return { ok: false, code: "UNEXPECTED_REQUEST", message: request.type };
    }
  }
}

function createRoot(): HTMLElement {
  return new JSDOM("<main id=\"root\"></main>").window.document.querySelector<HTMLElement>("#root")!;
}

describe("local queue controller", () => {
  it("filters records by status without treating an opened source as a silent re-capture", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    const controller = createQueueController({ root, messageClient: client, download: () => undefined });

    await controller.load();
    controller.filter("duplicate");

    expect(root.textContent).toContain("重复候选文章");
    expect(root.textContent).not.toContain("待同步文章");
    await controller.openSource(duplicate.id);
    expect(client.requests.at(-1)).toEqual({ type: "OPEN_SOURCE", url: "https://other.example.com/duplicate" });
    expect(root.textContent).toContain("页面打开后，请在该标签页再次点击插件进行采集。");
    expect(root.textContent).not.toContain("重新采集");
  });

  it("renders a queue overview and clear status pills before the capture cards", async () => {
    const root = createRoot();
    const controller = createQueueController({ root, messageClient: new FakeMessageClient(), download: () => undefined });

    await controller.load();

    expect(root.querySelector(".queue-hero h1")?.textContent).toBe("收件箱");
    expect(root.querySelector(".queue-summary")?.textContent).toContain("全部记录");
    expect(root.querySelector(".queue-summary")?.textContent).toContain("待同步");
    expect(root.querySelectorAll(".status-pill")).toHaveLength(2);
    expect(root.querySelector(".capture-row .capture-main")).not.toBeNull();
  });

  it("renders the chosen workspace console with a focused next capture", async () => {
    const root = createRoot();
    const controller = createQueueController({ root, messageClient: new FakeMessageClient(), download: () => undefined });

    await controller.load();

    expect(root.querySelector(".queue-layout")).not.toBeNull();
    expect(root.querySelector(".queue-rail .queue-brand")?.textContent).toBe("O");
    expect(root.querySelector(".queue-focus")?.textContent).toContain("下一条待整理");
    expect(root.querySelector(".queue-focus")?.textContent).toContain("待同步文章");
    expect(root.querySelector(".capture-index")?.textContent).toBe("01");
    const duplicateFilter = [...root.querySelectorAll<HTMLButtonElement>(".queue-nav-item")]
      .find((button) => button.textContent?.includes("重复候选"));
    duplicateFilter!.click();
    expect(root.textContent).toContain("重复候选文章");
    expect(root.textContent).not.toContain("待同步文章");
  });

  it("keeps note editing and destructive actions in compact disclosures", async () => {
    const root = createRoot();
    const controller = createQueueController({ root, messageClient: new FakeMessageClient(), download: () => undefined });

    await controller.load();

    expect(root.querySelector(".queue-kicker")?.textContent).toBe("本地优先 · 离线整理");
    const noteEditor = root.querySelector<HTMLDetailsElement>(".capture-note-editor");
    expect(noteEditor?.open).toBe(false);
    expect(noteEditor?.querySelector("summary")?.textContent).toBe("添加或编辑备注");
    expect(noteEditor?.querySelector("textarea")).not.toBeNull();
    const moreActions = root.querySelector<HTMLDetailsElement>(".capture-more-actions");
    expect(moreActions?.open).toBe(false);
    expect(moreActions?.textContent).toContain("导出 Markdown");
    expect(moreActions?.textContent).toContain("删除");
    expect(root.querySelector(".capture-actions")?.textContent).toContain("打开来源");
  });

  it("routes note updates, duplicate promotion, and deletion through the background controller", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    const controller = createQueueController({ root, messageClient: client, download: () => undefined });

    await controller.load();
    await controller.updateNote(queued.id, "已修订");
    await controller.promoteDuplicate(duplicate.id);
    await controller.remove(queued.id);

    expect(client.requests).toContainEqual({ type: "UPDATE_CAPTURE_NOTE", id: queued.id, note: "已修订" });
    expect(client.requests).toContainEqual({ type: "PROMOTE_DUPLICATE", id: duplicate.id });
    expect(client.requests).toContainEqual({ type: "DELETE_CAPTURE", id: queued.id });
    expect(root.textContent).not.toContain("待同步文章");
  });

  it("does not send a deletion request when the user cancels the confirmation", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    root.ownerDocument.defaultView!.confirm = () => false;
    const controller = createQueueController({ root, messageClient: client, download: () => undefined });

    await controller.load();
    const deleteButton = [...root.querySelectorAll("button")].find((button) => button.textContent === "删除");
    deleteButton!.click();

    expect(client.requests).not.toContainEqual({ type: "DELETE_CAPTURE", id: queued.id });
    expect(root.textContent).toContain("待同步文章");
  });

  it("excludes duplicate candidates from batch export until they are explicitly promoted", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    const downloads: Array<{ filename: string; content: string }> = [];
    const controller = createQueueController({
      root,
      messageClient: client,
      download: (content, filename) => downloads.push({ content, filename }),
    });

    await controller.load();
    controller.exportSelected();

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.filename).toBe("ocf-captures.json");
    expect(downloads[0]?.content).toContain(queued.id);
    expect(downloads[0]?.content).not.toContain(duplicate.id);
  });

  it("renders source-derived queue text as text rather than HTML", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    client.records = [{ ...queued, source: { ...queued.source, title: "<img src=x onerror=alert(1)>" } }];
    const controller = createQueueController({ root, messageClient: client, download: () => undefined });

    await controller.load();

    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});
