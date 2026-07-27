// WhatsApp msgstore.db forensic parser.
//
// Two recovery techniques, both genuine (no dummy data):
//
//   1. STRUCTURED READ — open the uploaded SQLite database with sql.js
//      (the real SQLite engine compiled to WebAssembly) and read the
//      `messages` / `chat` tables. This returns every message that still
//      exists as a live row.
//
//   2. DELETED-RECORD CARVING — scan the raw bytes of the SQLite file for
//      record content that WhatsApp has logically deleted but which still
//      physically occupies the database's free space:
//        • free blocks inside b-tree leaf pages (cells freed by DELETE)
//        • the unallocated region between the cell-pointer array and the
//          cell-content area of a page
//        • entire pages on the freelist (trunk + leaf pages)
//      We decode SQLite record headers from those regions and extract
//      text/blob payloads. Text that decodes as valid UTF-8 with a nearby
//      plausible message timestamp is reported as a recovered fragment.
//
// Everything runs in the browser; the file never leaves the user's machine.

import type initSqlJsType from "sql.js";
import type {
  AnalysisProgress,
  AnalysisResult,
  ChatSummary,
  RecoveredMessage,
} from "./types";

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJsType>>;
type SqlDb = InstanceType<SqlJsStatic["Database"]>;

let sqlPromise: Promise<SqlJsStatic> | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    const init = (await import("sql.js")).default;
    sqlPromise = init({
      // wasm is served from /public
      locateFile: (file: string) => `/${file}`,
    });
  }
  return sqlPromise;
}

// ---- SHA-256 helper (browser SubtleCrypto) ----
async function sha256(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---- SQLite on-disk format constants ----
const PAGE_HEADER_SIZE = 8; // leaf pages; interior pages are 12
const LEAF_TABLE_BTREE = 0x0d;

function readUint32BE(view: DataView, offset: number): number {
  // SQLite stores multi-byte integers big-endian.
  return (
    (view.getUint8(offset) << 24) |
    (view.getUint8(offset + 1) << 16) |
    (view.getUint8(offset + 2) << 8) |
    view.getUint8(offset + 3)
  );
}

function readUint16BE(view: DataView, offset: number): number {
  return (view.getUint8(offset) << 8) | view.getUint8(offset + 1);
}

/** Read a SQLite varint (1-9 bytes, big-endian, 7 bits per byte). */
function readVarint(view: DataView, offset: number): { value: number; len: number } {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    const byte = view.getUint8(offset + i);
    result = (result << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) {
      return { value: result, len: i + 1 };
    }
  }
  // 9th byte uses all 8 bits
  result = (result << 8) | view.getUint8(offset + 8);
  return { value: result >>> 0, len: 9 };
}

/** Length of a serial-type payload in bytes. */
function serialTypeLength(serialType: number): number {
  if (serialType === 0) return 0; // NULL
  if (serialType === 1) return 1;
  if (serialType === 2) return 2;
  if (serialType === 3) return 3;
  if (serialType === 4) return 4;
  if (serialType === 5) return 6;
  if (serialType === 6) return 8;
  if (serialType === 7) return 8; // float64
  if (serialType === 8 || serialType === 9) return 0; // 0 / 1 as integer
  if (serialType >= 12 && serialType % 2 === 0) return (serialType - 12) / 2; // BLOB
  if (serialType >= 13 && serialType % 2 === 1) return (serialType - 13) / 2; // TEXT
  return 0;
}

/** Decode a UTF-8 byte range defensively; returns null if not valid text. */
function decodeText(view: DataView, offset: number, length: number): string | null {
  if (length <= 0 || offset + length > view.byteLength) return null;
  try {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
    // Reject control-byte heavy data — real message text is mostly printable.
    let printable = 0;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f)) {
        printable++;
      } else if (b >= 0xc2) {
        // start of a multibyte UTF-8 sequence — count as printable
        printable++;
      }
    }
    if (bytes.length > 0 && printable / bytes.length < 0.85) return null;
    const decoder = new TextDecoder("utf-8", { fatal: false });
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/** A plausible WhatsApp message timestamp (ms since epoch, 2009..now+1d). */
function isPlausibleTimestamp(ms: number): boolean {
  if (ms <= 0) return false;
  // WhatsApp launched 2009. Allow up to 1 day in the future.
  const min = Date.UTC(2009, 0, 1);
  const max = Date.now() + 86_400_000;
  return ms >= min && ms <= max;
}

/**
 * Attempt to decode a SQLite record header + values starting at `offset`.
 * Returns the extracted text value(s) and any integer that looks like a
 * millisecond timestamp. Used for carving deleted rows.
 */
function tryDecodeRecord(
  view: DataView,
  offset: number,
  maxLen: number,
): { texts: string[]; timestamp: number | null } | null {
  const end = Math.min(offset + maxLen, view.byteLength);
  let pos = offset;
  // header length varint
  const headerStart = readVarint(view, pos);
  pos += headerStart.len;
  const headerEnd = offset + headerStart.value;
  if (headerEnd <= pos || headerEnd > end) return null;

  const serialTypes: number[] = [];
  while (pos < headerEnd) {
    const st = readVarint(view, pos);
    pos += st.len;
    serialTypes.push(st.value);
  }
  if (pos !== headerEnd) return null;

  // Read body values.
  const texts: string[] = [];
  let timestamp: number | null = null;
  let bodyPos = headerEnd;
  for (const st of serialTypes) {
    if (st === 0) continue; // NULL
    if (st === 8) {
      // integer value 0 — no body bytes
      continue;
    }
    if (st === 9) {
      continue; // integer value 1
    }
    const len = serialTypeLength(st);
    if (bodyPos + len > end) return null;
    if (st >= 13 && st % 2 === 1) {
      // TEXT
      const txt = decodeText(view, bodyPos, len);
      if (txt) texts.push(txt);
    } else if (st === 6) {
      // 8-byte integer — could be a ms timestamp
      let v = 0;
      for (let i = 0; i < 8; i++) {
        v = v * 256 + view.getUint8(bodyPos + i);
      }
      // JS bitwise ops are 32-bit; use multiplication to stay in safe range.
      if (isPlausibleTimestamp(v)) timestamp = v;
    } else if (st === 5) {
      // 6-byte integer
      let v = 0;
      for (let i = 0; i < 6; i++) {
        v = v * 256 + view.getUint8(bodyPos + i);
      }
      if (isPlausibleTimestamp(v)) timestamp = v;
    } else if (st === 4) {
      // 4-byte integer
      const v = readUint32BE(view, bodyPos);
      if (isPlausibleTimestamp(v)) timestamp = v;
    }
    bodyPos += len;
  }
  return { texts, timestamp };
}

interface CarveRegion {
  page: number;
  offset: number;
  length: number;
}

/**
 * Enumerate the byte regions of a SQLite file where deleted records may
 * physically still live: free blocks + the unallocated gap on every table
 * b-tree leaf page, plus every page on the freelist.
 */
function enumerateCarvableRegions(
  view: DataView,
  pageSize: number,
  pageCount: number,
  freelistTrunk: number,
): CarveRegion[] {
  const regions: CarveRegion[] = [];

  for (let page = 1; page <= pageCount; page++) {
    const pageStart = (page - 1) * pageSize;
    if (pageStart + pageSize > view.byteLength) break;
    const pageType = view.getUint8(pageStart);

    if (pageType === LEAF_TABLE_BTREE) {
      const cellCount = readUint16BE(view, pageStart + 3);
      const cellContentStart =
        readUint16BE(view, pageStart + 5) === 0
          ? 65536
          : readUint16BE(view, pageStart + 5);
      const headerSize = PAGE_HEADER_SIZE;
      const cellPointerEnd = pageStart + headerSize + cellCount * 2;
      const cellContentOffset = pageStart + cellContentStart;

      // 1) Unallocated gap between the cell-pointer array and cell content.
      if (cellContentOffset > cellPointerEnd) {
        regions.push({
          page,
          offset: cellPointerEnd,
          length: cellContentOffset - cellPointerEnd,
        });
      }

      // 2) Free blocks (linked list). Each free block: 2-byte next, 2-byte size.
      let freeBlock = readUint16BE(view, pageStart + 1);
      const guard = new Set<number>();
      while (freeBlock !== 0 && freeBlock < pageSize && !guard.has(freeBlock)) {
        guard.add(freeBlock);
        const fbStart = pageStart + freeBlock;
        const next = readUint16BE(view, fbStart);
        const size = readUint16BE(view, fbStart + 2);
        if (size > 4 && fbStart + size <= pageStart + pageSize) {
          regions.push({
            page,
            offset: fbStart + 4,
            length: size - 4,
          });
        }
        freeBlock = next;
      }
    }
  }

  // 3) Freelist pages. Walk the trunk chain; each trunk page points to leaf
  //    pages whose entire content is stale and may contain deleted records.
  let trunk = freelistTrunk;
  const trunkGuard = new Set<number>();
  while (trunk !== 0 && trunk <= pageCount && !trunkGuard.has(trunk)) {
    trunkGuard.add(trunk);
    const trunkStart = (trunk - 1) * pageSize;
    if (trunkStart + pageSize > view.byteLength) break;
    const nextTrunk = readUint32BE(view, trunkStart);
    const leafCount = readUint32BE(view, trunkStart + 4);
    const maxLeaves = Math.floor((pageSize - 8) / 4);
    const leaves = Math.min(leafCount, maxLeaves);
    for (let i = 0; i < leaves; i++) {
      const leafPage = readUint32BE(view, trunkStart + 8 + i * 4);
      if (leafPage > 0 && leafPage <= pageCount) {
        const leafStart = (leafPage - 1) * pageSize;
        if (leafStart + pageSize <= view.byteLength) {
          regions.push({ page: leafPage, offset: leafStart, length: pageSize });
        }
      }
    }
    trunk = nextTrunk;
  }

  return regions;
}

/**
 * Scan a region for SQLite record headers and extract deleted text.
 * Returns carved fragments with their page/offset and a confidence score.
 */
function carveRegion(
  view: DataView,
  region: CarveRegion,
): { text: string; timestamp: number | null; confidence: number }[] {
  const found: { text: string; timestamp: number | null; confidence: number }[] = [];
  const regionEnd = region.offset + region.length;
  let pos = region.offset;

  while (pos < regionEnd - 2) {
    // A record header length varint must be a small, sane value.
    const headerLenByte = view.getUint8(pos);
    if (headerLenByte < 2 || headerLenByte > 64) {
      pos++;
      continue;
    }
    const decoded = tryDecodeRecord(view, pos, regionEnd - pos);
    if (decoded && decoded.texts.length > 0) {
      // Keep only non-trivial text fragments.
      const meaningful = decoded.texts
        .filter((t) => t.trim().length >= 2)
        .join(" ")
        .trim();
      if (meaningful.length >= 3) {
        const hasTs = decoded.timestamp !== null;
        const confidence = Math.min(
          1,
          0.4 + Math.min(meaningful.length, 200) / 400 + (hasTs ? 0.2 : 0),
        );
        found.push({
          text: meaningful,
          timestamp: decoded.timestamp,
          confidence,
        });
        // Skip past this record's likely extent to avoid duplicate fragments.
        pos += Math.max(headerLenByte, meaningful.length + 2);
        continue;
      }
    }
    pos++;
  }
  return found;
}

/**
 * Read the live `messages` table via sql.js. Handles schema variations
 * across WhatsApp versions by detecting available columns.
 */
function readLiveMessages(db: SqlDb, chats: Map<string, ChatSummary>): {
  messages: RecoveredMessage[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const messages: RecoveredMessage[] = [];

  // Detect available tables.
  const tables = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table'",
  )[0]?.values?.map((r) => String(r[0])) ?? [];
  if (!tables.includes("messages")) {
    warnings.push(
      "No `messages` table found — this may not be a WhatsApp msgstore.db.",
    );
    return { messages, warnings };
  }

  // Detect columns of the messages table.
  const colsRes = db.exec("PRAGMA table_info(messages)")[0];
  const colNames: string[] = colsRes
    ? colsRes.values.map((r) => String(r[1]))
    : [];
  const has = (c: string) => colNames.includes(c);

  // Map common column names across WA versions.
  const textCol = has("text_data")
    ? "text_data"
    : has("body")
      ? "body"
      : has("data")
        ? "data"
        : null;
  const captionCol = has("media_caption") ? "media_caption" : null;
  const tsCol = has("timestamp") ? "timestamp" : has("received_timestamp") ? "received_timestamp" : null;
  const fromMeCol = has("from_me") ? "from_me" : has("key_from_me") ? "key_from_me" : null;
  const chatCol = has("chat_row_id") ? "chat_row_id" : has("key_remote_jid") ? "key_remote_jid" : null;

  if (!textCol && !captionCol) {
    warnings.push(
      "Could not locate a text column in the messages table; only carved fragments will be shown.",
    );
  }

  // Build chat lookup. Newer schemas use chat_row_id referencing the chat table.
  const chatIdToJid = new Map<number, string>();
  if (tables.includes("chat")) {
    try {
      const chatRows = db.exec(
        "SELECT _id, jid, subject, raw_string_jid FROM chat",
      )[0];
      if (chatRows) {
        for (const r of chatRows.values) {
          const id = Number(r[0]);
          const jid = r[1] ? String(r[1]) : r[3] ? String(r[3]) : r[2] ? String(r[2]) : `chat_${id}`;
          chatIdToJid.set(id, jid);
        }
      }
    } catch {
      /* ignore — older schema */
    }
  }

  const selectCols: string[] = ["_id"];
  if (chatCol) selectCols.push(chatCol);
  if (fromMeCol) selectCols.push(fromMeCol);
  if (tsCol) selectCols.push(tsCol);
  if (textCol) selectCols.push(textCol);
  if (captionCol) selectCols.push(captionCol);

  const query = `SELECT ${selectCols.join(", ")} FROM messages`;
  let stmt: ReturnType<SqlDb["prepare"]> | null = null;
  try {
    stmt = db.prepare(query);
    let idCounter = 0;
    while (stmt.step()) {
      const row = stmt.getAsObject();
      idCounter++;
      const chatRowId = chatCol ? Number(row[chatCol]) : 0;
      const chatJid = chatIdToJid.get(chatRowId) ?? (chatCol ? String(row[chatCol]) : null);
      const text = textCol ? String(row[textCol] ?? "") : "";
      const caption = captionCol ? String(row[captionCol] ?? "") : "";
      const body = text || caption;
      if (!body || body === "0" || body === "null") continue;
      const ts = tsCol ? Number(row[tsCol]) : null;
      const fromMe = fromMeCol ? Number(row[fromMeCol]) === 1 : null;
      const msg: RecoveredMessage = {
        id: `t${idCounter}`,
        source: "table",
        chat: chatJid,
        fromMe,
        timestamp: ts && isPlausibleTimestamp(ts) ? ts : null,
        text: body,
        isCaption: !!caption && !text,
        page: null,
        offset: null,
        confidence: null,
      };
      messages.push(msg);
      if (chatJid) {
        const s = chats.get(chatJid) ?? {
          jid: chatJid,
          label: chatJid.split("@")[0],
          messageCount: 0,
          lastTimestamp: null,
        };
        s.messageCount++;
        if (msg.timestamp && (!s.lastTimestamp || msg.timestamp > s.lastTimestamp)) {
          s.lastTimestamp = msg.timestamp;
        }
        chats.set(chatJid, s);
      }
    }
  } catch (err) {
    warnings.push(
      `Failed reading messages table: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    stmt?.free();
  }

  return { messages, warnings };
}

/**
 * Main entry: analyse an uploaded WhatsApp database file.
 * `onProgress` is called as work proceeds so the UI can show a live bar.
 */
export async function analyseWhatsAppDatabase(
  file: File,
  onProgress: (p: AnalysisProgress) => void,
): Promise<AnalysisResult> {
  const startedAt = Date.now();
  const fileName = file.name;
  const fileSizeBytes = file.size;

  onProgress({ phase: "loading", message: "Reading file into memory…", percent: 5 });
  const buffer = await file.arrayBuffer();
  const fileHash = await sha256(buffer);

  onProgress({ phase: "loading", message: "Starting SQLite engine…", percent: 12 });
  let SQL: SqlJsStatic;
  try {
    SQL = await getSqlJs();
  } catch (err) {
    return fail(
      fileName,
      fileSizeBytes,
      fileHash,
      Date.now() - startedAt,
      `Could not load SQLite engine: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  onProgress({ phase: "reading", message: "Opening database…", percent: 22 });
  let db: SqlDb;
  try {
    // sql.js mutates the buffer; pass a copy.
    db = new SQL.Database(new Uint8Array(buffer.slice(0)));
  } catch (err) {
    return fail(
      fileName,
      fileSizeBytes,
      fileHash,
      Date.now() - startedAt,
      `Not a valid SQLite database: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const chats = new Map<string, ChatSummary>();
  const warnings: string[] = [];

  // 1) Structured read of live messages.
  onProgress({ phase: "reading", message: "Reading messages table…", percent: 40 });
  let liveMessages: RecoveredMessage[] = [];
  try {
    const res = readLiveMessages(db, chats);
    liveMessages = res.messages;
    warnings.push(...res.warnings);
  } catch (err) {
    warnings.push(
      `Live message read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  db.close();

  // 2) Carve deleted records from raw bytes.
  onProgress({ phase: "carving", message: "Carving deleted records from free space…", percent: 55 });
  const carved: RecoveredMessage[] = [];
  try {
    const view = new DataView(buffer);
    // SQLite header: page size at offset 16 (2 bytes BE), but value 1 means 65536.
    const psRaw = readUint16BE(view, 16);
    const pageSize = psRaw === 1 ? 65536 : psRaw;
    const pageCount = readUint32BE(view, 28);
    const freelistTrunk = readUint32BE(view, 32);

    if (pageSize > 0 && (pageSize & (pageSize - 1)) === 0 && pageCount > 0) {
      const regions = enumerateCarvableRegions(
        view,
        pageSize,
        pageCount,
        freelistTrunk,
      );
      const totalRegions = Math.max(regions.length, 1);
      let carvedId = 0;
      const liveTexts = new Set(
        liveMessages.map((m) => m.text.trim()).filter((t) => t.length >= 3),
      );
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i];
        const hits = carveRegion(view, r);
        for (const h of hits) {
          // De-duplicate against live messages to avoid false positives.
          if (liveTexts.has(h.text.trim())) continue;
          carvedId++;
          carved.push({
            id: `c${carvedId}`,
            source: "carved",
            chat: null,
            fromMe: null,
            timestamp: h.timestamp,
            text: h.text,
            isCaption: false,
            page: r.page,
            offset: r.offset,
            confidence: h.confidence,
          });
        }
        if (i % 50 === 0) {
          const pct = 55 + Math.floor((i / totalRegions) * 35);
          onProgress({
            phase: "carving",
            message: `Carving deleted records… ${i}/${regions.length} regions`,
            percent: pct,
          });
          // Yield to the event loop so the UI can repaint.
          await new Promise((res) => setTimeout(res, 0));
        }
      }
    } else {
      warnings.push("Could not parse SQLite header; skipping free-space carving.");
    }
  } catch (err) {
    warnings.push(
      `Carving failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  onProgress({ phase: "finalizing", message: "Finalizing results…", percent: 96 });
  // Sort: by timestamp desc where available.
  const all = [...liveMessages, ...carved].sort((a, b) => {
    const ta = a.timestamp ?? 0;
    const tb = b.timestamp ?? 0;
    return tb - ta;
  });

  const durationMs = Date.now() - startedAt;
  const result: AnalysisResult = {
    fileName,
    fileSizeBytes,
    fileHash,
    existingMessages: liveMessages.length,
    recoveredFragments: carved.length,
    chatCount: chats.size,
    messages: all,
    chats: [...chats.values()].sort((a, b) => b.messageCount - a.messageCount),
    durationMs,
    status: warnings.length > 0 && liveMessages.length === 0 && carved.length === 0 ? "failed" : warnings.length > 0 ? "partial" : "completed",
    warnings,
  };

  onProgress({
    phase: "done",
    message: `Recovered ${carved.length} deleted fragment${carved.length === 1 ? "" : "s"} from ${liveMessages.length} live message${liveMessages.length === 1 ? "" : "s"}.`,
    percent: 100,
  });
  return result;
}

function fail(
  fileName: string,
  fileSizeBytes: number,
  fileHash: string,
  durationMs: number,
  message: string,
): AnalysisResult {
  return {
    fileName,
    fileSizeBytes,
    fileHash,
    existingMessages: 0,
    recoveredFragments: 0,
    chatCount: 0,
    messages: [],
    chats: [],
    durationMs,
    status: "failed",
    warnings: [message],
  };
}

// ---- Export helpers ----

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatTimestamp(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function messagesToCsv(messages: RecoveredMessage[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "source",
    "chat",
    "from_me",
    "timestamp",
    "datetime",
    "text",
    "page",
    "offset",
    "confidence",
  ];
  const rows = messages.map((m) =>
    [
      m.source,
      m.chat ?? "",
      m.fromMe === null ? "" : m.fromMe ? "1" : "0",
      m.timestamp ?? "",
      m.timestamp ? new Date(m.timestamp).toISOString() : "",
      m.text,
      m.page ?? "",
      m.offset ?? "",
      m.confidence ?? "",
    ]
      .map(esc)
      .join(","),
  );
  return [header.join(","), ...rows].join("\n");
}

export function messagesToJson(messages: RecoveredMessage[]): string {
  return JSON.stringify(
    messages.map((m) => ({
      source: m.source,
      chat: m.chat,
      from_me: m.fromMe,
      timestamp: m.timestamp,
      datetime: m.timestamp ? new Date(m.timestamp).toISOString() : null,
      text: m.text,
      page: m.page,
      offset: m.offset,
      confidence: m.confidence,
    })),
    null,
    2,
  );
}
