import "./styles.css";

import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import type { ExtractedCapture, SaveOutcome } from "../shared/models";
import { createTextPreview } from "../shared/preview";

export interface MessageClient {
  send(request: ExtensionRequest): Promise<ExtensionResponse>;
}

export interface PopupController {
  load(): Promise<void>;
  save(note: string): Promise<void>;
  openQueue(): Promise<void>;
}

type PopupDependencies = {
  root: HTMLElement;
  messageClient: MessageClient;
};

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(document: Document, label: string, value?: string): HTMLElement | undefined {
  if (!value) return undefined;
  const row = element(document, "p");
  row.className = "metadata-row";
  const name = element(document, "span", `${label}：`);
  name.className = "metadata-label";
  const content = element(document, "span", value);
  row.append(name, content);
  return row;
}

function metric(document: Document, label: string, value: string): HTMLElement {
  const item = element(document, "div");
  item.className = "capture-metric";
  const name = element(document, "span", label);
  name.className = "capture-metric-label";
  const content = element(document, "strong", value);
  item.append(name, content);
  return item;
}

function messageForOutcome(outcome: SaveOutcome): string {
  switch (outcome.kind) {
    case "unchanged-duplicate":
      return "这篇文章已经采集，内容没有变化。";
    case "new-version":
      return "检测到正文变化，已保存为新版本。";
    case "duplicate-candidate":
      return "发现相同正文的另一来源，已作为重复候选保存。";
    case "updated-unsynced":
      return "已更新尚未同步的采集记录。";
    case "saved":
      return "已保存到采集队列";
  }
}

function errorMessage(response: ExtensionResponse): string {
  return response.ok ? "发生未知错误。" : response.message || "请求失败，请稍后重试。";
}

class ChromeMessageClient implements MessageClient {
  async send(request: ExtensionRequest): Promise<ExtensionResponse> {
    return (await chrome.runtime.sendMessage(request)) as ExtensionResponse;
  }
}

export function createPopupController({ root, messageClient }: PopupDependencies): PopupController {
  let extracted: ExtractedCapture | undefined;
  let noteInput: HTMLInputElement | undefined;
  let primaryButton: HTMLButtonElement | undefined;

  const createQueueButton = () => {
    const button = element(root.ownerDocument, "button", "打开队列");
    button.type = "button";
    button.className = "secondary-action";
    button.addEventListener("click", () => void controller.openQueue());
    return button;
  };

  const renderLoading = () => {
    const state = element(root.ownerDocument, "section");
    state.className = "popup-state popup-loading";
    state.append(element(root.ownerDocument, "span", "Capture Plane"), element(root.ownerDocument, "p", "正在识别正文…"), createQueueButton());
    root.replaceChildren(state);
  };

  const renderError = (message: string) => {
    const content = element(root.ownerDocument, "section");
    content.className = "popup-state popup-error";
    content.append(element(root.ownerDocument, "p", message), createQueueButton());
    root.replaceChildren(content);
  };

  const renderSuccess = (message: string, count?: number) => {
    const content = element(root.ownerDocument, "section");
    content.className = "popup-state popup-success";
    const summary = count === undefined ? message : `${message}（当前 ${count} 条）`;
    content.append(element(root.ownerDocument, "p", summary));
    content.append(createQueueButton());
    root.replaceChildren(content);
  };

  const renderPreview = (capture: ExtractedCapture) => {
    const document = root.ownerDocument;
    const preview = createTextPreview(capture.content.markdown);
    const container = element(document, "section");
    container.className = "popup-shell";

    const hero = element(document, "header");
    hero.className = "popup-hero";
    const kicker = element(document, "span", "Capture Plane");
    kicker.className = "popup-kicker";
    hero.append(kicker, element(document, "h1", capture.source.title));
    container.append(hero);

    const metrics = element(document, "div");
    metrics.className = "capture-metrics";
    metrics.append(
      metric(document, "来源", capture.source.siteName ?? "网页"),
      metric(document, "字数", `${capture.content.wordCount}`),
      metric(document, "远程图片：", `${capture.content.imageUrls.length} 张`),
    );
    container.append(metrics);

    const metadata = element(document, "div");
    metadata.className = "metadata metadata-details";
    [
      field(document, "作者", capture.source.author ?? "未识别"),
      field(document, "发布日期", capture.source.publishedAt ?? "未识别"),
    ].forEach((row) => row && metadata.append(row));
    container.append(metadata);

    const previewSection = element(document, "section");
    previewSection.className = "text-preview";
    const opening = element(document, "p", preview.opening);
    opening.className = "preview-copy preview-opening";
    previewSection.append(opening);
    if (preview.omittedCharacters > 0) {
      const omission = element(document, "p", `··· 已省略 ${preview.omittedCharacters} 字 ···`);
      omission.className = "omission";
      const closing = element(document, "p", preview.closing);
      closing.className = "preview-copy preview-closing";
      previewSection.append(omission, closing);
    }
    const previewScroll = element(document, "div");
    previewScroll.className = "preview-scroll";
    previewScroll.tabIndex = 0;
    previewScroll.setAttribute("aria-label", "正文摘录，可滚动阅读");
    previewScroll.append(previewSection);
    container.append(previewScroll);

    if (capture.capture.warnings.length > 0) {
      const warnings = element(document, "ul");
      warnings.className = "warnings";
      capture.capture.warnings.forEach((warning) => warnings.append(element(document, "li", warning)));
      container.append(warnings);
    }

    const noteLabel = element(document, "label", "备注（可选）");
    noteLabel.className = "note-label";
    noteLabel.htmlFor = "capture-note";
    noteInput = element(document, "input") as HTMLInputElement;
    noteInput.id = "capture-note";
    noteInput.type = "text";
    noteInput.maxLength = 280;
    noteInput.placeholder = "例如：面向上下文工程";
    container.append(noteLabel, noteInput);

    const actions = element(document, "div");
    actions.className = "popup-actions";
    primaryButton = element(document, "button", "保存到采集队列") as HTMLButtonElement;
    primaryButton.type = "button";
    primaryButton.className = "primary-action";
    primaryButton.addEventListener("click", () => void controller.save(noteInput?.value ?? ""));
    actions.append(primaryButton, createQueueButton());
    container.append(actions);
    root.replaceChildren(container);
  };

  const controller: PopupController = {
    async load() {
      renderLoading();
      try {
        const response = await messageClient.send({ type: "EXTRACT_ACTIVE_TAB" });
        if (!response.ok || response.type !== "EXTRACTION") {
          renderError(errorMessage(response));
          return;
        }
        extracted = response.extracted;
        renderPreview(extracted);
      } catch (error) {
        renderError(error instanceof Error ? error.message : "识别正文失败，请稍后重试。");
      }
    },

    async save(note) {
      if (!extracted) {
        renderError("请先完成正文识别后再保存。");
        return;
      }
      if (primaryButton) primaryButton.disabled = true;
      try {
        const response = await messageClient.send({
          type: "SAVE_CAPTURE",
          extracted,
          note: note.slice(0, 280),
        });
        if (!response.ok || response.type !== "SAVED") {
          if (primaryButton) primaryButton.disabled = false;
          renderError(errorMessage(response));
          return;
        }
        try {
          const countResponse = await messageClient.send({ type: "GET_QUEUE_COUNT" });
          if (countResponse.ok && countResponse.type === "QUEUE_COUNT") {
            renderSuccess(messageForOutcome(response.outcome), countResponse.count);
            return;
          }
        } catch {
          // 保存已完成；队列计数只能作为补充信息。
        }
        renderSuccess(`${messageForOutcome(response.outcome)}，但暂时无法读取队列数量`);
      } catch (error) {
        if (primaryButton) primaryButton.disabled = false;
        renderError(error instanceof Error ? error.message : "保存采集失败，请稍后重试。");
      }
    },

    async openQueue() {
      try {
        const response = await messageClient.send({ type: "OPEN_QUEUE" });
        if (!response.ok) renderError(errorMessage(response));
      } catch (error) {
        renderError(error instanceof Error ? error.message : "打开队列失败，请稍后重试。");
      }
    },
  };

  return controller;
}

const root = typeof document === "undefined" ? undefined : document.querySelector<HTMLElement>("#root");
if (root) {
  void createPopupController({ root, messageClient: new ChromeMessageClient() }).load();
}
