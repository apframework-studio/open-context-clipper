import "./styles.css";

import { downloadFile, recordToMarkdown, recordsToJson, recordsToZip } from "./export";
import type { ExtensionRequest, ExtensionResponse, HistoryRetentionSetting } from "../shared/messages";
import type { CaptureRecord, DeliveryStatus } from "../shared/models";

export interface QueueMessageClient {
  send(request: ExtensionRequest): Promise<ExtensionResponse>;
}

export interface QueueController {
  load(): Promise<void>;
  filter(status?: DeliveryStatus): void;
  view(view: "inbox" | "completed"): void;
  openSettings(): Promise<void>;
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
};

const statusLabels: Record<DeliveryStatus, string> = {
  queued: "待导出",
  duplicate: "内容重复",
  syncing: "同步中",
  synced: "已同步",
  failed: "失败",
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

function completionLabel(completedAt: string): string {
  const date = new Date(completedAt);
  const formatted = Number.isNaN(date.getTime()) ? completedAt : date.toLocaleString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  return `完成于 ${formatted}`;
}

function statusPill(document: Document, status: DeliveryStatus, completed: boolean): HTMLElement {
  const pill = element(document, "span", completed ? "已完成" : statusLabels[status]);
  pill.className = `status-pill status-${completed ? "completed" : status}`;
  return pill;
}

function responseMessage(_response: ExtensionResponse): string {
  return "操作失败，请稍后重试。";
}

class ChromeMessageClient implements QueueMessageClient {
  async send(request: ExtensionRequest): Promise<ExtensionResponse> {
    return (await chrome.runtime.sendMessage(request)) as ExtensionResponse;
  }
}

export function createQueueController({ root, messageClient, download = downloadFile }: QueueDependencies): QueueController {
  let records: CaptureRecord[] = [];
  let activeStatus: DeliveryStatus | undefined;
  let activeView: "inbox" | "completed" | "settings" = "inbox";
  let historySettings: HistoryRetentionSetting | undefined;
  let savingHistorySettings = false;
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
      notice = "没有可导出的记录。";
      render();
      return;
    }
    const repeatExport = exported.every((record) => Boolean(record.completedAt));
    try {
      download(content, filename, mimeType);
    } catch {
      notice = repeatExport
        ? "导出文件未能下载，历史记录未改变。"
        : "导出文件未能下载，记录仍在收件箱。";
      render();
      return;
    }
    try {
      const response = await messageClient.send({ type: "MARK_CAPTURES_COMPLETE", ids: exported.map((record) => record.id) });
      if (!response.ok || response.type !== "CAPTURES") throw new Error("Completion could not be saved.");
      records = response.records;
      exported.forEach((record) => selected.delete(record.id));
      notice = repeatExport
        ? `已开始重新导出 ${exported.length} 条历史记录。`
        : `已开始导出 ${exported.length} 条记录，并移入已完成。`;
    } catch {
      notice = repeatExport
        ? "文件已开始下载，但最近导出时间未能保存，请稍后重试。"
        : "文件已开始下载，但记录未移入已完成，请稍后重试。";
    }
    render();
  };

  const render = () => {
    const document = root.ownerDocument;
    const page = element(document, "section");
    page.className = "queue-page";
    const layout = element(document, "div");
    layout.className = "queue-layout";
    const rail = element(document, "aside");
    rail.className = "queue-rail";
    rail.append(element(document, "div", "O"));
    rail.lastElementChild!.className = "queue-brand";
    rail.append(element(document, "span", "浏览"));
    rail.lastElementChild!.className = "queue-rail-label";
    const navigation = element(document, "nav");
    navigation.className = "queue-navigation";
    const navigationItems: Array<{ label: string; view: "inbox" | "completed"; count: number }> = [
      { label: "收件箱", view: "inbox", count: records.filter((record) => !record.completedAt).length },
      { label: "已完成", view: "completed", count: records.filter((record) => Boolean(record.completedAt)).length },
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
    const settingsNav = element(document, "button", "设置") as HTMLButtonElement;
    settingsNav.type = "button";
    settingsNav.className = "queue-settings-nav";
    if (activeView === "settings") settingsNav.classList.add("is-active");
    settingsNav.addEventListener("click", () => void controller.openSettings());
    rail.append(settingsNav);
    rail.append(element(document, "p", "数据仅保存在此设备"));

    const workspace = element(document, "main");
    workspace.className = "queue-workspace";
    const hero = element(document, "header");
    hero.className = "queue-hero";
    const eyebrow = element(document, "span", activeView === "settings" ? "本地偏好" : activeView === "completed" ? "本地历史 · 随时再导出" : "本地队列 · 自主导出");
    eyebrow.className = "queue-kicker";
    const heroCopy = element(document, "div");
    heroCopy.append(eyebrow, element(document, "h1", activeView === "settings" ? "设置" : activeView === "inbox" ? "收件箱" : "已完成"));
    heroCopy.append(element(document, "p", activeView === "settings"
      ? "配置一次，之后自动整理本地历史。"
      : activeView === "inbox" ? "选择文章导出，完成后自动归档。"
      : "已导出的文章保留在这里，方便查找和再次下载。"));
    hero.append(heroCopy);
    workspace.append(hero);
    if (activeView === "settings") {
      if (notice) {
        const message = element(document, "p", notice);
        message.className = "queue-notice";
        workspace.append(message);
      }
      const card = element(document, "section");
      card.className = "settings-card";
      card.append(element(document, "h2", "已完成记录保留期限"));
      card.append(element(document, "p", "已完成是近期历史，方便搜索和再次导出。收件箱记录不会被自动清理。"));
      if (!historySettings) {
        card.append(element(document, "p", "暂时无法读取当前保留期限，请重试。"));
        const retry = element(document, "button", "重试读取") as HTMLButtonElement;
        retry.type = "button";
        retry.addEventListener("click", () => void controller.openSettings());
        card.append(retry);
      } else {
        const label = element(document, "label", "自动清理") as HTMLLabelElement;
        label.htmlFor = "history-retention";
        const select = element(document, "select") as HTMLSelectElement;
        select.id = "history-retention";
        select.className = "retention-select";
        for (const [value, title] of [["forever", "永久保留"], ["30", "保留 30 天"], ["90", "保留 90 天"]]) {
          const option = element(document, "option", title) as HTMLOptionElement;
          option.value = value;
          select.append(option);
        }
        select.value = historySettings.days === null ? "forever" : String(historySettings.days);
        const save = element(document, "button", "保存设置") as HTMLButtonElement;
        save.type = "button";
        save.className = "retention-save";
        save.addEventListener("click", () => void controller.updateHistorySettings(select.value === "forever" ? null : select.value === "30" ? 30 : 90));
        const controls = element(document, "div");
        controls.className = "settings-controls";
        controls.append(label, select, save);
        card.append(controls);
        card.append(element(document, "p", "选择 30 天或 90 天后，已完成记录会在下次打开队列时检查并清理；启用时已有的记录至少再保留所选期限。重新导出会从最近导出时间重新计算。"));
        card.append(element(document, "p", "扩展只能确认下载已发起，无法确认文件已经保存。自动清理前请确认重要文章的导出文件可用。"));
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
    search.placeholder = "搜索标题、来源或备注";
    search.setAttribute("aria-label", "搜索采集记录");
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
    const exportAll = element(document, "button", activeView === "completed" ? "再次导出全部 ZIP" : "导出全部 ZIP") as HTMLButtonElement;
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
    const selectionLabel = element(document, "span", `已选 ${selectedVisible} / ${visible.length} 条`);
    selectionLabel.className = "selection-count";
    const selectAll = element(document, "button", "全选当前结果") as HTMLButtonElement;
    selectAll.type = "button";
    selectAll.disabled = visible.length === 0;
    selectAll.addEventListener("click", () => {
      visible.forEach((record) => selected.add(record.id));
      render();
    });
    const clear = element(document, "button", "清空选择") as HTMLButtonElement;
    clear.type = "button";
    clear.disabled = selectedVisible === 0;
    clear.addEventListener("click", () => { selected.clear(); render(); });
    const exportSelectedZip = element(document, "button", activeView === "completed" ? "再次导出所选 ZIP" : "导出所选 ZIP") as HTMLButtonElement;
    exportSelectedZip.type = "button";
    exportSelectedZip.className = "selection-primary";
    exportSelectedZip.disabled = selectedVisible === 0;
    exportSelectedZip.addEventListener("click", () => void controller.exportSelectedZip());
    const exportSelectedJson = element(document, "button", activeView === "completed" ? "再次导出所选 JSON" : "导出所选 JSON") as HTMLButtonElement;
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
      const empty = element(document, "p", searchQuery ? "没有匹配的文章。" : activeView === "inbox"
        ? "收件箱为空，打开插件采集文章后会显示在这里。" : "还没有已完成的文章。");
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
      selection.setAttribute("aria-label", `选择 ${record.source.title}`);
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
        `${hostname(record.source.originalUrl)} · ${record.completedAt ? completionLabel(record.completedAt) : record.capture.capturedAt.slice(0, 10)} · ${record.content.wordCount} 字`,
      );
      summary.className = "capture-meta";
      main.append(heading, summary);
      row.append(selection, captureIndex, main, statusPill(document, record.delivery.status, Boolean(record.completedAt)));
      if (record.id === activeRecordId) row.classList.add("is-active");
      list.append(row);
    }
    content.append(list);

    const detail = element(document, "aside");
    detail.className = "queue-detail";
    if (activeRecord) {
      const detailHeader = element(document, "div");
      detailHeader.className = "detail-header";
      detailHeader.append(element(document, "span", activeRecord.completedAt ? "历史记录" : "文章详情"));
      detailHeader.append(element(document, "h2", activeRecord.source.title));
      detailHeader.append(element(document, "p", `${hostname(activeRecord.source.originalUrl)} · ${activeRecord.capture.capturedAt.slice(0, 10)} · ${activeRecord.content.wordCount} 字`));
      if (activeRecord.completedAt) {
        const completed = element(document, "p", completionLabel(activeRecord.completedAt));
        completed.className = "detail-completed-at";
        detailHeader.append(completed);
      }
      const actions = element(document, "div");
      actions.className = "detail-actions";
      const open = element(document, "button", "打开来源") as HTMLButtonElement;
      open.type = "button";
      open.addEventListener("click", () => void controller.openSource(activeRecord.id));
      const exportOne = element(document, "button", activeView === "completed" ? "再次导出 Markdown" : "导出 Markdown") as HTMLButtonElement;
      exportOne.type = "button";
      exportOne.className = "detail-export";
      exportOne.addEventListener("click", () => void controller.exportOne(activeRecord.id));
      actions.append(open, exportOne);
      const excerpt = element(document, "section");
      excerpt.className = "detail-excerpt";
      excerpt.append(element(document, "h3", "内容预览"), element(document, "p", textExcerpt(activeRecord) || "暂无摘要"));
      const noteSection = element(document, "section");
      noteSection.className = "detail-note";
      const noteHeader = element(document, "div");
      noteHeader.className = "detail-section-header";
      noteHeader.append(element(document, "h3", "备注"));
      const editNote = element(document, "button", activeRecord.user.note ? "编辑" : "添加备注") as HTMLButtonElement;
      editNote.type = "button";
      editNote.className = "note-edit-action";
      editNote.addEventListener("click", () => { noteEditing = true; render(); });
      noteHeader.append(editNote);
      noteSection.append(noteHeader);
      if (noteEditing) {
        const note = element(document, "textarea") as HTMLTextAreaElement;
        note.value = activeRecord.user.note ?? "";
        note.maxLength = 280;
        note.placeholder = "备注（可选）";
        note.setAttribute("aria-label", `${activeRecord.source.title} 的备注`);
        const save = element(document, "button", "保存备注") as HTMLButtonElement;
        save.type = "button";
        save.addEventListener("click", () => void controller.updateNote(activeRecord.id, note.value));
        noteSection.append(note, save);
      } else if (activeRecord.user.note) {
        noteSection.append(element(document, "p", activeRecord.user.note));
      }
      const remove = element(document, "button", "删除") as HTMLButtonElement;
      remove.type = "button";
      remove.className = "danger-action";
      remove.addEventListener("click", () => {
        if (!document.defaultView?.confirm(`确定删除“${activeRecord.source.title}”吗？此操作无法撤销。`)) return;
        void controller.remove(activeRecord.id);
      });
      detail.append(detailHeader, actions, excerpt, noteSection, remove);
    } else {
      detail.append(element(document, "p", "选择一篇文章查看详情。"));
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
      root.replaceChildren(element(root.ownerDocument, "p", "正在读取本地采集队列…"));
      try {
        const response = await messageClient.send({ type: "LIST_CAPTURES" });
        if (!response.ok || response.type !== "CAPTURES") {
          notice = responseMessage(response);
          records = [];
          render();
          return;
        }
        records = response.records;
        notice = response.cleanupWarning ?? "";
        selected.clear();
        activeRecordId = undefined;
        render();
      } catch {
        notice = "读取本地采集队列失败，请稍后重试。";
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
      notice = "";
      try {
        const response = await messageClient.send({ type: "GET_HISTORY_SETTINGS" });
        if (!response.ok || response.type !== "HISTORY_SETTINGS") throw new Error("Settings unavailable.");
        historySettings = response.settings;
      } catch {
        notice = "读取设置失败，请稍后重试。";
      }
      render();
    },

    async updateHistorySettings(days) {
      if (!historySettings) {
        notice = "读取当前设置后才能保存，请重试。";
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
        notice = "设置已保存。";
      } catch {
        notice = "保存设置失败，请稍后重试。";
      } finally {
        savingHistorySettings = false;
        render();
      }
    },

    async updateNote(id, note) {
      try {
        const response = await messageClient.send({ type: "UPDATE_CAPTURE_NOTE", id, note: note.slice(0, 280) });
        if (!response.ok || response.type !== "RECORD") {
          notice = responseMessage(response);
          render();
          return;
        }
        records = records.map((record) => (record.id === id ? response.record : record));
        noteEditing = false;
        notice = "备注已保存。";
      } catch {
        notice = "保存备注失败，请稍后重试。";
      }
      render();
    },

    async remove(id) {
      try {
        const response = await messageClient.send({ type: "DELETE_CAPTURE", id });
        if (!response.ok || response.type !== "CAPTURES") {
          notice = responseMessage(response);
          render();
          return;
        }
        records = response.records;
        selected.delete(id);
        notice = "采集记录已删除。";
      } catch {
        notice = "删除采集记录失败，请稍后重试。";
      }
      render();
    },

    async promoteDuplicate(id) {
      try {
        const response = await messageClient.send({ type: "PROMOTE_DUPLICATE", id });
        if (!response.ok || response.type !== "RECORD") {
          notice = responseMessage(response);
          render();
          return;
        }
        records = records.map((record) => (record.id === id ? response.record : record));
        selected.add(id);
        notice = "已提升为独立记录。";
      } catch {
        notice = "提升重复候选失败，请稍后重试。";
      }
      render();
    },

    async openSource(id) {
      const record = recordFor(id);
      if (!record) return;
      try {
        const response = await messageClient.send({ type: "OPEN_SOURCE", url: record.source.originalUrl });
        notice = response.ok && response.type === "OPENED"
          ? "页面打开后，请在该标签页再次点击插件进行采集。"
          : responseMessage(response);
      } catch {
        notice = "打开来源失败，请稍后重试。";
      }
      render();
    },

    async exportOne(id) {
      const record = recordFor(id);
      if (!record) return;
      await finishExport([record], recordToMarkdown(record), `ocf-capture-${record.id}.md`, "text/markdown");
    },

    async exportSelected() {
      const exportable = visibleRecords().filter((record) => selected.has(record.id));
      await finishExport(exportable, recordsToJson(exportable), "ocf-captures.json", "application/json");
    },

    async exportSelectedZip() {
      const exportable = visibleRecords().filter((record) => selected.has(record.id));
      if (exportable.length === 0) {
        notice = "没有可导出的已选记录。";
        render();
        return;
      }
      await finishExport(exportable, recordsToZip(exportable), "ocf-captures.zip", "application/zip");
    },

    async exportAllZip() {
      const exportable = visibleRecords();
      if (exportable.length === 0) {
        notice = "当前视图没有可导出的记录。";
        render();
        return;
      }
      await finishExport(exportable, recordsToZip(exportable), "ocf-captures.zip", "application/zip");
    },
  };

  return controller;
}

const root = typeof document === "undefined" ? undefined : document.querySelector<HTMLElement>("#root");
if (root) {
  void createQueueController({ root, messageClient: new ChromeMessageClient() }).load();
}
