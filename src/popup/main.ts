import "./styles.css";

import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import type { ExtractedCapture, SaveOutcome } from "../shared/models";
import { createTextPreview } from "../shared/preview";
import { ChromeLanguageStore, errorText, resolveLocale, t, warningText, type Locale } from "../shared/i18n";

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
  locale?: Locale;
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

function field(document: Document, locale: Locale, label: string, value?: string): HTMLElement | undefined {
  if (!value) return undefined;
  const row = element(document, "p");
  row.className = "metadata-row";
  const name = element(document, "span", `${label}${locale === "en" ? ": " : "："}`);
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

function publishedDate(value: string | undefined, locale: Locale): string | undefined {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(locale, {
    year: "numeric", month: "2-digit", day: "2-digit",
    ...(value.length === 10 ? { timeZone: "UTC" } : {}),
  });
}

function messageForOutcome(outcome: SaveOutcome, locale: Locale): string {
  switch (outcome.kind) {
    case "unchanged-duplicate":
      return t(locale, "outcomeUnchanged");
    case "new-version":
      return t(locale, "outcomeVersion");
    case "duplicate-candidate":
      return t(locale, "outcomeDuplicate");
    case "updated-unsynced":
      return t(locale, "outcomeUpdated");
    case "saved":
      return t(locale, "outcomeSaved");
  }
}

function errorMessage(response: ExtensionResponse, locale: Locale): string {
  return response.ok ? t(locale, "requestFailed") : errorText(locale, response.code);
}

class ChromeMessageClient implements MessageClient {
  async send(request: ExtensionRequest): Promise<ExtensionResponse> {
    return (await chrome.runtime.sendMessage(request)) as ExtensionResponse;
  }
}

export function createPopupController({ root, messageClient, locale = "zh-CN" }: PopupDependencies): PopupController {
  root.ownerDocument.documentElement.lang = locale;
  let extracted: ExtractedCapture | undefined;
  let noteInput: HTMLInputElement | undefined;
  let primaryButton: HTMLButtonElement | undefined;

  const createQueueButton = () => {
    const button = element(root.ownerDocument, "button", t(locale, "openQueue"));
    button.type = "button";
    button.className = "secondary-action";
    button.addEventListener("click", () => void controller.openQueue());
    return button;
  };

  const renderLoading = () => {
    const state = element(root.ownerDocument, "section");
    state.className = "popup-state popup-loading";
    state.append(element(root.ownerDocument, "span", "Capture Plane"), element(root.ownerDocument, "p", t(locale, "loading")), createQueueButton());
    root.replaceChildren(state);
  };

  const renderError = (message: string) => {
    const content = element(root.ownerDocument, "section");
    content.className = "popup-state popup-error";
    content.append(element(root.ownerDocument, "p", message), createQueueButton());
    root.replaceChildren(content);
  };

  const renderRestricted = () => {
    const document = root.ownerDocument;
    const content = element(document, "section");
    content.className = "popup-state popup-restricted";
    content.append(element(document, "span", t(locale, "captureArticle")));
    content.append(element(document, "h1", t(locale, "restrictedTitle")));
    content.append(element(document, "p", t(locale, "restrictedReason")));
    content.append(element(document, "p", t(locale, "restrictedQueue")));
    const queue = createQueueButton();
    queue.className = "primary-action";
    content.append(queue);
    root.replaceChildren(content);
  };

  const renderSuccess = (message: string, count?: number) => {
    const content = element(root.ownerDocument, "section");
    content.className = "popup-state popup-success";
    const summary = count === undefined ? message : t(locale, "successCount", { message, count });
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
      metric(document, t(locale, "site"), capture.source.siteName ?? t(locale, "webpage")),
      metric(document, t(locale, "wordCount"), `${capture.content.wordCount}`),
      metric(document, t(locale, "remoteImages"), t(locale, "imageCount", { count: capture.content.imageUrls.length })),
    );
    container.append(metrics);

    const metadata = element(document, "div");
    metadata.className = "metadata metadata-details";
    [
      field(document, locale, t(locale, "author"), capture.source.author ?? t(locale, "unknown")),
      field(document, locale, t(locale, "publishedAt"), publishedDate(capture.source.publishedAt, locale) ?? t(locale, "unknown")),
    ].forEach((row) => row && metadata.append(row));
    container.append(metadata);

    const previewSection = element(document, "section");
    previewSection.className = "text-preview";
    const opening = element(document, "p", preview.opening);
    opening.className = "preview-copy preview-opening";
    previewSection.append(opening);
    if (preview.omittedCharacters > 0) {
      const omission = element(document, "p", t(locale, "omitted", { count: preview.omittedCharacters }));
      omission.className = "omission";
      const closing = element(document, "p", preview.closing);
      closing.className = "preview-copy preview-closing";
      previewSection.append(omission, closing);
    }
    const previewScroll = element(document, "div");
    previewScroll.className = "preview-scroll";
    previewScroll.tabIndex = 0;
    previewScroll.setAttribute("aria-label", t(locale, "previewAria"));
    previewScroll.append(previewSection);
    container.append(previewScroll);

    if (capture.capture.warnings.length > 0) {
      const warnings = element(document, "ul");
      warnings.className = "warnings";
      capture.capture.warnings.forEach((warning) => warnings.append(element(document, "li", warningText(locale, warning))));
      container.append(warnings);
    }

    const noteLabel = element(document, "label", t(locale, "noteOptional"));
    noteLabel.className = "note-label";
    noteLabel.htmlFor = "capture-note";
    noteInput = element(document, "input") as HTMLInputElement;
    noteInput.id = "capture-note";
    noteInput.type = "text";
    noteInput.maxLength = 280;
    noteInput.placeholder = t(locale, "noteExample");
    container.append(noteLabel, noteInput);

    const actions = element(document, "div");
    actions.className = "popup-actions";
    primaryButton = element(document, "button", t(locale, "saveQueue")) as HTMLButtonElement;
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
        if (!response.ok && response.code === "RESTRICTED_PAGE") {
          renderRestricted();
          return;
        }
        if (!response.ok || response.type !== "EXTRACTION") {
          renderError(errorMessage(response, locale));
          return;
        }
        extracted = response.extracted;
        renderPreview(extracted);
      } catch {
        renderError(t(locale, "extractionFailed"));
      }
    },

    async save(note) {
      if (!extracted) {
        renderError(t(locale, "extractFirst"));
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
          renderError(errorMessage(response, locale));
          return;
        }
        try {
          const countResponse = await messageClient.send({ type: "GET_QUEUE_COUNT" });
          if (countResponse.ok && countResponse.type === "QUEUE_COUNT") {
            renderSuccess(messageForOutcome(response.outcome, locale), countResponse.count);
            return;
          }
        } catch {
          // 保存已完成；队列计数只能作为补充信息。
        }
        renderSuccess(t(locale, "countUnavailable", { message: messageForOutcome(response.outcome, locale) }));
      } catch {
        if (primaryButton) primaryButton.disabled = false;
        renderError(t(locale, "saveFailed"));
      }
    },

    async openQueue() {
      try {
        const response = await messageClient.send({ type: "OPEN_QUEUE" });
        if (!response.ok) renderError(errorMessage(response, locale));
      } catch {
        renderError(t(locale, "openQueueFailed"));
      }
    },
  };

  return controller;
}

const root = typeof document === "undefined" ? undefined : document.querySelector<HTMLElement>("#root");
if (root) {
  void (async () => {
    const store = new ChromeLanguageStore();
    const preference = await store.get().catch(() => "auto" as const);
    const locale = resolveLocale(preference, chrome.i18n.getUILanguage());
    await createPopupController({ root, messageClient: new ChromeMessageClient(), locale }).load();
  })();
}
