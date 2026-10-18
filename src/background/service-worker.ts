/// <reference types="chrome" />

import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import type { DeliveryStatus, ExtractedCapture } from "../shared/models";
import { CaptureRepository } from "../storage/capture-repository";

export interface ChromePort {
  getActiveTab(): Promise<{ id?: number }>;
  injectCaptureScript(tabId: number): Promise<void>;
  requestExtraction(tabId: number): Promise<ExtractedCapture>;
  setBadge(count: number): Promise<void>;
  openExtensionPage(path: string): Promise<void>;
  openUrl(url: string): Promise<void>;
}

export type CaptureRepositoryPort = Pick<
  CaptureRepository,
  "saveConfirmed" | "list" | "updateNote" | "delete" | "promoteDuplicate" | "countByStatus"
>;

type BackgroundDependencies = {
  chromePort: ChromePort;
  repository: CaptureRepositoryPort;
};

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

function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (!value || typeof value !== "object" || typeof (value as { type?: unknown }).type !== "string") return false;
  const request = value as Record<string, unknown>;
  switch (request.type) {
    case "EXTRACT_ACTIVE_TAB":
    case "GET_QUEUE_COUNT":
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
    case "OPEN_SOURCE":
      return typeof request.url === "string";
    default:
      return false;
  }
}

async function refreshQueuedBadge({ chromePort, repository }: BackgroundDependencies): Promise<void> {
  const counts = await repository.countByStatus();
  await chromePort.setBadge(counts.queued);
}

export function createBackgroundController(deps: BackgroundDependencies) {
  return {
    async handle(request: ExtensionRequest): Promise<ExtensionResponse> {
      try {
        switch (request.type) {
          case "EXTRACT_ACTIVE_TAB": {
            const tab = await deps.chromePort.getActiveTab();
            if (tab.id === undefined) {
              return responseError("NO_ACTIVE_TAB", "No active tab is available for capture.");
            }
            await deps.chromePort.injectCaptureScript(tab.id);
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
            const records = await deps.repository.list();
            return {
              ok: true,
              type: "CAPTURES",
              records: request.status === undefined ? records : records.filter((record) => record.delivery.status === request.status),
            };
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
  async getActiveTab(): Promise<{ id?: number }> {
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
