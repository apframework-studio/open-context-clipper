import type { ChromePort } from "../../src/background/service-worker";
import type { ExtractedCapture } from "../../src/shared/models";

export interface FakeChromePort extends ChromePort {
  calls: string[];
  activeTab: { id?: number };
  extraction: ExtractedCapture;
  failure?: Error;
}

export function createFakeChromePort(extraction: ExtractedCapture): FakeChromePort {
  const port: FakeChromePort = {
    calls: [],
    activeTab: { id: 17 },
    extraction,
    async getActiveTab() {
      port.calls.push("getActiveTab");
      if (port.failure) throw port.failure;
      return port.activeTab;
    },
    async injectCaptureScript(tabId) {
      port.calls.push(`injectCaptureScript:${tabId}`);
      if (port.failure) throw port.failure;
    },
    async requestExtraction(tabId) {
      port.calls.push(`requestExtraction:${tabId}`);
      if (port.failure) throw port.failure;
      return port.extraction;
    },
    async setBadge(count) {
      port.calls.push(`setBadge:${count}`);
      if (port.failure) throw port.failure;
    },
    async openExtensionPage(path) {
      port.calls.push(`openExtensionPage:${path}`);
      if (port.failure) throw port.failure;
    },
    async openUrl(url) {
      port.calls.push(`openUrl:${url}`);
      if (port.failure) throw port.failure;
    },
  };
  return port;
}
