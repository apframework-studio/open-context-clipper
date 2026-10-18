import { JSDOM } from "jsdom";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __ocfCapturePageListenerRegistered?: boolean }).__ocfCapturePageListenerRegistered;
  vi.resetModules();
});

it("returns an extraction error for a page without body content", async () => {
  const dom = new JSDOM("<body></body>", { url: "https://example.com/empty" });
  type Listener = (message: { type: string }, sender: unknown, sendResponse: (response: unknown) => void) => boolean | undefined;
  let listener!: Listener;
  vi.stubGlobal("chrome", { runtime: { onMessage: { addListener(value: Listener) { listener = value; } } } });
  vi.stubGlobal("document", dom.window.document);
  vi.stubGlobal("location", dom.window.location);
  await import("../../src/content/capture-page");

  const response = await new Promise((resolve) => listener({ type: "EXTRACT_DOCUMENT" }, {}, resolve));
  expect(response).toEqual({ error: expect.stringMatching(/未能识别.*正文/) });
});
