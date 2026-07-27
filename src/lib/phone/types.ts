// Shared types for the multi-source phone recovery engine.

export type SourceType =
  | "whatsapp"
  | "contacts"
  | "sms"
  | "calllog"
  | "generic_sqlite"
  | "sms_xml"
  | "vcf"
  | "photos_metadata"
  | "browser_history"
  | "notes"
  | "calendar"
  | "telegram"
  | "signal"
  | "any_file";

export type ItemSource = "table" | "carved";

export interface RecoveredItem {
  id: string;
  source: ItemSource;
  /** Which data category this item belongs to (contacts, messages, calls, etc.) */
  category: string;
  /** Human-readable title/summary for display */
  title: string;
  /** Secondary display text */
  subtitle: string | null;
  /** Main body content (message text, contact name, etc.) */
  text: string;
  /** Structured fields specific to the item type */
  fields: Record<string, string | null>;
  /** Timestamp in ms since epoch, if recoverable */
  timestamp: number | null;
  /** For carved items: SQLite page + offset where the fragment was found */
  page: number | null;
  offset: number | null;
  /** Confidence 0-1 for carved fragments */
  confidence: number | null;
}

export interface RecoverySource {
  key: SourceType;
  label: string;
  description: string;
  icon: string;
  /** Accepted file extensions */
  accept: string;
  /** Common file names from Android phones */
  commonFiles: string[];
  /** How to obtain this file from a phone */
  extractionGuide: string;
  accent: string;
}

export interface AnalysisResult {
  sourceType: SourceType;
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;
  existingItems: number;
  recoveredFragments: number;
  categoryCount: number;
  items: RecoveredItem[];
  durationMs: number;
  status: "completed" | "partial" | "failed";
  warnings: string[];
  /** Summary counts per category */
  categorySummary: { category: string; live: number; recovered: number }[];
}

export interface RecoverySessionRecord {
  id: string;
  sourceType: string;
  fileName: string;
  fileSizeBytes: number;
  existingItems: number;
  recoveredFragments: number;
  categoryCount: number;
  durationMs: number;
  status: "completed" | "partial" | "failed";
  fileHash: string | null;
  note: string | null;
  createdAt: string;
}

export interface SavedRecovery {
  session: RecoverySessionRecord;
  items: RecoveredItem[];
}

export interface RecoveryStats {
  totalSessions: number;
  totalLiveItems: number;
  totalRecoveredFragments: number;
  lastRecoveryAt: string | null;
}

export type AnalysisProgress = {
  phase: "loading" | "reading" | "carving" | "finalizing" | "done" | "error";
  message: string;
  percent: number;
};
