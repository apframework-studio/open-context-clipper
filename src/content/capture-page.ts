import { extractCaptureFromDocument } from "../extraction/article-extractor";

const registration = globalThis as typeof globalThis & { __ocfCapturePageListenerRegistered?: boolean };
type CaptureRequest = { type?: string };
type ChromeRuntime = {
  onMessage: {
    addListener(listener: (message: CaptureRequest, sender: unknown, sendResponse: (response: unknown) => void) => boolean | undefined): void;
  };
};
const runtime = (globalThis as typeof globalThis & { chrome: { runtime: ChromeRuntime } }).chrome.runtime;

if (!registration.__ocfCapturePageListenerRegistered) {
  registration.__ocfCapturePageListenerRegistered = true;
  runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "EXTRACT_DOCUMENT") return undefined;

    void extractCaptureFromDocument(document, location.href)
      .then(sendResponse)
      .catch((error: unknown) => sendResponse({ error: error instanceof Error ? error.message : String(error) }));
    return true;
  });
}
