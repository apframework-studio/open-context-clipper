import { JSDOM } from "jsdom";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createQueueController, type QueueMessageClient } from "../../src/queue/main";
import type { ExtensionRequest, ExtensionResponse, HistoryRetentionSetting } from "../../src/shared/messages";
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
  failCompletion = false;
  settings: HistoryRetentionSetting = { days: null };
  cleanupWarning = "";
  failSettingsRead = false;

  async send(request: ExtensionRequest): Promise<ExtensionResponse> {
    this.requests.push(request);
    switch (request.type) {
      case "LIST_CAPTURES":
        return { ok: true, type: "CAPTURES", records: this.records, ...(this.cleanupWarning ? { cleanupWarning: this.cleanupWarning } : {}) };
      case "GET_HISTORY_SETTINGS":
        if (this.failSettingsRead) return { ok: false, code: "STORAGE_FAILED", message: "Storage unavailable" };
        return { ok: true, type: "HISTORY_SETTINGS", settings: this.settings };
      case "UPDATE_HISTORY_SETTINGS":
        this.settings = request.days === null ? { days: null } : { days: request.days, enabledAt: "2026-10-19T00:00:00.000Z" };
        return { ok: true, type: "HISTORY_SETTINGS", settings: this.settings };
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
      case "MARK_CAPTURES_COMPLETE":
        if (this.failCompletion) return { ok: false, code: "SAVE_FAILED", message: "IndexedDB unavailable" };
        this.records = this.records.map((record) => request.ids.includes(record.id)
          ? { ...record, completedAt: record.completedAt ?? "2026-10-18T10:00:00.000Z", lastExportedAt: "2026-10-19T00:00:00.000Z" }
          : record);
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
  it("shows the newest captured inbox article first even when storage returns older records first", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    client.records = [
      { ...queued, id: "older", source: { ...queued.source, title: "旧文章" }, capture: { ...queued.capture, capturedAt: "2026-09-17T08:00:00.000Z" } },
      { ...queued, id: "newest", source: { ...queued.source, title: "最新文章" }, capture: { ...queued.capture, capturedAt: "2026-09-21T08:00:00.000Z" } },
      { ...queued, id: "middle", source: { ...queued.source, title: "中间文章" }, capture: { ...queued.capture, capturedAt: "2026-09-19T08:00:00.000Z" } },
    ];
    await createQueueController({ root, messageClient: client, download: () => undefined }).load();

    expect([...root.querySelectorAll<HTMLElement>(".capture-row")].map((row) => row.dataset.captureId))
      .toEqual(["newest", "middle", "older"]);
    expect(root.querySelector(".queue-detail h2")?.textContent).toBe("最新文章");
    expect(client.records.map((record) => record.id)).toEqual(["older", "newest", "middle"]);
  });

  it("shows the most recently completed article first in history", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    client.records = [
      { ...queued, id: "older", completedAt: "2026-10-18T08:00:00.000Z" },
      { ...queued, id: "newest", completedAt: "2026-10-20T08:00:00.000Z" },
      { ...queued, id: "middle", completedAt: "2026-10-19T08:00:00.000Z" },
    ];
    const controller = createQueueController({ root, messageClient: client, download: () => undefined });
    await controller.load();
    controller.view("completed");

    expect([...root.querySelectorAll<HTMLElement>(".capture-row")].map((row) => row.dataset.captureId))
      .toEqual(["newest", "middle", "older"]);
  });

  it("uses the saved language on reload and switches the visible queue immediately", async () => {
    let saved: "auto" | "zh-CN" | "en" = "auto";
    const languageStore = {
      async get() { return saved; },
      async set(value: "auto" | "zh-CN" | "en") { saved = value; },
    };
    const root = createRoot();
    const controller = createQueueController({ root, messageClient: new FakeMessageClient(), download: () => undefined, languageStore, browserLanguage: "en-US" });
    await controller.load();
    expect(root.querySelector(".queue-hero h1")?.textContent).toBe("Inbox");
    await controller.openSettings();
    const languageSelect = root.querySelector<HTMLSelectElement>(".language-select")!;
    expect(languageSelect.value).toBe("auto");
    languageSelect.value = "zh-CN";
    languageSelect.dispatchEvent(new root.ownerDocument.defaultView!.Event("change", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(root.querySelector(".queue-hero h1")?.textContent).toBe("设置");
    expect(root.querySelector<HTMLSelectElement>(".language-select")?.value).toBe("zh-CN");
    expect(root.ownerDocument.documentElement.lang).toBe("zh-CN");

    const reloaded = createRoot();
    await createQueueController({ root: reloaded, messageClient: new FakeMessageClient(), download: () => undefined, languageStore, browserLanguage: "en-US" }).load();
    expect(reloaded.querySelector(".queue-hero h1")?.textContent).toBe("收件箱");
  });

  it("keeps an unsaved retention choice when the language changes", async () => {
    const root = createRoot();
    const controller = createQueueController({ root, messageClient: new FakeMessageClient(), download: () => undefined, browserLanguage: "en-US" });
    await controller.load();
    await controller.openSettings();
    const retention = root.querySelector<HTMLSelectElement>(".retention-select")!;
    retention.value = "30";
    retention.dispatchEvent(new root.ownerDocument.defaultView!.Event("change", { bubbles: true }));

    await controller.updateLanguage("en");

    expect(root.querySelector<HTMLSelectElement>(".retention-select")?.value).toBe("30");
    expect(root.querySelector(".queue-hero h1")?.textContent).toBe("Settings");
  });

  it("keeps an English completed view and its settings readable", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    client.records = [{ ...queued, completedAt: "2026-10-18T10:00:00.000Z" }];
    const controller = createQueueController({ root, messageClient: client, download: () => undefined, locale: "en" });
    await controller.load();
    controller.view("completed");
    expect(root.querySelector(".queue-hero h1")?.textContent).toBe("Completed");
    expect(root.querySelector(".queue-toolbar")?.textContent).toContain("Export all again");
    expect(root.querySelector(".capture-meta")?.textContent).toContain("Completed on");
    await controller.openSettings();
    expect(root.textContent).toContain("Language");
    expect(root.textContent).toContain("History retention");
    expect(root.textContent).not.toContain("已完成记录保留期限");
  });

  it("formats captured dates for the selected language without changing stored timestamps", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    const controller = createQueueController({ root, messageClient: client, download: () => undefined, locale: "en" });
    await controller.load();

    expect(root.querySelector(".capture-meta")?.textContent).toContain("09/19/2026");
    expect(root.querySelector(".queue-detail .detail-header")?.textContent).toContain("09/19/2026");
    expect(client.records[0]?.capture.capturedAt).toBe("2026-09-19T08:00:00.000Z");
  });

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

  it("renders the inbox as a compact list with visible export controls and a detail panel", async () => {
    const root = createRoot();
    const controller = createQueueController({ root, messageClient: new FakeMessageClient(), download: () => undefined });

    await controller.load();

    expect(root.querySelector(".queue-hero h1")?.textContent).toBe("收件箱");
    expect(root.querySelector(".queue-toolbar")?.textContent).toContain("导出全部 ZIP");
    expect(root.querySelector(".queue-selection-bar")?.textContent).toContain("导出所选 ZIP");
    expect(root.querySelectorAll(".status-pill")).toHaveLength(2);
    expect(root.querySelector(".capture-row .capture-main")).not.toBeNull();
    expect(root.querySelector(".queue-detail")?.textContent).toContain("待同步文章");
  });

  it("selects the article from the whole highlighted row without treating its checkbox as a detail click", async () => {
    const root = createRoot();
    const controller = createQueueController({ root, messageClient: new FakeMessageClient(), download: () => undefined });
    await controller.load();

    root.querySelector<HTMLElement>(`[data-capture-id="${duplicate.id}"] .capture-meta`)!.click();
    expect(root.querySelector(".capture-row.is-active")?.getAttribute("data-capture-id")).toBe(duplicate.id);
    expect(root.querySelector(".queue-detail h2")?.textContent).toBe(duplicate.source.title);

    root.querySelector<HTMLInputElement>(`[data-capture-id="${queued.id}"] input[type="checkbox"]`)!.click();
    expect(root.querySelector(".capture-row.is-active")?.getAttribute("data-capture-id")).toBe(duplicate.id);
    expect(root.querySelector(".queue-detail h2")?.textContent).toBe(duplicate.source.title);
  });

  it("uses inbox and completed as the only primary navigation views", async () => {
    const root = createRoot();
    const controller = createQueueController({ root, messageClient: new FakeMessageClient(), download: () => undefined });

    await controller.load();

    expect(root.querySelector(".queue-layout")).not.toBeNull();
    expect(root.querySelector(".queue-rail .queue-brand")?.textContent).toBe("O");
    expect([...root.querySelectorAll(".queue-nav-item")].map((button) => button.textContent)).toEqual([
      "收件箱2", "已完成0",
    ]);
    expect(root.querySelector(".queue-focus")).toBeNull();
  });

  it("keeps notes and deletion in the detail panel rather than every list row or a clipped menu", async () => {
    const root = createRoot();
    const controller = createQueueController({ root, messageClient: new FakeMessageClient(), download: () => undefined });

    await controller.load();

    expect(root.querySelector(".capture-row textarea")).toBeNull();
    expect(root.querySelector(".capture-more-actions")).toBeNull();
    expect(root.querySelector(".queue-detail")?.textContent).toContain("删除");
    expect(root.querySelector(".queue-detail textarea")).toBeNull();
    root.querySelector<HTMLButtonElement>(".queue-detail .note-edit-action")!.click();
    expect(root.querySelector(".queue-detail textarea")).not.toBeNull();
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

  it("exports only explicitly selected records as JSON, including a duplicate candidate", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    const downloads: Array<{ filename: string; content: string | Uint8Array }> = [];
    const controller = createQueueController({
      root,
      messageClient: client,
      download: (content, filename) => downloads.push({ content, filename }),
    });

    await controller.load();
    const checkbox = root.querySelector<HTMLInputElement>(`[data-capture-id="${duplicate.id}"] input[type="checkbox"]`)!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new root.ownerDocument.defaultView!.Event("change", { bubbles: true }));
    await controller.exportSelected();

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.filename).toBe("ocf-captures.json");
    expect(JSON.parse(downloads[0]?.content as string).map((record: CaptureRecord) => record.id)).toEqual([duplicate.id]);
    expect(client.records.find((record) => record.id === duplicate.id)?.completedAt).toBeTruthy();
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

  it("moves a single Markdown export into completed history without another user action", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    const downloads: string[] = [];
    const controller = createQueueController({
      root, messageClient: client,
      download: (_content, filename) => downloads.push(filename),
    });

    await controller.load();
    await controller.exportOne(queued.id);

    expect(downloads).toEqual(["待同步文章.md"]);
    expect(client.requests.at(-1)).toEqual({ type: "MARK_CAPTURES_COMPLETE", ids: [queued.id] });
    expect(root.textContent).not.toContain("待同步文章");
    controller.view("completed");
    expect(root.textContent).toContain("待同步文章");
  });

  it("exports all visible inbox articles in one ZIP and moves them to completed history", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    const downloads: Array<{ content: string | Uint8Array; filename: string }> = [];
    const controller = createQueueController({
      root, messageClient: client,
      download: (content, filename) => downloads.push({ content, filename }),
    });

    await controller.load();
    await controller.exportAllZip();

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.filename).toMatch(/\.zip$/);
    const files = unzipSync(downloads[0]!.content as Uint8Array);
    expect(Object.keys(files).filter((path) => path.endsWith(".md"))).toHaveLength(2);
    expect(JSON.parse(strFromU8(files["captures.json"]!)).map((record: CaptureRecord) => record.id))
      .toEqual(expect.arrayContaining([queued.id, duplicate.id]));
    expect(client.requests.at(-1)).toEqual({ type: "MARK_CAPTURES_COMPLETE", ids: expect.arrayContaining([queued.id, duplicate.id]) });
    expect(root.querySelectorAll(".capture-row")).toHaveLength(0);
  });

  it("wires selection, ZIP export, and completed navigation in the page", async () => {
    const root = createRoot();
    const downloads: Array<string | Uint8Array> = [];
    const controller = createQueueController({
      root, messageClient: new FakeMessageClient(),
      download: (content) => downloads.push(content),
    });

    await controller.load();
    const checkbox = root.querySelector<HTMLInputElement>(`[data-capture-id="${queued.id}"] input[type="checkbox"]`)!;
    checkbox.click();
    expect(root.querySelector(".selection-count")?.textContent).toBe("已选 1 / 2 条");

    root.querySelector<HTMLButtonElement>(".selection-primary")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(downloads).toHaveLength(1);
    expect(Object.keys(unzipSync(downloads[0] as Uint8Array)).filter((path) => path.endsWith(".md"))).toHaveLength(1);
    expect(root.querySelectorAll(".capture-row")).toHaveLength(1);
    root.querySelectorAll<HTMLButtonElement>(".queue-nav-item")[1]!.click();
    expect(root.querySelector(".queue-hero h1")?.textContent).toBe("已完成");
    expect(root.querySelector(".queue-detail")?.textContent).toContain(queued.source.title);
  });

  it("makes completed history a full management view with clear re-export actions and completion time", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    client.records = [
      { ...queued, completedAt: "2026-10-18T10:00:00.000Z" },
      { ...duplicate, completedAt: "2026-10-18T11:00:00.000Z" },
    ];
    const controller = createQueueController({ root, messageClient: client, download: () => undefined });

    await controller.load();
    controller.view("completed");

    expect(root.querySelector(".queue-search")).not.toBeNull();
    expect(root.querySelector(".queue-toolbar")?.textContent).toContain("再次导出全部 ZIP");
    expect(root.querySelector(".queue-selection-bar")?.textContent).toContain("再次导出所选 ZIP");
    expect(root.querySelector(".queue-selection-bar")?.textContent).toContain("再次导出所选 JSON");
    expect(root.querySelectorAll(".capture-row")).toHaveLength(2);
    expect(root.querySelector(".capture-row")?.getAttribute("data-capture-id")).toBe(duplicate.id);
    expect(root.querySelector(".capture-row .capture-meta")?.textContent).toContain("完成于");
    expect(root.querySelector(".queue-detail")?.textContent).toContain("完成于");
    expect(root.querySelector(".queue-detail")?.textContent).toContain("再次导出 Markdown");
    expect(root.querySelector(".queue-detail .note-edit-action")).not.toBeNull();
    expect(root.querySelector(".queue-detail .danger-action")).not.toBeNull();
  });

  it("keeps completed records in history and preserves their first completion time when re-exported", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    client.records = [{ ...queued, completedAt: "2026-10-18T10:00:00.000Z" }];
    const downloads: string[] = [];
    const controller = createQueueController({
      root, messageClient: client,
      download: (_content, filename) => downloads.push(filename),
    });

    await controller.load();
    controller.view("completed");
    root.querySelector<HTMLButtonElement>(".queue-export-action")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(downloads).toEqual(["ocf-captures.zip"]);
    expect(client.records[0]?.completedAt).toBe("2026-10-18T10:00:00.000Z");
    expect(client.requests.at(-1)).toEqual({ type: "MARK_CAPTURES_COMPLETE", ids: [queued.id] });
    expect(client.records[0]?.lastExportedAt).toBe("2026-10-19T00:00:00.000Z");
    expect(root.querySelectorAll(".capture-row")).toHaveLength(1);
    expect(root.querySelector(".queue-notice")?.textContent).toContain("重新导出");
  });

  it("offers a separate local history setting and saves the selected retention period", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    const controller = createQueueController({ root, messageClient: client, download: () => undefined });
    await controller.load();

    expect(root.querySelectorAll(".queue-nav-item")).toHaveLength(2);
    await controller.openSettings();
    expect(root.querySelector(".queue-hero h1")?.textContent).toBe("设置");
    expect(root.querySelector<HTMLSelectElement>(".retention-select")?.value).toBe("forever");
    expect(root.textContent).toContain("收件箱");
    expect(root.textContent).toContain("已完成");
    expect(root.textContent).toContain("下次打开队列");
    expect(root.textContent).toContain("无法确认文件已经保存");

    const select = root.querySelector<HTMLSelectElement>(".retention-select")!;
    select.value = "30";
    root.querySelector<HTMLButtonElement>(".retention-save")!.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.requests.at(-1)).toEqual({ type: "UPDATE_HISTORY_SETTINGS", days: 30 });
    expect(client.settings.days).toBe(30);
    expect(root.querySelector(".queue-notice")?.textContent).toContain("已保存");

    await controller.updateHistorySettings(90);
    expect(client.settings.days).toBe(90);
    await controller.updateHistorySettings(null);
    expect(client.settings).toEqual({ days: null });
  });

  it("shows a nonblocking cleanup warning above a readable queue", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    client.cleanupWarning = "历史记录自动清理未完成";
    const controller = createQueueController({ root, messageClient: client, download: () => undefined });

    await controller.load();
    expect(root.querySelector(".queue-notice")?.textContent).toContain("历史记录自动清理未完成");
    expect(root.querySelectorAll(".capture-row")).toHaveLength(2);
  });

  it("does not claim permanent retention when settings cannot be read", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    client.settings = { days: 30, enabledAt: "2026-10-19T00:00:00.000Z" };
    client.failSettingsRead = true;
    const controller = createQueueController({ root, messageClient: client, download: () => undefined });

    await controller.load();
    await controller.openSettings();
    expect(root.querySelector(".queue-notice")?.textContent).toContain("读取设置失败");
    expect(root.querySelector(".retention-select")).toBeNull();
    expect(root.querySelector(".retention-save")).toBeNull();
  });

  it("prevents a second save while a retention update is pending", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    const originalSend = client.send.bind(client);
    let finishSave!: () => void;
    const blocked = new Promise<void>((resolve) => { finishSave = resolve; });
    let saveCalls = 0;
    client.send = async (request) => {
      if (request.type === "UPDATE_HISTORY_SETTINGS") {
        saveCalls += 1;
        await blocked;
      }
      return originalSend(request);
    };
    const controller = createQueueController({ root, messageClient: client, download: () => undefined });

    await controller.load();
    await controller.openSettings();
    const select = root.querySelector<HTMLSelectElement>(".retention-select")!;
    select.value = "30";
    const save = root.querySelector<HTMLButtonElement>(".retention-save")!;
    save.click();
    expect(save.disabled).toBe(true);
    select.value = "90";
    save.click();
    expect(saveCalls).toBe(1);
    finishSave();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.settings.days).toBe(30);
  });

  it("shows all history on navigation even after searching the inbox", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    client.records = [queued, { ...duplicate, completedAt: "2026-10-18T11:00:00.000Z" }];
    const controller = createQueueController({ root, messageClient: client, download: () => undefined });

    await controller.load();
    const search = root.querySelector<HTMLInputElement>(".queue-search")!;
    search.value = "待同步";
    search.dispatchEvent(new root.ownerDocument.defaultView!.Event("input", { bubbles: true }));
    controller.view("completed");

    expect(root.querySelector<HTMLInputElement>(".queue-search")?.value).toBe("");
    expect(root.querySelector(".queue-detail")?.textContent).toContain(duplicate.source.title);
  });

  it("keeps an exported file downloadable when saving completion fails and reports the problem", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    client.failCompletion = true;
    const downloads: string[] = [];
    const controller = createQueueController({
      root, messageClient: client,
      download: (_content, filename) => downloads.push(filename),
    });

    await controller.load();
    await controller.exportOne(queued.id);

    expect(downloads).toHaveLength(1);
    expect(root.textContent).toContain("待同步文章");
    expect(root.querySelector(".queue-notice")?.textContent).toContain("未移入已完成");
  });

  it("limits one-click ZIP export to the current search results", async () => {
    const root = createRoot();
    const downloads: Array<string | Uint8Array> = [];
    const controller = createQueueController({
      root, messageClient: new FakeMessageClient(),
      download: (content) => downloads.push(content),
    });

    await controller.load();
    const search = root.querySelector<HTMLInputElement>(".queue-search")!;
    search.value = "重复";
    search.dispatchEvent(new root.ownerDocument.defaultView!.Event("input", { bubbles: true }));
    expect(root.querySelectorAll(".capture-row")).toHaveLength(1);

    await controller.exportAllZip();
    const files = unzipSync(downloads[0] as Uint8Array);
    expect(Object.keys(files).filter((path) => path.endsWith(".md"))).toHaveLength(1);
    expect(JSON.parse(strFromU8(files["captures.json"]!)).map((record: CaptureRecord) => record.id))
      .toEqual([duplicate.id]);
  });

  it("keeps the search field intact while composing Chinese text", async () => {
    const root = createRoot();
    const controller = createQueueController({ root, messageClient: new FakeMessageClient(), download: () => undefined });
    await controller.load();

    const search = root.querySelector<HTMLInputElement>(".queue-search")!;
    search.value = "重";
    const composingInput = new root.ownerDocument.defaultView!.Event("input", { bubbles: true });
    Object.defineProperty(composingInput, "isComposing", { value: true });
    search.dispatchEvent(composingInput);
    expect(root.querySelector(".queue-search")).toBe(search);

    search.value = "重复";
    search.dispatchEvent(new root.ownerDocument.defaultView!.Event("compositionend", { bubbles: true }));
    expect(root.querySelectorAll(".capture-row")).toHaveLength(1);
  });

  it("does not move an article to completed when the browser download cannot start", async () => {
    const root = createRoot();
    const client = new FakeMessageClient();
    const controller = createQueueController({
      root, messageClient: client,
      download: () => { throw new Error("download blocked"); },
    });

    await controller.load();
    await controller.exportOne(queued.id);

    expect(client.requests.some((request) => request.type === "MARK_CAPTURES_COMPLETE")).toBe(false);
    expect(root.textContent).toContain("待同步文章");
    expect(root.querySelector(".queue-notice")?.textContent).toContain("未能下载");
  });
});
