import type { CaptureRecord, DeliveryStatus, ExtractedCapture, SaveOutcome } from "./models";

export type HistoryRetentionSetting = { days: null } | { days: 30 | 90; enabledAt: string };

export type ExtensionRequest =
  | { type: "EXTRACT_ACTIVE_TAB" }
  | { type: "SAVE_CAPTURE"; extracted: ExtractedCapture; note?: string }
  | { type: "GET_QUEUE_COUNT" }
  | { type: "LIST_CAPTURES"; status?: DeliveryStatus }
  | { type: "GET_HISTORY_SETTINGS" }
  | { type: "UPDATE_HISTORY_SETTINGS"; days: null | 30 | 90 }
  | { type: "UPDATE_CAPTURE_NOTE"; id: string; note?: string }
  | { type: "DELETE_CAPTURE"; id: string }
  | { type: "PROMOTE_DUPLICATE"; id: string }
  | { type: "MARK_CAPTURES_COMPLETE"; ids: string[] }
  | { type: "OPEN_QUEUE" }
  | { type: "OPEN_SOURCE"; url: string };

export type ExtensionResponse =
  | { ok: true; type: "EXTRACTION"; extracted: ExtractedCapture }
  | { ok: true; type: "SAVED"; outcome: SaveOutcome }
  | { ok: true; type: "QUEUE_COUNT"; count: number }
  | { ok: true; type: "CAPTURES"; records: CaptureRecord[]; cleanupWarning?: string }
  | { ok: true; type: "HISTORY_SETTINGS"; settings: HistoryRetentionSetting }
  | { ok: true; type: "RECORD"; record: CaptureRecord }
  | { ok: true; type: "OPENED" }
  | { ok: false; code: string; message: string };
