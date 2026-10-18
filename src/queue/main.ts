import "./styles.css";

import { downloadText, recordToMarkdown, recordsToJson } from "./export";
import type { ExtensionRequest, ExtensionResponse } from "../shared/messages";
import type { CaptureRecord, DeliveryStatus } from "../shared/models";

export interface QueueMessageClient {
  send(request: ExtensionRequest): Promise<ExtensionResponse>;
}

export interface QueueController {
  load(): Promise<void>;
  filter(status?: DeliveryStatus): void;
  updateNote(id: string, note: string): Promise<void>;
  remove(id: string): Promise<void>;
  promoteDuplicate(id: string): Promise<void>;
  openSource(id: string): Promise<void>;
  exportOne(id: string): void;
  exportSelected(): void;
}

type Download = (content: string, filename: string, mimeType: string) => void;

type QueueDependencies = {
  root: HTMLElement;
  messageClient: QueueMessageClient;
  download?: Download;
};

const statusLabels: Record<DeliveryStatus, string> = {
  queued: "待同步",
  duplicate: "重复候选",
  syncing: "同步中",
  synced: "已同步",
  failed: "失败",
};

const summaryStatuses: DeliveryStatus[] = ["queued", "duplicate", "failed"];

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

function statusPill(document: Document, status: DeliveryStatus): HTMLElement {
  const pill = element(document, "span", statusLabels[status]);
  pill.className = `status-pill status-${status}`;
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

export function createQueueController({ root, messageClient, download = downloadText }: QueueDependencies): QueueController {
  let records: CaptureRecord[] = [];
  let activeStatus: DeliveryStatus | undefined;
  let notice = "";
  const selected = new Set<string>();

  const visibleRecords = () => records.filter((record) => activeStatus === undefined || record.delivery.status === activeStatus);
  const recordFor = (id: string) => records.find((record) => record.id === id);

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
    const navigationItems: Array<{ label: string; status?: DeliveryStatus; count: number }> = [
      { label: "收件箱", count: records.length },
      { label: "待整理", status: "queued", count: records.filter((record) => record.delivery.status === "queued").length },
      { label: "重复候选", status: "duplicate", count: records.filter((record) => record.delivery.status === "duplicate").length },
      { label: "已完成", status: "synced", count: records.filter((record) => record.delivery.status === "synced").length },
    ];
    navigationItems.forEach((item) => {
      const button = element(document, "button") as HTMLButtonElement;
      button.type = "button";
      button.className = "queue-nav-item";
      if (item.status === activeStatus || (item.status === undefined && activeStatus === undefined)) button.classList.add("is-active");
      button.append(element(document, "span", item.label), element(document, "strong", `${item.count}`));
      button.addEventListener("click", () => controller.filter(item.status));
      navigation.append(button);
    });
    rail.append(navigation);
    rail.append(element(document, "p", "数据仅保存在此设备"));

    const workspace = element(document, "main");
    workspace.className = "queue-workspace";
    const hero = element(document, "header");
    hero.className = "queue-hero";
    const eyebrow = element(document, "span", "本地优先 · 离线整理");
    eyebrow.className = "queue-kicker";
    const heroCopy = element(document, "div");
    heroCopy.append(eyebrow, element(document, "h1", "收件箱"), element(document, "p", "从已保存的网页里，决定下一步要整理什么。"));
    const exportButton = element(document, "button", "导出已选 JSON") as HTMLButtonElement;
    exportButton.type = "button";
    exportButton.className = "queue-export-action";
    exportButton.addEventListener("click", () => controller.exportSelected());
    hero.append(heroCopy, exportButton);
    workspace.append(hero);

    const summary = element(document, "div");
    summary.className = "queue-summary";
    const total = element(document, "div");
    total.className = "queue-stat";
    total.append(element(document, "span", "全部记录"), element(document, "strong", `${records.length}`));
    summary.append(total);
    summaryStatuses.forEach((status) => {
      const count = records.filter((record) => record.delivery.status === status).length;
      const stat = element(document, "div");
      stat.className = `queue-stat queue-stat-${status}`;
      stat.append(element(document, "span", statusLabels[status]), element(document, "strong", `${count}`));
      summary.append(stat);
    });
    workspace.append(summary);

    const visible = visibleRecords();
    const focusRecord = visible.find((record) => record.delivery.status === "queued" || record.delivery.status === "failed") ?? visible[0];
    if (focusRecord) {
      const focus = element(document, "section");
      focus.className = "queue-focus";
      const focusCopy = element(document, "div");
      focusCopy.append(element(document, "span", "下一条待整理"));
      focusCopy.lastElementChild!.className = "focus-kicker";
      focusCopy.append(element(document, "h2", focusRecord.source.title));
      focusCopy.append(element(document, "p", `${hostname(focusRecord.source.originalUrl)} · ${focusRecord.content.wordCount} 字`));
      const focusAction = element(document, "button", "打开原文") as HTMLButtonElement;
      focusAction.type = "button";
      focusAction.className = "focus-action";
      focusAction.addEventListener("click", () => void controller.openSource(focusRecord.id));
      focus.append(focusCopy, focusAction);
      workspace.append(focus);
    }

    if (notice) {
      const message = element(document, "p", notice);
      message.className = "queue-notice";
      workspace.append(message);
    }

    const list = element(document, "div");
    list.className = "capture-list";
    if (visible.length === 0) list.append(element(document, "p", "当前筛选条件下没有采集记录。"));

    for (const [index, record] of visible.entries()) {
      const row = element(document, "article");
      row.className = "capture-row";
      row.dataset.captureId = record.id;
      const selection = element(document, "input") as HTMLInputElement;
      selection.type = "checkbox";
      selection.checked = selected.has(record.id);
      selection.setAttribute("aria-label", `选择 ${record.source.title}`);
      selection.addEventListener("change", () => {
        if (selection.checked) selected.add(record.id);
        else selected.delete(record.id);
      });
      const cardHeader = element(document, "div");
      cardHeader.className = "capture-card-header";
      const captureIndex = element(document, "span", `${String(index + 1).padStart(2, "0")}`);
      captureIndex.className = "capture-index";
      const main = element(document, "div");
      main.className = "capture-main";
      const heading = element(document, "h2", record.source.title);
      const summary = element(
        document,
        "p",
        `${hostname(record.source.originalUrl)} · ${record.capture.capturedAt.slice(0, 10)} · ${record.content.wordCount} 字 · ${statusLabels[record.delivery.status]}`,
      );
      summary.className = "capture-meta";
      main.append(heading, summary);
      cardHeader.append(selection, captureIndex, main, statusPill(document, record.delivery.status));
      const excerpt = element(document, "p", textExcerpt(record));
      excerpt.className = "capture-excerpt";
      const note = element(document, "textarea") as HTMLTextAreaElement;
      note.value = record.user.note ?? "";
      note.maxLength = 280;
      note.placeholder = "备注（可选）";
      note.setAttribute("aria-label", `${record.source.title} 的备注`);
      const noteEditor = element(document, "details");
      noteEditor.className = "capture-note-editor";
      noteEditor.append(element(document, "summary", "添加或编辑备注"));
      const noteEditorContent = element(document, "div");
      noteEditorContent.className = "note-editor-content";
      const actions = element(document, "div");
      actions.className = "capture-actions";
      const open = element(document, "button", "打开来源") as HTMLButtonElement;
      open.type = "button";
      open.addEventListener("click", () => void controller.openSource(record.id));
      const saveNote = element(document, "button", "保存备注") as HTMLButtonElement;
      saveNote.type = "button";
      saveNote.className = "save-note-action";
      saveNote.addEventListener("click", () => void controller.updateNote(record.id, note.value));
      noteEditorContent.append(note, saveNote);
      noteEditor.append(noteEditorContent);
      actions.append(open);

      const moreActions = element(document, "details");
      moreActions.className = "capture-more-actions";
      moreActions.append(element(document, "summary", "更多操作"));
      const moreActionsContent = element(document, "div");
      moreActionsContent.className = "more-actions-content";
      if (record.delivery.status === "duplicate") {
        const promote = element(document, "button", "提升为独立记录") as HTMLButtonElement;
        promote.type = "button";
        promote.addEventListener("click", () => void controller.promoteDuplicate(record.id));
        moreActionsContent.append(promote);
      }
      const exportOne = element(document, "button", "导出 Markdown") as HTMLButtonElement;
      exportOne.type = "button";
      exportOne.addEventListener("click", () => controller.exportOne(record.id));
      const remove = element(document, "button", "删除") as HTMLButtonElement;
      remove.type = "button";
      remove.className = "danger-action";
      remove.addEventListener("click", () => {
        if (!document.defaultView?.confirm(`确定删除“${record.source.title}”吗？此操作无法撤销。`)) return;
        void controller.remove(record.id);
      });
      moreActionsContent.append(exportOne, remove);
      moreActions.append(moreActionsContent);
      actions.append(moreActions);
      row.append(cardHeader, excerpt, noteEditor, actions);
      list.append(row);
    }
    workspace.append(list);
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
        selected.clear();
        records.filter((record) => record.delivery.status !== "duplicate").forEach((record) => selected.add(record.id));
        render();
      } catch {
        notice = "读取本地采集队列失败，请稍后重试。";
        records = [];
        render();
      }
    },

    filter(status) {
      activeStatus = status;
      render();
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

    exportOne(id) {
      const record = recordFor(id);
      if (!record) return;
      download(recordToMarkdown(record), `ocf-capture-${record.id}.md`, "text/markdown");
      notice = "已开始导出 Markdown。";
      render();
    },

    exportSelected() {
      const exportable = records.filter((record) => selected.has(record.id) && record.delivery.status !== "duplicate");
      if (exportable.length === 0) {
        notice = "没有可导出的已选记录；重复候选需要先提升为独立记录。";
        render();
        return;
      }
      download(recordsToJson(exportable), "ocf-captures.json", "application/json");
      notice = `已开始导出 ${exportable.length} 条记录。`;
      render();
    },
  };

  return controller;
}

const root = typeof document === "undefined" ? undefined : document.querySelector<HTMLElement>("#root");
if (root) {
  void createQueueController({ root, messageClient: new ChromeMessageClient() }).load();
}
