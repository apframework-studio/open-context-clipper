import type { CaptureRecord } from "../shared/models";
import { strToU8, zipSync } from "fflate";
import { t, type Locale } from "../shared/i18n";

export function recordToMarkdown(record: CaptureRecord, locale: Locale = "zh-CN"): string {
  const separator = locale === "en" ? ": " : "：";
  const metadata = [
    `- ${t(locale, "exportSource")}${separator}${record.source.originalUrl}`,
    `- ${t(locale, "exportCapturedAt")}${separator}${record.capture.capturedAt}`,
    ...(record.source.author ? [`- ${t(locale, "exportAuthor")}${separator}${record.source.author}`] : []),
    ...(record.user.note ? [`- ${t(locale, "exportNote")}${separator}${record.user.note}`] : []),
  ];

  return [`# ${record.source.title}`, "", ...metadata, "", "---", "", record.content.markdown].join("\n");
}

export function recordsToJson(records: CaptureRecord[]): string {
  return JSON.stringify(records, null, 2);
}

function safeFilename(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "-")
    .replace(/\.\./g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/g, "") || "article";
}

export function recordsToZip(records: CaptureRecord[], locale: Locale = "zh-CN"): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "captures.json": strToU8(recordsToJson(records)),
  };
  for (const record of records) {
    const title = safeFilename(record.source.title);
    const id = safeFilename(record.id);
    files[`articles/${title}-${id}.md`] = strToU8(recordToMarkdown(record, locale));
  }
  return zipSync(files, { level: 6 });
}

export function downloadFile(content: string | Uint8Array, filename: string, mimeType: string): void {
  const blob = new Blob([typeof content === "string" ? content : new Uint8Array(content)], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function downloadText(content: string, filename: string, mimeType: string): void {
  downloadFile(content, filename, mimeType);
}
