export type Locale = "zh-CN" | "en";
export type LanguagePreference = "auto" | Locale;

export interface LanguageStore {
  get(): Promise<LanguagePreference>;
  set(value: LanguagePreference): Promise<void>;
}

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return value === "zh-CN" || value === "en" ? value : "auto";
}

export function resolveLocale(preference: LanguagePreference, browserLanguage: string): Locale {
  return preference === "auto" ? (/^zh(?:-|_|$)/i.test(browserLanguage) ? "zh-CN" : "en") : preference;
}

export class ChromeLanguageStore implements LanguageStore {
  async get(): Promise<LanguagePreference> {
    const stored = await chrome.storage.local.get("uiLanguage");
    return normalizeLanguagePreference(stored.uiLanguage);
  }

  async set(value: LanguagePreference): Promise<void> {
    await chrome.storage.local.set({ uiLanguage: value });
  }
}

const zh = {
  openQueue: "打开队列", loading: "正在识别正文…", captureArticle: "采集当前文章",
  restrictedTitle: "当前页面不可采集", restrictedReason: "Chrome 内部页面不允许插件读取正文。切换到文章网页后，再点击插件即可采集。",
  restrictedQueue: "已保存的文章可在队列中搜索、导出和管理。",
  successCount: "{message}（当前 {count} 条）", site: "来源", webpage: "网页", wordCount: "字数", remoteImages: "远程图片：", imageCount: "{count} 张",
  author: "作者", publishedAt: "发布日期", unknown: "未识别", omitted: "··· 已省略 {count} 字 ···", previewAria: "正文摘录，可滚动阅读",
  noteOptional: "备注（可选）", noteExample: "例如：面向上下文工程", saveQueue: "保存到采集队列",
  outcomeUnchanged: "这篇文章已经采集，内容没有变化。", outcomeVersion: "检测到正文变化，已保存为新版本。",
  outcomeDuplicate: "发现相同正文的另一来源，已作为重复候选保存。", outcomeUpdated: "已更新尚未同步的采集记录。",
  outcomeSaved: "已保存到采集队列", countUnavailable: "{message}，但暂时无法读取队列数量",
  extractFirst: "请先完成正文识别后再保存。", extractionFailed: "识别正文失败，请稍后重试。",
  saveFailed: "保存采集失败，请稍后重试。", openQueueFailed: "打开队列失败，请稍后重试。",
  directExportStarted: "Markdown 下载已开始，未加入队列。", directExportFailed: "Markdown 下载未能开始，请重试。",
  requestFailed: "请求失败，请稍后重试。", noActiveTab: "没有可供采集的当前标签页。",
  emptyContent: "未能识别可采集的正文，请确认文章已加载后重试。", captureNotFound: "未找到采集记录。",
  warningShort: "识别到的正文较短，请确认预览内容后保存。",
  warningPaywall: "检测到登录或付费阅读提示，当前采集可能仅包含预览，正文可能不完整。请确认后保存。",
  warningReview: "请确认预览内容后保存。",
  statusQueued: "待导出", statusDuplicate: "内容重复", statusSyncing: "同步中", statusSynced: "已同步", statusFailed: "失败",
  completedOn: "完成于 {date}", completed: "已完成", operationFailed: "操作失败，请稍后重试。",
  nothingToExport: "没有可导出的记录。", downloadHistoryFailed: "导出文件未能下载，历史记录未改变。",
  downloadInboxFailed: "导出文件未能下载，记录仍在收件箱。", reexportStarted: "已开始重新导出 {count} 条历史记录。",
  exportStarted: "已开始导出 {count} 条记录，并移入已完成。", reexportSaveFailed: "文件已开始下载，但最近导出时间未能保存，请稍后重试。",
  exportSaveFailed: "文件已开始下载，但记录未移入已完成，请稍后重试。",
  browse: "浏览", inbox: "收件箱", settings: "设置", localOnly: "数据仅保存在此设备",
  settingsKicker: "本地偏好", completedKicker: "本地历史 · 随时再导出", inboxKicker: "本地队列 · 自主导出",
  settingsSubtitle: "配置一次，之后自动整理本地历史。", inboxSubtitle: "选择文章导出，完成后自动归档。",
  completedSubtitle: "已导出的文章保留在这里，方便查找和再次下载。",
  historyRetention: "已完成记录保留期限", historyExplanation: "已完成是近期历史，方便搜索和再次导出。收件箱记录不会被自动清理。",
  retentionUnavailable: "暂时无法读取当前保留期限，请重试。", retryRead: "重试读取", autoCleanup: "自动清理",
  forever: "永久保留", keep30: "保留 30 天", keep90: "保留 90 天", saveSettings: "保存设置",
  retentionDetails: "选择 30 天或 90 天后，已完成记录会在下次打开队列时检查并清理；启用时已有的记录至少再保留所选期限。重新导出会从最近导出时间重新计算。",
  retentionCaution: "扩展只能确认下载已发起，无法确认文件已经保存。自动清理前请确认重要文章的导出文件可用。",
  language: "界面语言", languageHelp: "选择后立即应用到队列；下次打开弹窗时也会使用此语言。",
  languageAuto: "跟随浏览器", languageChinese: "简体中文", languageEnglish: "English", languageSaveFailed: "保存语言设置失败，请稍后重试。",
  searchPlaceholder: "搜索标题、来源或备注", searchAria: "搜索采集记录", exportAllAgain: "再次导出全部 ZIP", exportAll: "导出全部 ZIP",
  selectedCount: "已选 {selected} / {total} 条", selectAll: "全选当前结果", clearSelection: "清空选择",
  exportSelectedZipAgain: "再次导出所选 ZIP", exportSelectedZip: "导出所选 ZIP",
  exportSelectedJsonAgain: "再次导出所选 JSON", exportSelectedJson: "导出所选 JSON",
  noMatches: "没有匹配的文章。", emptyInbox: "收件箱为空，打开插件采集文章后会显示在这里。", emptyCompleted: "还没有已完成的文章。",
  selectRecord: "选择 {title}", words: "{count} 字", historyRecord: "历史记录", articleDetails: "文章详情",
  openSource: "打开来源", exportMarkdownAgain: "再次导出 Markdown", exportMarkdown: "导出 Markdown",
  contentPreview: "内容预览", noExcerpt: "暂无摘要", note: "备注", edit: "编辑", addNote: "添加备注",
  noteAria: "{title} 的备注", saveNote: "保存备注", delete: "删除",
  deleteConfirm: "确定删除“{title}”吗？此操作无法撤销。", selectArticle: "选择一篇文章查看详情。",
  readingQueue: "正在读取本地采集队列…", queueReadFailed: "读取本地采集队列失败，请稍后重试。",
  settingsReadFailed: "读取设置失败，请稍后重试。", settingsReadFirst: "读取当前设置后才能保存，请重试。",
  settingsSaved: "设置已保存。", settingsSaveFailed: "保存设置失败，请稍后重试。",
  noteSaved: "备注已保存。", noteSaveFailed: "保存备注失败，请稍后重试。",
  recordDeleted: "采集记录已删除。", deleteFailed: "删除采集记录失败，请稍后重试。",
  duplicatePromoted: "已提升为独立记录。", promoteFailed: "提升重复候选失败，请稍后重试。",
  sourceOpened: "页面打开后，请在该标签页再次点击插件进行采集。", sourceOpenFailed: "打开来源失败，请稍后重试。",
  noSelectedExport: "没有可导出的已选记录。", noCurrentExport: "当前视图没有可导出的记录。",
  cleanupFailed: "历史记录自动清理未完成，请稍后重新打开队列。",
  exportSource: "来源", exportCapturedAt: "采集时间", exportAuthor: "作者", exportNote: "备注",
  queueTitle: "Open Context Clipper · 采集队列",
} as const;

type MessageKey = keyof typeof zh;

const en: Record<MessageKey, string> = {
  openQueue: "Open queue", loading: "Extracting article…", captureArticle: "Capture this article",
  restrictedTitle: "This page cannot be captured", restrictedReason: "Chrome does not allow extensions to read internal pages. Open an article page and click the extension again.",
  restrictedQueue: "You can still search, export, and manage saved articles in the queue.",
  successCount: "{message} (Queue: {count})", site: "Source", webpage: "Web page", wordCount: "Words", remoteImages: "Remote images", imageCount: "{count}",
  author: "Author", publishedAt: "Published", unknown: "Unknown", omitted: "··· {count} characters omitted ···", previewAria: "Article excerpt, scroll to read",
  noteOptional: "Note (optional)", noteExample: "For example: context engineering", saveQueue: "Save to queue",
  outcomeUnchanged: "This article is already saved and has not changed.", outcomeVersion: "Article content changed; a new version was saved.",
  outcomeDuplicate: "The same content was found at another source and saved as a duplicate candidate.", outcomeUpdated: "The existing queued capture was updated.",
  outcomeSaved: "Saved to queue", countUnavailable: "{message}, but the queue count is temporarily unavailable",
  extractFirst: "Wait for extraction before saving.", extractionFailed: "Could not extract the article. Please try again.",
  saveFailed: "Could not save the article. Please try again.", openQueueFailed: "Could not open the queue. Please try again.",
  directExportStarted: "Markdown download started; this article was not added to the queue.", directExportFailed: "The Markdown download could not start. Please try again.",
  requestFailed: "The request failed. Please try again.", noActiveTab: "No active tab is available for capture.",
  emptyContent: "Could not find article content. Make sure the page has loaded and try again.", captureNotFound: "The capture was not found.",
  warningShort: "The extracted article is short. Review the preview before saving.",
  warningPaywall: "A sign-in or paywall prompt was found. The article may be incomplete; review the preview before saving.",
  warningReview: "Review the preview before saving.",
  statusQueued: "To export", statusDuplicate: "Duplicate", statusSyncing: "Syncing", statusSynced: "Synced", statusFailed: "Failed",
  completedOn: "Completed on {date}", completed: "Completed", operationFailed: "The operation failed. Please try again.",
  nothingToExport: "There are no captures to export.", downloadHistoryFailed: "The download could not start. History was not changed.",
  downloadInboxFailed: "The download could not start. Captures remain in the inbox.", reexportStarted: "Started exporting {count} completed captures again.",
  exportStarted: "Started exporting {count} captures and moved them to Completed.", reexportSaveFailed: "The download started, but the latest export time could not be saved. Please try again.",
  exportSaveFailed: "The download started, but the captures could not be moved to Completed. Please try again.",
  browse: "Browse", inbox: "Inbox", settings: "Settings", localOnly: "Data stays on this device",
  settingsKicker: "Local preferences", completedKicker: "Local history · Export again anytime", inboxKicker: "Local queue · Export on demand",
  settingsSubtitle: "Set your preferences once for automatic history cleanup.", inboxSubtitle: "Export articles; they move to Completed when the download starts.",
  completedSubtitle: "Find and download previously exported articles again.",
  historyRetention: "History retention", historyExplanation: "Completed captures are kept for searching and export. Inbox captures are never automatically deleted.",
  retentionUnavailable: "Could not read the current retention period. Please try again.", retryRead: "Retry", autoCleanup: "Automatic cleanup",
  forever: "Keep forever", keep30: "Keep for 30 days", keep90: "Keep for 90 days", saveSettings: "Save settings",
  retentionDetails: "With 30 or 90 days selected, expired completed captures are removed the next time you open the queue. Existing captures remain for at least one full selected period after you enable cleanup. Exporting again resets the period from the latest export.",
  retentionCaution: "The extension knows when a download starts, but cannot confirm that the file was saved. Check important exports before enabling cleanup.",
  language: "Language", languageHelp: "Changes apply here immediately and to the popup next time it opens.",
  languageAuto: "Follow browser", languageChinese: "简体中文", languageEnglish: "English", languageSaveFailed: "Could not save the language preference. Please try again.",
  searchPlaceholder: "Search title, source, or note", searchAria: "Search captures", exportAllAgain: "Export all again as ZIP", exportAll: "Export all as ZIP",
  selectedCount: "Selected {selected} of {total}", selectAll: "Select all results", clearSelection: "Clear selection",
  exportSelectedZipAgain: "Export selected again as ZIP", exportSelectedZip: "Export selected as ZIP",
  exportSelectedJsonAgain: "Export selected again as JSON", exportSelectedJson: "Export selected as JSON",
  noMatches: "No matching articles.", emptyInbox: "Your inbox is empty. Capture an article to see it here.", emptyCompleted: "No completed articles yet.",
  selectRecord: "Select {title}", words: "{count} words", historyRecord: "History record", articleDetails: "Article details",
  openSource: "Open source", exportMarkdownAgain: "Export Markdown again", exportMarkdown: "Export Markdown",
  contentPreview: "Content preview", noExcerpt: "No excerpt available", note: "Note", edit: "Edit", addNote: "Add note",
  noteAria: "Note for {title}", saveNote: "Save note", delete: "Delete",
  deleteConfirm: "Delete “{title}”? This cannot be undone.", selectArticle: "Select an article to view details.",
  readingQueue: "Reading your local queue…", queueReadFailed: "Could not read the local queue. Please try again.",
  settingsReadFailed: "Could not read settings. Please try again.", settingsReadFirst: "Read the current settings before saving. Please try again.",
  settingsSaved: "Settings saved.", settingsSaveFailed: "Could not save settings. Please try again.",
  noteSaved: "Note saved.", noteSaveFailed: "Could not save the note. Please try again.",
  recordDeleted: "Capture deleted.", deleteFailed: "Could not delete the capture. Please try again.",
  duplicatePromoted: "Saved as an independent capture.", promoteFailed: "Could not promote the duplicate. Please try again.",
  sourceOpened: "After the page opens, click the extension on that tab to capture it again.", sourceOpenFailed: "Could not open the source. Please try again.",
  noSelectedExport: "No selected captures to export.", noCurrentExport: "No captures in this view to export.",
  cleanupFailed: "History cleanup did not finish. Reopen the queue to try again.",
  exportSource: "Source", exportCapturedAt: "Captured at", exportAuthor: "Author", exportNote: "Note",
  queueTitle: "Open Context Clipper · Capture Queue",
};

export function t(locale: Locale, key: MessageKey, values: Record<string, string | number> = {}): string {
  return (locale === "en" ? en[key] : zh[key]).replace(/\{(\w+)\}/g, (match, name: string) =>
    values[name] === undefined ? match : String(values[name]));
}

const legacyPaywallWarning = "检测到登录或付费阅读提示，当前采集可能仅包含预览，正文可能不完整。请确认后保存。";

export function warningText(locale: Locale, warning: string): string {
  if (warning === "content_too_short") return t(locale, "warningShort");
  if (warning === "paywall_preview" || warning === legacyPaywallWarning) return t(locale, "warningPaywall");
  if (locale === "en" && /[\u3400-\u9fff]/u.test(warning)) return t(locale, "warningReview");
  return warning;
}

export function errorText(locale: Locale, code: string): string {
  switch (code) {
    case "NO_ACTIVE_TAB": return t(locale, "noActiveTab");
    case "EMPTY_CONTENT": return t(locale, "emptyContent");
    case "CAPTURE_NOT_FOUND": return t(locale, "captureNotFound");
    default: return t(locale, "requestFailed");
  }
}
