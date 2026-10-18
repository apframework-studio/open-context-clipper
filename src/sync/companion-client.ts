import type { CaptureRecord } from "../shared/models";
import type {
  CompanionBatchRequest,
  CompanionBatchResponse,
  CompanionBatchResult,
  CompanionClientOptions,
  CompanionHealthResponse,
  SyncBatchLimits,
} from "./types";

export type {
  CompanionBatchRequest,
  CompanionBatchResponse,
  CompanionBatchResult,
  CompanionClientOptions,
  CompanionHealthResponse,
  SyncBatchLimits,
} from "./types";

const resultStatuses = new Set<CompanionBatchResult["status"]>([
  "accepted",
  "duplicate",
  "rejected",
  "retryable_error",
]);

function jsonByteLength(request: CompanionBatchRequest): number {
  return new TextEncoder().encode(JSON.stringify(request)).byteLength;
}

function compareCaptures(left: CaptureRecord, right: CaptureRecord): number {
  return left.capture.capturedAt.localeCompare(right.capture.capturedAt) || left.id.localeCompare(right.id);
}

/**
 * Creates a deterministic, explicit-sync payload. It does not mutate records or
 * change their delivery status: a future UI/controller owns those transitions.
 */
export function selectSyncBatch(records: readonly CaptureRecord[], limits: SyncBatchLimits): CompanionBatchRequest {
  if (!Number.isInteger(limits.maxRecords) || limits.maxRecords < 1) {
    throw new Error("maxRecords must be a positive integer.");
  }
  if (!Number.isInteger(limits.maxBytes) || limits.maxBytes < 1) {
    throw new Error("maxBytes must be a positive integer.");
  }

  const candidates = records
    .filter((record) => record.delivery.status === "queued" || record.delivery.status === "failed")
    .slice()
    .sort(compareCaptures);
  const selected: CaptureRecord[] = [];

  for (const record of candidates) {
    if (selected.length === limits.maxRecords) break;
    const next = { records: [...selected, record] };
    if (jsonByteLength(next) > limits.maxBytes) break;
    selected.push(record);
  }

  return { records: selected };
}

function requireObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid Companion ${label} response.`);
  }
  return value as Record<string, unknown>;
}

function parseBatchResponse(value: unknown): CompanionBatchResponse {
  const payload = requireObject(value, "batch");
  if (!Array.isArray(payload.results)) throw new Error("Invalid Companion batch response.");

  return {
    results: payload.results.map((result) => {
      const item = requireObject(result, "batch");
      if (typeof item.id !== "string" || typeof item.status !== "string" || !resultStatuses.has(item.status as CompanionBatchResult["status"])) {
        throw new Error("Invalid Companion batch response.");
      }
      if (item.inboxId !== undefined && typeof item.inboxId !== "string") throw new Error("Invalid Companion batch response.");
      if (item.message !== undefined && typeof item.message !== "string") throw new Error("Invalid Companion batch response.");
      return {
        id: item.id,
        status: item.status as CompanionBatchResult["status"],
        ...(typeof item.inboxId === "string" ? { inboxId: item.inboxId } : {}),
        ...(typeof item.message === "string" ? { message: item.message } : {}),
      };
    }),
  };
}

function parseHealthResponse(value: unknown): CompanionHealthResponse {
  const payload = requireObject(value, "health");
  if (typeof payload.status !== "string") throw new Error("Invalid Companion health response.");
  return { status: payload.status };
}

export class CompanionClient {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: CompanionClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    if (!this.baseUrl) throw new Error("A Companion baseUrl is required.");
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async health(): Promise<CompanionHealthResponse> {
    const response = await this.fetch(`${this.baseUrl}/api/v1/health`, { method: "GET" });
    if (!response.ok) throw new Error(`Companion health request failed (${response.status}).`);
    return parseHealthResponse(await response.json());
  }

  async sendBatch(records: readonly CaptureRecord[]): Promise<CompanionBatchResponse> {
    const request: CompanionBatchRequest = { records: [...records] };
    const response = await this.fetch(`${this.baseUrl}/api/v1/captures:batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`Companion batch request failed (${response.status}).`);
    return parseBatchResponse(await response.json());
  }
}
