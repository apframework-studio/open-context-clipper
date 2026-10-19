import type { ChromePort } from "../../src/background/service-worker";
import type { ExtractedCapture } from "../../src/shared/models";
import type { HistoryRetentionSetting } from "../../src/shared/messages";

export interface FakeChromePort extends ChromePort {
  calls: string[];
  activeTab: { id?: number; url?: string };
  extraction: ExtractedCapture;
  failure?: Error;
  historySettings?: HistoryRetentionSetting;
}

export function createFakeChromePort(extraction: ExtractedCapture): FakeChromePort {
  const port: FakeChromePort = {
    calls: [],
    activeTab: { id: 17 },
    extraction,
    async getHistoryRetentionSetting() {
      port.calls.push("getHistoryRetentionSetting");
      if (port.failure) throw port.failure;
      return port.historySettings;
    },
    async setHistoryRetentionSetting(setting) {
      port.calls.push("setHistoryRetentionSetting");
      if (port.failure) throw port.failure;
      port.historySettings = setting;
    },
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
