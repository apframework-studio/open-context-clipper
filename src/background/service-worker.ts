/// <reference types="chrome" />

import type { ExtensionRequest, ExtensionResponse, HistoryRetentionSetting } from "../shared/messages";
import type { DeliveryStatus, ExtractedCapture } from "../shared/models";
import { CaptureRepository } from "../storage/capture-repository";

export interface ChromePort {
  getActiveTab(): Promise<{ id?: number; url?: string }>;
  injectCaptureScript(tabId: number): Promise<void>;
  requestExtraction(tabId: number): Promise<ExtractedCapture>;
  setBadge(count: number): Promise<void>;
  openExtensionPage(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  getHistoryRetentionSetting(): Promise<unknown>;
  setHistoryRetentionSetting(setting: HistoryRetentionSetting): Promise<void>;
}

export type CaptureRepositoryPort = Pick<
  CaptureRepository,
  "saveConfirmed" | "list" | "updateNote" | "delete" | "promoteDuplicate" | "markCompleted" | "deleteExpiredCompleted" | "countByStatus"
>;

type BackgroundDependencies = {
  chromePort: ChromePort;
  repository: CaptureRepositoryPort;
  now?: () => Date;
};

function historySetting(value: unknown): HistoryRetentionSetting {
  if (!value || typeof value !== "object") return { days: null };
  const candidate = value as Record<string, unknown>;
  if (candidate.days === null) return { days: null };
  if ((candidate.days === 30 || candidate.days === 90) && typeof candidate.enabledAt === "string") {
    const parsed = new Date(candidate.enabledAt);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString() === candidate.enabledAt) {
      return { days: candidate.days, enabledAt: candidate.enabledAt };
    }
  }
  return { days: null };
}

function responseError(code: string, message: string): ExtensionResponse {
  return { ok: false, code, message };
}

function failureResponse(error: unknown): ExtensionResponse {
  return responseError(
    "REQUEST_FAILED",
    error instanceof Error && error.message ? error.message : "The extension request failed."
  );
}

function isExtractedCapture(value: unknown): value is ExtractedCapture {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ExtractedCapture>;
  return Boolean(
    candidate.source &&
      typeof candidate.source.originalUrl === "string" &&
      typeof candidate.source.canonicalUrl === "string" &&
      typeof candidate.source.title === "string" &&
      candidate.content &&
      typeof candidate.content.markdown === "string" &&
      typeof candidate.content.wordCount === "number" &&
      Array.isArray(candidate.content.imageUrls) &&
      candidate.content.imageUrls.every((url) => typeof url === "string") &&
      candidate.capture &&
      typeof candidate.capture.capturedAt === "string" &&
      typeof candidate.capture.extractor === "string" &&
      typeof candidate.capture.contentHash === "string" &&
      Array.isArray(candidate.capture.warnings) &&
      candidate.capture.warnings.every((warning) => typeof warning === "string")
  );
}

function isDeliveryStatus(value: unknown): value is DeliveryStatus {
  return value === "queued" || value === "duplicate" || value === "syncing" || value === "synced" || value === "failed";
}

function isRestrictedBrowserPage(url: string): boolean {
  return /^(?:chrome|chrome-extension|chrome-search|chrome-untrusted|devtools|about):/i.test(url);
}

function isRestrictedInjectionError(error: unknown): boolean {
  return error instanceof Error && /cannot access[^\n]*(?:chrome(?:-extension|-search|-untrusted)?|devtools|about):/i.test(error.message);
}

function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") return false;
  const request = value as Record<string, unknown>;
  switch (request.type) {
    case "EXTRACT_ACTIVE_TAB":
    case "GET_QUEUE_COUNT":
    case "GET_HISTORY_SETTINGS":
    case "OPEN_QUEUE":
      return true;
    case "SAVE_CAPTURE":
      return isExtractedCapture(request.extracted) && (request.note === undefined || typeof request.note === "string");
    case "LIST_CAPTURES":
      return request.status === undefined || isDeliveryStatus(request.status);
    case "UPDATE_CAPTURE_NOTE":
      return typeof request.id === "string" && (request.note === undefined || typeof request.note === "string");
    case "DELETE_CAPTURE":
    case "PROMOTE_DUPLICATE":
      return typeof request.id === "string";
    case "MARK_CAPTURES_COMPLETE":
      return Array.isArray(request.ids) && request.ids.length > 0 && request.ids.every((id) => typeof id === "string" && id.length > 0);
    case "OPEN_SOURCE":
      return typeof request.url === "string";
    case "UPDATE_HISTORY_SETTINGS":
      return request.days === null || request.days === 30 || request.days === 90;
    default:
      return false;
  }
}

async function refreshQueuedBadge({ chromePort, repository }: BackgroundDependencies): Promise<void> {
  const counts = await repository.countByStatus();
  await chromePort.setBadge(counts.queued);
}

export function createBackgroundController(deps: BackgroundDependencies) {
  let retentionQueue: Promise<void> = Promise.resolve();
  const serializeRetention = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = retentionQueue.then(operation);
    retentionQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  return {
    async handle(request: ExtensionRequest): Promise<ExtensionResponse> {
      try {
        switch (request.type) {
          case "EXTRACT_ACTIVE_TAB": {
            const tab = await deps.chromePort.getActiveTab();
            if (tab.id === undefined) {
              return responseError("NO_ACTIVE_TAB", "No active tab is available for capture.");
            }
            if (tab.url && isRestrictedBrowserPage(tab.url)) {
              return responseError("RESTRICTED_PAGE", "当前是浏览器内部页面，无法采集正文。");
            }
            try {
              await deps.chromePort.injectCaptureScript(tab.id);
            } catch (error) {
              if (isRestrictedInjectionError(error)) {
                return responseError("RESTRICTED_PAGE", "当前是浏览器内部页面，无法采集正文。");
              }
              throw error;
            }
            const extracted = await deps.chromePort.requestExtraction(tab.id);
            if (!extracted.content.markdown.trim()) {
              return responseError("EMPTY_CONTENT", "未能识别可采集的正文，请确认文章已加载后重试。");
            }
            return { ok: true, type: "EXTRACTION", extracted };
          }
          case "SAVE_CAPTURE": {
            if (!request.extracted.content.markdown.trim()) {
              return responseError("EMPTY_CONTENT", "采集正文为空，无法保存。请重新识别正文。");
            }
            const outcome = await deps.repository.saveConfirmed(request.extracted, request.note ?? "");
            await refreshQueuedBadge(deps);
            return { ok: true, type: "SAVED", outcome };
          }
          case "GET_QUEUE_COUNT": {
            const counts = await deps.repository.countByStatus();
            return { ok: true, type: "QUEUE_COUNT", count: counts.queued };
          }
          case "LIST_CAPTURES": {
            const cleanupWarning = await serializeRetention(async () => {
              try {
                const setting = historySetting(await deps.chromePort.getHistoryRetentionSetting());
                if (setting.days !== null) {
                  const cutoff = new Date((deps.now?.() ?? new Date()).getTime() - setting.days * 86_400_000).toISOString();
                  await deps.repository.deleteExpiredCompleted(cutoff, setting.enabledAt);
                }
                return undefined;
              } catch {
                return "历史记录自动清理未完成，请稍后重新打开队列。";
              }
            });
            const records = await deps.repository.list();
            return {
              ok: true,
              type: "CAPTURES",
              records: request.status === undefined ? records : records.filter((record) => record.delivery.status === request.status),
              ...(cleanupWarning ? { cleanupWarning } : {}),
            };
          }
          case "GET_HISTORY_SETTINGS":
            return serializeRetention(async () => ({
              ok: true,
              type: "HISTORY_SETTINGS",
              settings: historySetting(await deps.chromePort.getHistoryRetentionSetting()),
            }));
          case "UPDATE_HISTORY_SETTINGS": {
            if (request.days !== null && request.days !== 30 && request.days !== 90) {
              return responseError("INVALID_RETENTION", "请选择永久、30 天或 90 天。");
            }
            return serializeRetention(async () => {
              const prior = historySetting(await deps.chromePort.getHistoryRetentionSetting());
              const setting: HistoryRetentionSetting = request.days === null
                ? { days: null }
                : { days: request.days, enabledAt: prior.days === request.days ? prior.enabledAt : (deps.now?.() ?? new Date()).toISOString() };
              await deps.chromePort.setHistoryRetentionSetting(setting);
              return { ok: true, type: "HISTORY_SETTINGS", settings: setting };
            });
          }
          case "UPDATE_CAPTURE_NOTE": {
            const record = await deps.repository.updateNote(request.id, request.note ?? "");
            if (!record) return responseError("CAPTURE_NOT_FOUND", "The capture record was not found.");
            await refreshQueuedBadge(deps);
            return { ok: true, type: "RECORD", record };
          }
          case "DELETE_CAPTURE": {
            await deps.repository.delete(request.id);
            await refreshQueuedBadge(deps);
            return { ok: true, type: "CAPTURES", records: await deps.repository.list() };
          }
          case "PROMOTE_DUPLICATE": {
            const record = await deps.repository.promoteDuplicate(request.id);
            if (!record) return responseError("CAPTURE_NOT_FOUND", "The capture record was not found.");
            await refreshQueuedBadge(deps);
            return { ok: true, type: "RECORD", record };
          }
          case "MARK_CAPTURES_COMPLETE": {
            if (request.ids.length === 0) return responseError("EMPTY_SELECTION", "No captures were selected for export.");
            return serializeRetention(async () => {
              await deps.repository.markCompleted(request.ids, (deps.now?.() ?? new Date()).toISOString());
              await refreshQueuedBadge(deps);
              return { ok: true, type: "CAPTURES", records: await deps.repository.list() };
            });
          }
          case "OPEN_QUEUE":
            await deps.chromePort.openExtensionPage("queue.html");
            return { ok: true, type: "OPENED" };
          case "OPEN_SOURCE":
            await deps.chromePort.openUrl(request.url);
            return { ok: true, type: "OPENED" };
        }
      } catch (error: unknown) {
        return failureResponse(error);
      }
    },
  };
}

class ChromeApiPort implements ChromePort {
  async getHistoryRetentionSetting(): Promise<unknown> {
    const stored = await chrome.storage.local.get("historyRetention");
    return stored.historyRetention;
  }

  async setHistoryRetentionSetting(setting: HistoryRetentionSetting): Promise<void> {
    await chrome.storage.local.set({ historyRetention: setting });
  }
  async getActiveTab(): Promise<{ id?: number; url?: string }> {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? {};
  }

  async injectCaptureScript(tabId: number): Promise<void> {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  }

  async requestExtraction(tabId: number): Promise<ExtractedCapture> {
    const response: unknown = await chrome.tabs.sendMessage(tabId, { type: "EXTRACT_DOCUMENT" });
    if (isExtractedCapture(response)) return response;
    if (response && typeof response === "object" && typeof (response as { error?: unknown }).error === "string") {
      throw new Error((response as { error: string }).error);
    }
    throw new Error("The page returned an invalid extraction response.");
  }

  async setBadge(count: number): Promise<void> {
    await chrome.action.setBadgeText({ text: count === 0 ? "" : String(count) });
  }

  async openExtensionPage(path: string): Promise<void> {
    await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  }

  async openUrl(url: string): Promise<void> {
    await chrome.tabs.create({ url });
  }
}

const runtime = (globalThis as typeof globalThis & { chrome?: typeof chrome }).chrome?.runtime;
if (runtime) {
  const controller = createBackgroundController({ chromePort: new ChromeApiPort(), repository: new CaptureRepository() });
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const response = isExtensionRequest(message)
      ? controller.handle(message)
      : Promise.resolve(responseError("INVALID_REQUEST", "The extension request is invalid."));
    void response.then(sendResponse);
    return true;
  });
}
