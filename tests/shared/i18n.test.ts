import { afterEach, describe, expect, it, vi } from "vitest";
import { ChromeLanguageStore, normalizeLanguagePreference, resolveLocale, warningText } from "../../src/shared/i18n";

afterEach(() => vi.unstubAllGlobals());

describe("UI language preferences", () => {
  it("uses Chinese for Chinese browser locales, English elsewhere, and honors overrides", () => {
    expect(resolveLocale("auto", "zh-CN")).toBe("zh-CN");
    expect(resolveLocale("auto", "zh-TW")).toBe("zh-CN");
    expect(resolveLocale("auto", "fr-FR")).toBe("en");
    expect(resolveLocale("en", "zh-CN")).toBe("en");
    expect(normalizeLanguagePreference("unsupported")).toBe("auto");
  });

  it("stores an explicit choice in Chrome local storage and reads it after reopening", async () => {
    const state: Record<string, unknown> = {};
    vi.stubGlobal("chrome", { storage: { local: {
      async get(key: string) { return { [key]: state[key] }; },
      async set(value: Record<string, unknown>) { Object.assign(state, value); },
    } } });
    const first = new ChromeLanguageStore();
    expect(await first.get()).toBe("auto");
    await first.set("en");
    expect(await new ChromeLanguageStore().get()).toBe("en");
    state.uiLanguage = "broken";
    expect(await new ChromeLanguageStore().get()).toBe("auto");
  });

  it("shows known legacy paywall warnings in English without changing the stored warning", () => {
    const legacy = "检测到登录或付费阅读提示，当前采集可能仅包含预览，正文可能不完整。请确认后保存。";
    expect(warningText("en", legacy)).toContain("The article may be incomplete");
    expect(legacy).toContain("检测到登录");
  });
});
