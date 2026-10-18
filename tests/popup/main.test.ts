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

  it("keeps the queue accessible on restricted Chrome pages without offering save", async () => {
    const root = createRoot();
    const requests: ExtensionRequest[] = [];
    const messageClient: MessageClient = {
      async send(request) {
        requests.push(request);
        return request.type === "EXTRACT_ACTIVE_TAB"
          ? { ok: false, code: "REQUEST_FAILED", message: "Cannot access a chrome:// URL" }
          : { ok: true, type: "OPENED" };
      },
    };
    await createPopupController({ root, messageClient }).load();
    expect(root.textContent).toContain("Cannot access a chrome:// URL");
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
