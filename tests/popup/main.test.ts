import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { createPopupController, type MessageClient } from "../../src/popup/main";
import type { ExtensionRequest, ExtensionResponse } from "../../src/shared/messages";
import type { ExtractedCapture, SaveOutcome } from "../../src/shared/models";

const extracted: ExtractedCapture = {
  source: {
    originalUrl: "https://medium.example.com/article",
    canonicalUrl: "https://medium.example.com/article",
    title: "<img src=x onerror=alert(1)> 上下文工程",
    author: "作者",
    siteName: "Medium",
    publishedAt: "2026-09-19",
  },
  content: {
    markdown: "# 上下文工程\n\n" + "开头内容。".repeat(220) + "结尾内容。".repeat(120),
    wordCount: 680,
    imageUrls: ["https://cdn.example.com/cover.jpg", "https://cdn.example.com/diagram.png"],
  },
  capture: {
    capturedAt: "2026-09-19T00:00:00.000Z",
    extractor: "readability",
    contentHash: "hash-a",
    warnings: ["正文较短，已使用回退提取。"],
  },
};

function createFakeMessageClient(
  kind: SaveOutcome["kind"] = "saved",
  options: { queueCountFails?: boolean; queueCountThrows?: boolean } = {},
): MessageClient & { requests: ExtensionRequest[] } {
  const client: MessageClient & { requests: ExtensionRequest[] } = {
    requests: [],
    async send(request): Promise<ExtensionResponse> {
      client.requests.push(request);
      if (request.type === "EXTRACT_ACTIVE_TAB") return { ok: true, type: "EXTRACTION", extracted };
      if (request.type === "SAVE_CAPTURE") {
        return {
          ok: true,
          type: "SAVED",
          outcome: {
            kind,
            record: {
              ...extracted,
              schemaVersion: 1,
              id: "capture-1",
              user: { note: request.note },
              delivery: { status: "queued", attempts: 0 },
            },
          },
        };
      }
      if (request.type === "GET_QUEUE_COUNT") {
        if (options.queueCountThrows) throw new Error("队列计数请求中断");
        return options.queueCountFails
          ? { ok: false, code: "QUEUE_COUNT_UNAVAILABLE", message: "队列暂时不可用" }
          : { ok: true, type: "QUEUE_COUNT", count: 4 };
      }
      if (request.type === "OPEN_QUEUE") return { ok: true, type: "OPENED" };
      return { ok: false, code: "UNEXPECTED_REQUEST", message: request.type };
    },
  };
  return client;
}

function createRoot(): HTMLElement {
  return new JSDOM("<main id=\"root\"></main>").window.document.querySelector<HTMLElement>("#root")!;
}

describe("popup capture confirmation", () => {
  it("downloads Markdown from the preview with its note without saving a queue record", async () => {
    const root = createRoot();
    const client = createFakeMessageClient();
    const downloads: Array<{ content: string; filename: string; mimeType: string }> = [];
    const controller = createPopupController({
      root,
      messageClient: client,
      download: (content, filename, mimeType) => downloads.push({ content, filename, mimeType }),
    });
    await controller.load();

    const note = root.querySelector<HTMLInputElement>("#capture-note")!;
    note.value = "只需要本地文件";
    root.querySelector<HTMLButtonElement>(".popup-export-action")!.click();

    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.content).toContain("- 备注：只需要本地文件");
    expect(downloads[0]?.content).toContain(extracted.content.markdown);
    expect(downloads[0]?.filename).toBe("-img src=x onerror=alert(1)- 上下文工程.md");
    expect(downloads[0]?.mimeType).toBe("text/markdown");
    expect(client.requests).toEqual([{ type: "EXTRACT_ACTIVE_TAB" }]);
    expect(root.textContent).toContain("未加入队列");
  });

  it("uses English Markdown labels for a direct export and reports download failures", async () => {
    const root = createRoot();
    const client = createFakeMessageClient();
    let content = "";
    const controller = createPopupController({
      root,
      messageClient: client,
      locale: "en",
      download: (value) => { content = value; },
    });
    await controller.load();
    root.querySelector<HTMLButtonElement>(".popup-export-action")!.click();

    expect(content).toContain("- Source: https://medium.example.com/article");
    expect(root.textContent).toContain("not added to the queue");
    expect(client.requests).toEqual([{ type: "EXTRACT_ACTIVE_TAB" }]);

    const failedRoot = createRoot();
    const failedClient = createFakeMessageClient();
    await createPopupController({
      root: failedRoot,
      messageClient: failedClient,
      download: () => { throw new Error("blocked"); },
    }).load();
    failedRoot.querySelector<HTMLButtonElement>(".popup-export-action")!.click();
    expect(failedRoot.textContent).toContain("下载未能开始");
    expect(failedClient.requests).toEqual([{ type: "EXTRACT_ACTIVE_TAB" }]);
  });

  it("shows an English preview and translates legacy warning codes without changing the article", async () => {
    const root = createRoot();
    await createPopupController({
      root,
      messageClient: {
        async send() {
          return { ok: true, type: "EXTRACTION", extracted: {
            ...extracted,
            capture: { ...extracted.capture, warnings: ["content_too_short", "检测到登录或付费阅读提示，当前采集可能仅包含预览，正文可能不完整。请确认后保存。"] },
          } };
        },
      },
      locale: "en",
    }).load();

    expect(root.textContent).toContain("Save to queue");
    expect(root.textContent).toContain("Open queue");
    expect(root.textContent).toContain("Remote images");
    expect(root.textContent).toContain("Author:");
    expect(root.textContent).not.toContain("Author：");
    expect(root.textContent).toContain("Published: 09/19/2026");
    expect(root.textContent).toContain("The article may be incomplete");
    expect(root.textContent).toContain(extracted.source.title);
    expect(root.textContent).not.toContain("检测到登录");
    expect(root.ownerDocument.documentElement.lang).toBe("en");
  });

  it("shows an English error for a background failure code rather than its raw Chinese message", async () => {
    const root = createRoot();
    await createPopupController({
      root,
      messageClient: { async send() { return { ok: false, code: "EMPTY_CONTENT", message: "未能识别可采集的正文" }; } },
      locale: "en",
    }).load();

    expect(root.textContent).toContain("Could not find article content");
    expect(root.textContent).not.toContain("未能识别");
  });

  it("opens the queue while extraction is still loading", async () => {
    const root = createRoot();
    const requests: ExtensionRequest[] = [];
    let finishExtraction!: (response: ExtensionResponse) => void;
    const messageClient: MessageClient = {
      async send(request) {
        requests.push(request);
        if (request.type === "EXTRACT_ACTIVE_TAB") return new Promise((resolve) => { finishExtraction = resolve; });
        return { ok: true, type: "OPENED" };
      },
    };
    const loading = createPopupController({ root, messageClient }).load();
    const button = [...root.querySelectorAll("button")].find((node) => node.textContent === "打开队列");
    expect(button).toBeDefined();
    button!.click();
    expect(requests).toContainEqual({ type: "OPEN_QUEUE" });
    finishExtraction({ ok: true, type: "EXTRACTION", extracted });
    await loading;
  });

  it("explains restricted Chrome pages and keeps the queue directly accessible", async () => {
    const root = createRoot();
    const requests: ExtensionRequest[] = [];
    const messageClient: MessageClient = {
      async send(request) {
        requests.push(request);
        return request.type === "EXTRACT_ACTIVE_TAB"
          ? { ok: false, code: "RESTRICTED_PAGE", message: "Cannot access a chrome:// URL" }
          : { ok: true, type: "OPENED" };
      },
    };
    await createPopupController({ root, messageClient }).load();
    expect(root.textContent).toContain("当前页面不可采集");
    expect(root.textContent).toContain("已保存的文章");
    expect(root.textContent).not.toContain("Cannot access a chrome:// URL");
    expect(root.textContent).not.toContain("保存到采集队列");
    const button = [...root.querySelectorAll("button")].find((node) => node.textContent === "打开队列");
    expect(button).toBeDefined();
    button!.click();
    expect(requests).toEqual([{ type: "EXTRACT_ACTIVE_TAB" }, { type: "OPEN_QUEUE" }]);
  });

  it("renders a text preview after extraction and only saves after confirmation", async () => {
    const root = createRoot();
    const client = createFakeMessageClient();
    const controller = createPopupController({ root, messageClient: client });

    const loading = controller.load();
    expect(root.textContent).toContain("正在识别正文");
    await loading;

    expect(root.textContent).toContain("已省略");
    expect(root.textContent).toContain("保存到采集队列");
    expect(root.textContent).toContain("Medium");
    expect(root.textContent).toContain("远程图片：2 张");
    expect(client.requests).toEqual([{ type: "EXTRACT_ACTIVE_TAB" }]);

    await controller.save("面向上下文工程");
    expect(client.requests.at(-2)).toMatchObject({
      type: "SAVE_CAPTURE",
      extracted,
      note: "面向上下文工程",
    });
    expect(client.requests.at(-1)).toEqual({ type: "GET_QUEUE_COUNT" });
    expect(root.textContent).toContain("已保存到采集队列（当前 4 条）");
  });

  it("uses a compact reading-card hierarchy for the preview", async () => {
    const root = createRoot();
    const controller = createPopupController({ root, messageClient: createFakeMessageClient() });

    await controller.load();

    expect(root.querySelector(".popup-shell")).not.toBeNull();
    expect(root.querySelector(".popup-kicker")?.textContent).toBe("Capture Plane");
    expect(root.querySelector(".capture-metrics")).not.toBeNull();
    expect(root.querySelectorAll(".preview-copy")).toHaveLength(2);
    const previewScroll = root.querySelector<HTMLElement>(".preview-scroll");
    expect(previewScroll).not.toBeNull();
    expect(previewScroll?.getAttribute("aria-label")).toBe("正文摘录，可滚动阅读");
    expect(previewScroll?.tabIndex).toBe(0);
    expect(root.querySelector(".popup-actions .primary-action")?.textContent).toBe("保存到采集队列");
  });

  it("does not save a capture before an explicit save action", async () => {
    const root = createRoot();
    const client = createFakeMessageClient();
    const controller = createPopupController({ root, messageClient: client });

    await controller.load();
    expect(client.requests).toEqual([{ type: "EXTRACT_ACTIVE_TAB" }]);
  });

  it("keeps save success clear when the queue count cannot be loaded", async () => {
    const root = createRoot();
    const controller = createPopupController({
      root,
      messageClient: createFakeMessageClient("saved", { queueCountFails: true }),
    });

    await controller.load();
    await controller.save("");

    expect(root.textContent).toContain("已保存到采集队列，但暂时无法读取队列数量");
    expect(root.textContent).not.toContain("当前 0 条");
  });

  it("keeps save success clear when the queue count request throws", async () => {
    const root = createRoot();
    const controller = createPopupController({
      root,
      messageClient: createFakeMessageClient("saved", { queueCountThrows: true }),
    });

    await controller.load();
    await controller.save("");

    const summary = root.querySelector(".popup-success p")?.textContent ?? "";
    expect(summary).toContain("已保存到采集队列，但暂时无法读取队列数量");
    expect(summary).not.toMatch(/当前\s*\d+\s*条/);
  });

  it.each([
    ["unchanged-duplicate", "这篇文章已经采集，内容没有变化。"],
    ["new-version", "检测到正文变化，已保存为新版本。"],
    ["duplicate-candidate", "发现相同正文的另一来源，已作为重复候选保存。"],
  ] as const)("shows a clear result for %s", async (kind, message) => {
    const root = createRoot();
    const controller = createPopupController({ root, messageClient: createFakeMessageClient(kind) });

    await controller.load();
    await controller.save("");

    expect(root.textContent).toContain(message);
  });

  it("renders source-derived text with textContent rather than HTML insertion", async () => {
    const root = createRoot();
    const client = createFakeMessageClient();
    const innerHtml = Object.getOwnPropertyDescriptor(root.ownerDocument.defaultView!.Element.prototype, "innerHTML")!;
    Object.defineProperty(root.ownerDocument.defaultView!.Element.prototype, "innerHTML", {
      configurable: true,
      get: innerHtml.get,
      set() {
        throw new Error("source content must not be rendered with innerHTML");
      },
    });

    try {
      await createPopupController({ root, messageClient: client }).load();
      expect(root.querySelector("img")).toBeNull();
      expect(root.textContent).toContain("<img src=x onerror=alert(1)> 上下文工程");
    } finally {
      Object.defineProperty(root.ownerDocument.defaultView!.Element.prototype, "innerHTML", innerHtml);
    }
  });
});
