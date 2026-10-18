import type { CaptureRecord } from "../shared/models";

export function recordToMarkdown(record: CaptureRecord): string {
  const metadata = [
    `- 来源：${record.source.originalUrl}`,
    `- 采集时间：${record.capture.capturedAt}`,
    ...(record.source.author ? [`- 作者：${record.source.author}`] : []),
    ...(record.user.note ? [`- 备注：${record.user.note}`] : []),
  ];

  return [`# ${record.source.title}`, "", ...metadata, "", "---", "", record.content.markdown].join("\n");
}

export function recordsToJson(records: CaptureRecord[]): string {
  return JSON.stringify(records, null, 2);
}

export function downloadText(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
