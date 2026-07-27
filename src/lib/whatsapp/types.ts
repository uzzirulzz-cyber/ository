// Types for WhatsApp forensic recovery

export interface RecoveredMessage {
  /** stable id within the analysis */
  id: string;
  /** source: parsed from the live messages table, or carved from free space */
  source: "table" | "carved";
  /** chat JID or label, when known */
  chat: string | null;
  /** sender: "me" for outgoing, the remote number/name otherwise */
  fromMe: boolean | null;
  /** message timestamp in milliseconds since epoch, when recoverable */
  timestamp: number | null;
  /** message body text */
  text: string;
  /** media caption if the text came from a media_caption column */
  isCaption: boolean;
  /** for carved records: page number where the fragment was found */
  page: number | null;
  /** for carved records: byte offset within the page */
  offset: number | null;
  /** confidence score 0-1 for carved fragments */
  confidence: number | null;
}

export interface ChatSummary {
  jid: string;
  label: string;
  messageCount: number;
  lastTimestamp: number | null;
}

export interface AnalysisResult {
  fileName: string;
  fileSizeBytes: number;
  fileHash: string;
  existingMessages: number;
  recoveredFragments: number;
  chatCount: number;
  messages: RecoveredMessage[];
  chats: ChatSummary[];
  durationMs: number;
  status: "completed" | "partial" | "failed";
  warnings: string[];
}

export interface RecoverySessionRecord {
  id: string;
  fileName: string;
  fileSizeBytes: number;
  existingMessages: number;
  recoveredFragments: number;
  chatCount: number;
  durationMs: number;
  status: "completed" | "partial" | "failed";
  fileHash: string | null;
  note: string | null;
  createdAt: string;
}

/** A saved recovery session rehydrated from the database, with its messages. */
export interface SavedRecovery {
  session: RecoverySessionRecord;
  chats: ChatSummary[];
  messages: RecoveredMessage[];
}

export interface RecoveryStats {
  totalSessions: number;
  totalLiveMessages: number;
  totalRecoveredFragments: number;
  totalChats: number;
  lastRecoveryAt: string | null;
}

export type AnalysisProgress = {
  phase: "loading" | "reading" | "carving" | "finalizing" | "done" | "error";
  message: string;
  percent: number;
};
