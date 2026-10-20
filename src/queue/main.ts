import "./styles.css";

import { downloadFile, recordToMarkdown, recordsToJson, recordsToZip } from "./export";
import type { ExtensionRequest, ExtensionResponse, HistoryRetentionSetting } from "../shared/messages";
import type { CaptureRecord, DeliveryStatus } from "../shared/models";
import { ChromeLanguageStore, resolveLocale, t, type LanguagePreference, type LanguageStore, type Locale } from "../shared/i18n";

export interface QueueMessageClient {
  send(request: ExtensionRequest): Promise<ExtensionResponse>;
}

export interface QueueController {
  load(): Promise<void>;
  filter(status?: DeliveryStatus): void;
  view(view: "inbox" | "completed"): void;
  openSettings(): Promise<void>;
  updateLanguage(value: LanguagePreference): Promise<void>;
  updateHistorySettings(days: null | 30 | 90): Promise<void>;
  updateNote(id: string, note: string): Promise<void>;
  remove(id: string): Promise<void>;
  promoteDuplicate(id: string): Promise<void>;
  openSource(id: string): Promise<void>;
  exportOne(id: string): Promise<void>;
  exportSelected(): Promise<void>;
  exportSelectedZip(): Promise<void>;
  exportAllZip(): Promise<void>;
}

type Download = (content: string | Uint8Array, filename: string, mimeType: string) => void;

type QueueDependencies = {
  root: HTMLElement;
  messageClient: QueueMessageClient;
  download?: Download;
  locale?: Locale;
  browserLanguage?: string;
  languageStore?: LanguageStore;
};

const statusKeys = {
  queued: "statusQueued",
  duplicate: "statusDuplicate",
  syncing: "statusSyncing",
  synced: "statusSynced",
  failed: "statusFailed",
} as const;

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (text !== undefined) node.textContent = text;
  return node;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function textExcerpt(record: CaptureRecord): string {
  const raw = record.content.excerpt ?? record.content.markdown;
  return raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_>`~-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function completionLabel(completedAt: string, locale: Locale): string {
  const date = new Date(completedAt);
  const formatted = Number.isNaN(date.getTime()) ? completedAt : date.toLocaleString(locale, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  return t(locale, "completedOn", { date: formatted });
}

function captureDateLabel(capturedAt: string, locale: Locale): string {
  const date = new Date(capturedAt);
  return Number.isNaN(date.getTime()) ? capturedAt.slice(0, 10) : date.toLocaleDateString(locale, {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function statusPill(document: Document, status: DeliveryStatus, completed: boolean, locale: Locale): HTMLElement {
  const pill = element(document, "span", completed ? t(locale, "completed") : t(locale, statusKeys[status]));
  pill.className = `status-pill status-${completed ? "completed" : status}`;
  return pill;
}

function responseMessage(_response: ExtensionResponse, locale: Locale): string {
  return t(locale, "operationFailed");
}

class ChromeMessageClient implements QueueMessageClient {
  async send(request: ExtensionRequest): Promise<ExtensionResponse> {
    return (await chrome.runtime.sendMessage(request)) as ExtensionResponse;
  }
}

export function createQueueController({ root, messageClient, download = downloadFile, locale: initialLocale = "zh-CN", browserLanguage = "zh-CN", languageStore }: QueueDependencies): QueueController {
  let locale = initialLocale;
  let languagePreference: LanguagePreference = "auto";
  let records: CaptureRecord[] = [];
  let activeStatus: DeliveryStatus | undefined;
  let activeView: "inbox" | "completed" | "settings" = "inbox";
  let historySettings: HistoryRetentionSetting | undefined;
  let retentionDraft: "forever" | "30" | "90" | undefined;
  let savingHistorySettings = false;
  let savingLanguage = false;
  let activeRecordId: string | undefined;
  let noteEditing = false;
  let searchQuery = "";
  let notice = "";
  const selected = new Set<string>();

  const visibleRecords = () => {
    if (activeView === "settings") return [];
    const matching = records.filter((record) =>
      Boolean(record.completedAt) === (activeView === "completed") &&
      (activeStatus === undefined || record.delivery.status === activeStatus) &&
      [record.source.title, record.source.originalUrl, record.source.author ?? "", record.user.note ?? ""]
        .join(" ").toLocaleLowerCase().includes(searchQuery.toLocaleLowerCase()));
    return activeView === "completed"
      ? matching.sort((left, right) =>
        (right.completedAt ?? "").localeCompare(left.completedAt ?? "") ||
        right.capture.capturedAt.localeCompare(left.capture.capturedAt))
      : matching;
  };
  const recordFor = (id: string) => records.find((record) => record.id === id);

  const finishExport = async (
    exported: CaptureRecord[], content: string | Uint8Array, filename: string, mimeType: string,
  ): Promise<void> => {
    if (exported.length === 0) {
      notice = t(locale, "nothingToExport");
      render();
      return;
    }
    const repeatExport = exported.every((record) => Boolean(record.completedAt));
    try {
      download(content, filename, mimeType);
    } catch {
      notice = repeatExport
        ? t(locale, "downloadHistoryFailed")
        : t(locale, "downloadInboxFailed");
      render();
      return;
    }
    try {
      const response = await messageClient.send({ type: "MARK_CAPTURES_COMPLETE", ids: exported.map((record) => record.id) });
      if (!response.ok || response.type !== "CAPTURES") throw new Error("Completion could not be saved.");
      records = response.records;
      exported.forEach((record) => selected.delete(record.id));
      notice = repeatExport
        ? t(locale, "reexportStarted", { count: exported.length })
        : t(locale, "exportStarted", { count: exported.length });
    } catch {
      notice = repeatExport
        ? t(locale, "reexportSaveFailed")
        : t(locale, "exportSaveFailed");
    }
    render();
  };

  const render = () => {
    const document = root.ownerDocument;
    document.documentElement.lang = locale;
    document.title = t(locale, "queueTitle");
    const page = element(document, "section");
    page.className = "queue-page";
    const layout = element(document, "div");
    layout.className = "queue-layout";
    const rail = element(document, "aside");
    rail.className = "queue-rail";
    rail.append(element(document, "div", "O"));
    rail.lastElementChild!.className = "queue-brand";
    rail.append(element(document, "span", t(locale, "browse")));
    rail.lastElementChild!.className = "queue-rail-label";
    const navigation = element(document, "nav");
    navigation.className = "queue-navigation";
    const navigationItems: Array<{ label: string; view: "inbox" | "completed"; count: number }> = [
      { label: t(locale, "inbox"), view: "inbox", count: records.filter((record) => !record.completedAt).length },
      { label: t(locale, "completed"), view: "completed", count: records.filter((record) => Boolean(record.completedAt)).length },
    ];
    navigationItems.forEach((item) => {
      const button = element(document, "button") as HTMLButtonElement;
      button.type = "button";
      button.className = "queue-nav-item";
      if (item.view === activeView) button.classList.add("is-active");
      button.append(element(document, "span", item.label), element(document, "strong", `${item.count}`));
      button.addEventListener("click", () => controller.view(item.view));
      navigation.append(button);
    });
    rail.append(navigation);
    const settingsNav = element(document, "button", t(locale, "settings")) as HTMLButtonElement;
    settingsNav.type = "button";
    settingsNav.className = "queue-settings-nav";
    if (activeView === "settings") settingsNav.classList.add("is-active");
    settingsNav.addEventListener("click", () => void controller.openSettings());
    rail.append(settingsNav);
    rail.append(element(document, "p", t(locale, "localOnly")));

    const workspace = element(document, "main");
    workspace.className = "queue-workspace";
    const hero = element(document, "header");
    hero.className = "queue-hero";
    const eyebrow = element(document, "span", activeView === "settings" ? t(locale, "settingsKicker") : activeView === "completed" ? t(locale, "completedKicker") : t(locale, "inboxKicker"));
    eyebrow.className = "queue-kicker";
    const heroCopy = element(document, "div");
    heroCopy.append(eyebrow, element(document, "h1", activeView === "settings" ? t(locale, "settings") : activeView === "inbox" ? t(locale, "inbox") : t(locale, "completed")));
    heroCopy.append(element(document, "p", activeView === "settings"
      ? t(locale, "settingsSubtitle")
      : activeView === "inbox" ? t(locale, "inboxSubtitle")
      : t(locale, "completedSubtitle")));
    hero.append(heroCopy);
    workspace.append(hero);
    if (activeView === "settings") {
      if (notice) {
        const message = element(document, "p", notice);
        message.className = "queue-notice";
        workspace.append(message);
      }
      const languageCard = element(document, "section");
      languageCard.className = "settings-card";
      languageCard.append(element(document, "h2", t(locale, "language")));
      languageCard.append(element(document, "p", t(locale, "languageHelp")));
      const languageLabel = element(document, "label", t(locale, "language")) as HTMLLabelElement;
      languageLabel.htmlFor = "ui-language";
      const languageSelect = element(document, "select") as HTMLSelectElement;
      languageSelect.id = "ui-language";
      languageSelect.className = "language-select";
      for (const [value, label] of [
        ["auto", t(locale, "languageAuto")],
        ["zh-CN", t(locale, "languageChinese")],
        ["en", t(locale, "languageEnglish")],
      ]) {
        const option = element(document, "option", label) as HTMLOptionElement;
        option.value = value;
        languageSelect.append(option);
      }
      languageSelect.value = languagePreference;
      languageSelect.addEventListener("change", () => void controller.updateLanguage(languageSelect.value as LanguagePreference));
      const languageControls = element(document, "div");
      languageControls.className = "settings-controls";
      languageControls.append(languageLabel, languageSelect);
      languageCard.append(languageControls);
      workspace.append(languageCard);
      const card = element(document, "section");
      card.className = "settings-card";
      card.append(element(document, "h2", t(locale, "historyRetention")));
      card.append(element(document, "p", t(locale, "historyExplanation")));
      if (!historySettings) {
        card.append(element(document, "p", t(locale, "retentionUnavailable")));
        const retry = element(document, "button", t(locale, "retryRead")) as HTMLButtonElement;
        retry.type = "button";
        retry.addEventListener("click", () => void controller.openSettings());
        card.append(retry);
      } else {
        const label = element(document, "label", t(locale, "autoCleanup")) as HTMLLabelElement;
        label.htmlFor = "history-retention";
        const select = element(document, "select") as HTMLSelectElement;
        select.id = "history-retention";
        select.className = "retention-select";
        for (const [value, title] of [["forever", t(locale, "forever")], ["30", t(locale, "keep30")], ["90", t(locale, "keep90")]]) {
          const option = element(document, "option", title) as HTMLOptionElement;
          option.value = value;
          select.append(option);
        }
        select.value = retentionDraft ?? (historySettings.days === null ? "forever" : String(historySettings.days));
        select.addEventListener("change", () => {
          retentionDraft = select.value as "forever" | "30" | "90";
        });
        const save = element(document, "button", t(locale, "saveSettings")) as HTMLButtonElement;
        save.type = "button";
        save.className = "retention-save";
        save.addEventListener("click", () => void controller.updateHistorySettings(select.value === "forever" ? null : select.value === "30" ? 30 : 90));
        const controls = element(document, "div");
        controls.className = "settings-controls";
        controls.append(label, select, save);
        card.append(controls);
        card.append(element(document, "p", t(locale, "retentionDetails")));
        card.append(element(document, "p", t(locale, "retentionCaution")));
      }
      workspace.append(card);
      layout.append(rail, workspace);
      page.append(layout);
      root.replaceChildren(page);
      return;
    }
    const visible = visibleRecords();
    const toolbar = element(document, "div");
    toolbar.className = "queue-toolbar";
    const search = element(document, "input") as HTMLInputElement;
    search.type = "search";
    search.className = "queue-search";
    search.placeholder = t(locale, "searchPlaceholder");
    search.setAttribute("aria-label", t(locale, "searchAria"));
    search.value = searchQuery;
    const applySearch = () => {
      const caret = search.selectionStart;
      searchQuery = search.value.trim();
      selected.clear();
      activeRecordId = undefined;
      noteEditing = false;
      render();
      const next = root.querySelector<HTMLInputElement>(".queue-search");
      next?.focus();
      if (caret !== null) next?.setSelectionRange(caret, caret);
    };
    search.addEventListener("input", (event) => {
      if ((event as InputEvent).isComposing) return;
      applySearch();
    });
    search.addEventListener("compositionend", applySearch);
    const exportAll = element(document, "button", t(locale, activeView === "completed" ? "exportAllAgain" : "exportAll")) as HTMLButtonElement;
    exportAll.type = "button";
    exportAll.className = "queue-export-action";
    exportAll.disabled = visible.length === 0;
    exportAll.addEventListener("click", () => void controller.exportAllZip());
    toolbar.append(search, exportAll);
    workspace.append(toolbar);

    if (notice) {
      const message = element(document, "p", notice);
      message.className = "queue-notice";
      workspace.append(message);
    }

    const selectionBar = element(document, "div");
    selectionBar.className = "queue-selection-bar";
    const selectedVisible = visible.filter((record) => selected.has(record.id)).length;
    const selectionLabel = element(document, "span", t(locale, "selectedCount", { selected: selectedVisible, total: visible.length }));
    selectionLabel.className = "selection-count";
    const selectAll = element(document, "button", t(locale, "selectAll")) as HTMLButtonElement;
    selectAll.type = "button";
    selectAll.disabled = visible.length === 0;
    selectAll.addEventListener("click", () => {
      visible.forEach((record) => selected.add(record.id));
      render();
    });
    const clear = element(document, "button", t(locale, "clearSelection")) as HTMLButtonElement;
    clear.type = "button";
    clear.disabled = selectedVisible === 0;
    clear.addEventListener("click", () => { selected.clear(); render(); });
    const exportSelectedZip = element(document, "button", t(locale, activeView === "completed" ? "exportSelectedZipAgain" : "exportSelectedZip")) as HTMLButtonElement;
    exportSelectedZip.type = "button";
    exportSelectedZip.className = "selection-primary";
    exportSelectedZip.disabled = selectedVisible === 0;
    exportSelectedZip.addEventListener("click", () => void controller.exportSelectedZip());
    const exportSelectedJson = element(document, "button", t(locale, activeView === "completed" ? "exportSelectedJsonAgain" : "exportSelectedJson")) as HTMLButtonElement;
    exportSelectedJson.type = "button";
    exportSelectedJson.disabled = selectedVisible === 0;
    exportSelectedJson.addEventListener("click", () => void controller.exportSelected());
    selectionBar.append(selectionLabel, selectAll, clear, exportSelectedZip, exportSelectedJson);
    workspace.append(selectionBar);

    const content = element(document, "div");
    content.className = "queue-content";
    const list = element(document, "div");
    list.className = "capture-list";
    if (visible.length === 0) {
      const empty = element(document, "p", searchQuery ? t(locale, "noMatches") : activeView === "inbox"
        ? t(locale, "emptyInbox") : t(locale, "emptyCompleted"));
      empty.className = "queue-empty";
      list.append(empty);
    }

    const activeRecord = visible.find((record) => record.id === activeRecordId) ?? visible[0];
    if (activeRecordId !== activeRecord?.id) noteEditing = false;
    activeRecordId = activeRecord?.id;

    for (const [index, record] of visible.entries()) {
      const row = element(document, "article");
      row.className = "capture-row";
      row.dataset.captureId = record.id;
      const showRecord = () => {
        activeRecordId = record.id;
        noteEditing = false;
        render();
      };
      row.addEventListener("click", (event) => {
        if ((event.target as HTMLElement).closest("input, button")) return;
        showRecord();
      });
      const selection = element(document, "input") as HTMLInputElement;
      selection.type = "checkbox";
      selection.checked = selected.has(record.id);
      selection.setAttribute("aria-label", t(locale, "selectRecord", { title: record.source.title }));
      selection.addEventListener("change", () => {
        if (selection.checked) selected.add(record.id);
        else selected.delete(record.id);
        render();
      });
      const captureIndex = element(document, "span", `${String(index + 1).padStart(2, "0")}`);
      captureIndex.className = "capture-index";
      const main = element(document, "div");
      main.className = "capture-main";
      const heading = element(document, "button", record.source.title) as HTMLButtonElement;
      heading.type = "button";
      heading.className = "capture-title";
      heading.addEventListener("click", showRecord);
      const summary = element(
        document,
        "p",
        `${hostname(record.source.originalUrl)} · ${record.completedAt ? completionLabel(record.completedAt, locale) : captureDateLabel(record.capture.capturedAt, locale)} · ${t(locale, "words", { count: record.content.wordCount })}`,
      );
      summary.className = "capture-meta";
      main.append(heading, summary);
      row.append(selection, captureIndex, main, statusPill(document, record.delivery.status, Boolean(record.completedAt), locale));
      if (record.id === activeRecordId) row.classList.add("is-active");
      list.append(row);
    }
    content.append(list);

    const detail = element(document, "aside");
    detail.className = "queue-detail";
    if (activeRecord) {
      const detailHeader = element(document, "div");
      detailHeader.className = "detail-header";
      detailHeader.append(element(document, "span", t(locale, activeRecord.completedAt ? "historyRecord" : "articleDetails")));
      detailHeader.append(element(document, "h2", activeRecord.source.title));
      detailHeader.append(element(document, "p", `${hostname(activeRecord.source.originalUrl)} · ${captureDateLabel(activeRecord.capture.capturedAt, locale)} · ${t(locale, "words", { count: activeRecord.content.wordCount })}`));
      if (activeRecord.completedAt) {
        const completed = element(document, "p", completionLabel(activeRecord.completedAt, locale));
        completed.className = "detail-completed-at";
        detailHeader.append(completed);
      }
      const actions = element(document, "div");
      actions.className = "detail-actions";
      const open = element(document, "button", t(locale, "openSource")) as HTMLButtonElement;
      open.type = "button";
      open.addEventListener("click", () => void controller.openSource(activeRecord.id));
      const exportOne = element(document, "button", t(locale, activeView === "completed" ? "exportMarkdownAgain" : "exportMarkdown")) as HTMLButtonElement;
      exportOne.type = "button";
      exportOne.className = "detail-export";
      exportOne.addEventListener("click", () => void controller.exportOne(activeRecord.id));
      actions.append(open, exportOne);
      const excerpt = element(document, "section");
      excerpt.className = "detail-excerpt";
      excerpt.append(element(document, "h3", t(locale, "contentPreview")), element(document, "p", textExcerpt(activeRecord) || t(locale, "noExcerpt")));
      const noteSection = element(document, "section");
      noteSection.className = "detail-note";
      const noteHeader = element(document, "div");
      noteHeader.className = "detail-section-header";
      noteHeader.append(element(document, "h3", t(locale, "note")));
      const editNote = element(document, "button", t(locale, activeRecord.user.note ? "edit" : "addNote")) as HTMLButtonElement;
      editNote.type = "button";
      editNote.className = "note-edit-action";
      editNote.addEventListener("click", () => { noteEditing = true; render(); });
      noteHeader.append(editNote);
      noteSection.append(noteHeader);
      if (noteEditing) {
        const note = element(document, "textarea") as HTMLTextAreaElement;
        note.value = activeRecord.user.note ?? "";
        note.maxLength = 280;
        note.placeholder = t(locale, "noteOptional");
        note.setAttribute("aria-label", t(locale, "noteAria", { title: activeRecord.source.title }));
        const save = element(document, "button", t(locale, "saveNote")) as HTMLButtonElement;
        save.type = "button";
        save.addEventListener("click", () => void controller.updateNote(activeRecord.id, note.value));
        noteSection.append(note, save);
      } else if (activeRecord.user.note) {
        noteSection.append(element(document, "p", activeRecord.user.note));
      }
      const remove = element(document, "button", t(locale, "delete")) as HTMLButtonElement;
      remove.type = "button";
      remove.className = "danger-action";
      remove.addEventListener("click", () => {
        if (!document.defaultView?.confirm(t(locale, "deleteConfirm", { title: activeRecord.source.title }))) return;
        void controller.remove(activeRecord.id);
      });
      detail.append(detailHeader, actions, excerpt, noteSection, remove);
    } else {
      detail.append(element(document, "p", t(locale, "selectArticle")));
    }
    content.append(detail);
    workspace.append(content);
    layout.append(rail, workspace);
    page.append(layout);
    root.replaceChildren(page);
  };

  const controller: QueueController = {
    async load() {
      notice = "";
      if (languageStore) {
        languagePreference = await languageStore.get().catch(() => "auto" as const);
        locale = resolveLocale(languagePreference, browserLanguage);
      }
      root.ownerDocument.documentElement.lang = locale;
      root.replaceChildren(element(root.ownerDocument, "p", t(locale, "readingQueue")));
      try {
        const response = await messageClient.send({ type: "LIST_CAPTURES" });
        if (!response.ok || response.type !== "CAPTURES") {
          notice = responseMessage(response, locale);
          records = [];
          render();
          return;
        }
        records = response.records;
        notice = response.cleanupWarning ? t(locale, "cleanupFailed") : "";
        selected.clear();
        activeRecordId = undefined;
        render();
      } catch {
        notice = t(locale, "queueReadFailed");
        records = [];
        render();
      }
    },

    filter(status) {
      activeStatus = status;
      selected.clear();
      render();
    },

    view(view) {
      activeView = view;
      activeStatus = undefined;
      searchQuery = "";
      selected.clear();
      activeRecordId = undefined;
      noteEditing = false;
      render();
    },

    async openSettings() {
      activeView = "settings";
      historySettings = undefined;
      retentionDraft = undefined;
      notice = "";
      try {
        const response = await messageClient.send({ type: "GET_HISTORY_SETTINGS" });
        if (!response.ok || response.type !== "HISTORY_SETTINGS") throw new Error("Settings unavailable.");
        historySettings = response.settings;
        retentionDraft = response.settings.days === null ? "forever" : String(response.settings.days) as "30" | "90";
      } catch {
        notice = t(locale, "settingsReadFailed");
      }
      render();
    },

    async updateLanguage(value) {
      if (savingLanguage) return;
      savingLanguage = true;
      const select = root.querySelector<HTMLSelectElement>(".language-select");
      if (select) select.disabled = true;
      try {
        await languageStore?.set(value);
        languagePreference = value;
        locale = resolveLocale(value, browserLanguage);
        notice = "";
      } catch {
        notice = t(locale, "languageSaveFailed");
      } finally {
        savingLanguage = false;
        render();
      }
    },

    async updateHistorySettings(days) {
      if (!historySettings) {
        notice = t(locale, "settingsReadFirst");
        render();
        return;
      }
      if (savingHistorySettings) return;
      savingHistorySettings = true;
      const save = root.querySelector<HTMLButtonElement>(".retention-save");
      if (save) save.disabled = true;
      try {
        const response = await messageClient.send({ type: "UPDATE_HISTORY_SETTINGS", days });
        if (!response.ok || response.type !== "HISTORY_SETTINGS") throw new Error("Settings could not be saved.");
        historySettings = response.settings;
        retentionDraft = response.settings.days === null ? "forever" : String(response.settings.days) as "30" | "90";
        notice = t(locale, "settingsSaved");
      } catch {
        notice = t(locale, "settingsSaveFailed");
      } finally {
        savingHistorySettings = false;
        render();
      }
    },

    async updateNote(id, note) {
      try {
        const response = await messageClient.send({ type: "UPDATE_CAPTURE_NOTE", id, note: note.slice(0, 280) });
        if (!response.ok || response.type !== "RECORD") {
          notice = responseMessage(response, locale);
          render();
          return;
        }
        records = records.map((record) => (record.id === id ? response.record : record));
        noteEditing = false;
        notice = t(locale, "noteSaved");
      } catch {
        notice = t(locale, "noteSaveFailed");
      }
      render();
    },

    async remove(id) {
      try {
        const response = await messageClient.send({ type: "DELETE_CAPTURE", id });
        if (!response.ok || response.type !== "CAPTURES") {
          notice = responseMessage(response, locale);
          render();
          return;
        }
        records = response.records;
        selected.delete(id);
        notice = t(locale, "recordDeleted");
      } catch {
        notice = t(locale, "deleteFailed");
      }
      render();
    },

    async promoteDuplicate(id) {
      try {
        const response = await messageClient.send({ type: "PROMOTE_DUPLICATE", id });
        if (!response.ok || response.type !== "RECORD") {
          notice = responseMessage(response, locale);
          render();
          return;
        }
        records = records.map((record) => (record.id === id ? response.record : record));
        selected.add(id);
        notice = t(locale, "duplicatePromoted");
      } catch {
        notice = t(locale, "promoteFailed");
      }
      render();
    },

    async openSource(id) {
      const record = recordFor(id);
      if (!record) return;
      try {
        const response = await messageClient.send({ type: "OPEN_SOURCE", url: record.source.originalUrl });
        notice = response.ok && response.type === "OPENED"
          ? t(locale, "sourceOpened")
          : responseMessage(response, locale);
      } catch {
        notice = t(locale, "sourceOpenFailed");
      }
      render();
    },

    async exportOne(id) {
      const record = recordFor(id);
      if (!record) return;
      await finishExport([record], recordToMarkdown(record, locale), `ocf-capture-${record.id}.md`, "text/markdown");
    },

    async exportSelected() {
      const exportable = visibleRecords().filter((record) => selected.has(record.id));
      await finishExport(exportable, recordsToJson(exportable), "ocf-captures.json", "application/json");
    },

    async exportSelectedZip() {
      const exportable = visibleRecords().filter((record) => selected.has(record.id));
      if (exportable.length === 0) {
        notice = t(locale, "noSelectedExport");
        render();
        return;
      }
      await finishExport(exportable, recordsToZip(exportable, locale), "ocf-captures.zip", "application/zip");
    },

    async exportAllZip() {
      const exportable = visibleRecords();
      if (exportable.length === 0) {
        notice = t(locale, "noCurrentExport");
        render();
        return;
      }
      await finishExport(exportable, recordsToZip(exportable, locale), "ocf-captures.zip", "application/zip");
    },
  };

  return controller;
}

const root = typeof document === "undefined" ? undefined : document.querySelector<HTMLElement>("#root");
if (root) {
  void createQueueController({
    root, messageClient: new ChromeMessageClient(),
    languageStore: new ChromeLanguageStore(), browserLanguage: chrome.i18n.getUILanguage(),
  }).load();
}
