import type { CaptureRecord } from "../shared/models";

export interface SyncBatchLimits {
  maxRecords: number;
  maxBytes: number;
}

export interface CompanionBatchRequest {
  records: CaptureRecord[];
}

export interface CompanionBatchResult {
  id: string;
  status: "accepted" | "duplicate" | "rejected" | "retryable_error";
  inboxId?: string;
  message?: string;
}

export interface CompanionBatchResponse {
  results: CompanionBatchResult[];
}

export interface CompanionHealthResponse {
  status: string;
}

export interface CompanionClientOptions {
  /** The future local Companion origin, supplied only by a later explicit integration. */
  baseUrl: string;
  /** Injectable transport keeps this inactive contract testable without a running service. */
  fetch?: typeof globalThis.fetch;
}
