export type DeliveryStatus = "queued" | "duplicate" | "syncing" | "synced" | "failed";

export interface SourceMetadata {
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  author?: string;
  siteName?: string;
  publishedAt?: string;
  language?: string;
}

export interface CapturedContent {
  markdown: string;
  excerpt?: string;
  wordCount: number;
  imageUrls: string[];
}

export interface ExtractedCapture {
  source: SourceMetadata;
  content: CapturedContent;
  capture: {
    capturedAt: string;
    extractor: "readability" | "site-adapter" | "fallback";
    contentHash: string;
    warnings: string[];
  };
}

export interface CaptureRecord extends ExtractedCapture {
  schemaVersion: 1;
  id: string;
  user: { note?: string };
  delivery: {
    status: DeliveryStatus;
    attempts: number;
    lastAttemptAt?: string;
    lastError?: string;
    remoteId?: string;
  };
  supersedes?: string;
  duplicateOf?: string;
}

export type SaveOutcome =
  | { kind: "saved"; record: CaptureRecord }
  | { kind: "unchanged-duplicate"; record: CaptureRecord }
  | { kind: "updated-unsynced"; record: CaptureRecord }
  | { kind: "new-version"; record: CaptureRecord }
  | { kind: "duplicate-candidate"; record: CaptureRecord };
