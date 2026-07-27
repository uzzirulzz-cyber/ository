// Generic SQLite forensic engine.
// Opens ANY .db file with sql.js, reads all tables, and carves deleted
// records from free space. Specialized table readers extract structured
// data for contacts, SMS, call logs, WhatsApp, etc.

import type initSqlJsType from "sql.js";
import type {
  AnalysisProgress,
  AnalysisResult,
  RecoveredItem,
  SourceType,
} from "./types";

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJsType>>;
type SqlDb = InstanceType<SqlJsStatic["Database"]>;

let sqlPromise: Promise<SqlJsStatic> | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    const init = (await import("sql.js")).default;
    sqlPromise = init({ locateFile: (file: string) => `/${file}` });
  }
  return sqlPromise;
}

// ---- helpers ----

async function sha256(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readUint16BE(view: DataView, offset: number): number {
  return (view.getUint8(offset) << 8) | view.getUint8(offset + 1);
}

function readUint32BE(view: DataView, offset: number): number {
  return (view.getUint8(offset) << 24) | (view.getUint8(offset + 1) << 16) | (view.getUint8(offset + 2) << 8) | view.getUint8(offset + 3);
}

function readVarint(view: DataView, offset: number): { value: number; len: number } {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    const byte = view.getUint8(offset + i);
    result = (result << 7) | (byte & 0x7f);
    if ((byte & 0x80) === 0) return { value: result, len: i + 1 };
  }
  result = (result << 8) | view.getUint8(offset + 8);
  return { value: result >>> 0, len: 9 };
}

function serialTypeLength(serialType: number): number {
  if (serialType <= 4) return serialType;
  if (serialType === 5) return 6;
  if (serialType === 6) return 8;
  if (serialType === 7) return 8;
  if (serialType === 8 || serialType === 9) return 0;
  if (serialType >= 12) return Math.floor((serialType - 12) / 2);
  return 0;
}

function decodeText(view: DataView, offset: number, length: number): string | null {
  if (length <= 0 || offset + length > view.byteLength) return null;
  try {
    const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, length);
    let printable = 0;
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b < 0x7f) || b >= 0xc2) printable++;
    }
    if (bytes.length > 0 && printable / bytes.length < 0.8) return null;
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch { return null; }
}

function isPlausibleTimestamp(ms: number): boolean {
  if (ms <= 0) return false;
  return ms >= Date.UTC(2009, 0, 1) && ms <= Date.now() + 86_400_000;
}

function tryDecodeRecord(view: DataView, offset: number, maxLen: number): { texts: string[]; timestamp: number | null; recordEnd: number } | null {
  const end = Math.min(offset + maxLen, view.byteLength);
  let pos = offset;
  const headerStart = readVarint(view, pos);
  pos += headerStart.len;
  const headerEnd = offset + headerStart.value;
  if (headerEnd <= pos || headerEnd > end) return null;
  const serialTypes: number[] = [];
  while (pos < headerEnd) { const st = readVarint(view, pos); pos += st.len; serialTypes.push(st.value); }
  if (pos !== headerEnd) return null;
  const texts: string[] = [];
  let timestamp: number | null = null;
  let bodyPos = headerEnd;
  for (const st of serialTypes) {
    if (st === 0 || st === 8 || st === 9) continue;
    const len = serialTypeLength(st);
    if (bodyPos + len > end) return null;
    if (st >= 13 && st % 2 === 1) {
      const txt = decodeText(view, bodyPos, len);
      if (txt) texts.push(txt);
    } else if (st === 6) {
      let v = 0; for (let i = 0; i < 8; i++) v = v * 256 + view.getUint8(bodyPos + i);
      if (isPlausibleTimestamp(v)) timestamp = v;
    } else if (st === 5) {
      let v = 0; for (let i = 0; i < 6; i++) v = v * 256 + view.getUint8(bodyPos + i);
      if (isPlausibleTimestamp(v)) timestamp = v;
    } else if (st === 4) {
      const v = readUint32BE(view, bodyPos);
      if (isPlausibleTimestamp(v)) timestamp = v;
    }
    bodyPos += len;
  }
  return { texts, timestamp, recordEnd: bodyPos };
}

interface CarveRegion { page: number; offset: number; length: number; }

function enumerateCarvableRegions(view: DataView, pageSize: number, pageCount: number, freelistTrunk: number): CarveRegion[] {
  const regions: CarveRegion[] = [];
  for (let page = 1; page <= pageCount; page++) {
    const pageStart = (page - 1) * pageSize;
    if (pageStart + pageSize > view.byteLength) break;
    if (view.getUint8(pageStart) !== 0x0d) continue;
    const cellCount = readUint16BE(view, pageStart + 3);
    const cellContentStart = readUint16BE(view, pageStart + 5) === 0 ? 65536 : readUint16BE(view, pageStart + 5);
    const headerEnd = pageStart + 8 + cellCount * 2;
    const contentStart = pageStart + cellContentStart;
    if (contentStart > headerEnd + 4) regions.push({ page, offset: headerEnd, length: contentStart - headerEnd });
    let freeBlock = readUint16BE(view, pageStart + 1);
    const guard = new Set<number>();
    while (freeBlock !== 0 && freeBlock < pageSize && !guard.has(freeBlock)) {
      guard.add(freeBlock);
      const fbStart = pageStart + freeBlock;
      const next = readUint16BE(view, fbStart);
      const size = readUint16BE(view, fbStart + 2);
      if (size > 4 && fbStart + size <= pageStart + pageSize) regions.push({ page, offset: fbStart + 4, length: size - 4 });
      freeBlock = next;
    }
  }
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
        if (leafStart + pageSize <= view.byteLength) regions.push({ page: leafPage, offset: leafStart, length: pageSize });
      }
    }
    trunk = nextTrunk;
  }
  return regions;
}

function carveRegion(view: DataView, region: CarveRegion): { text: string; timestamp: number | null; confidence: number }[] {
  const found: { text: string; timestamp: number | null; confidence: number }[] = [];
  const regionEnd = region.offset + region.length;
  let pos = region.offset;
  while (pos < regionEnd - 2) {
    const headerLenByte = view.getUint8(pos);
    if (headerLenByte < 2 || headerLenByte > 64) { pos++; continue; }
    const decoded = tryDecodeRecord(view, pos, regionEnd - pos);
    if (decoded && decoded.texts.length > 0) {
      const meaningful = decoded.texts.filter((t) => t.trim().length >= 2).join(" ").trim();
      if (meaningful.length >= 3) {
        const hasTs = decoded.timestamp !== null;
        const confidence = Math.min(1, 0.4 + Math.min(meaningful.length, 200) / 400 + (hasTs ? 0.2 : 0));
        found.push({ text: meaningful, timestamp: decoded.timestamp, confidence });
        pos = Math.max(decoded.recordEnd, pos + headerLenByte + 1);
        continue;
      }
    }
    pos++;
  }
  return found;
}

// ---- Table readers ----

interface TableSchema { name: string; columns: string[]; }

function getTables(db: SqlDb): TableSchema[] {
  const res = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
  const tables: TableSchema[] = [];
  if (!res[0]) return tables;
  for (const row of res[0].values) {
    const name = String(row[0]);
    const colsRes = db.exec(`PRAGMA table_info("${name}")`)[0];
    const columns = colsRes ? colsRes.values.map((r) => String(r[1])) : [];
    tables.push({ name, columns });
  }
  return tables;
}

function readTable(db: SqlDb, table: string, columns: string[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  const colList = columns.map((c) => `"${c}"`).join(", ");
  let stmt: ReturnType<SqlDb["prepare"]> | null = null;
  try {
    stmt = db.prepare(`SELECT ${colList} FROM "${table}"`);
    while (stmt.step()) rows.push(stmt.getAsObject() as Record<string, unknown>);
  } catch { /* table might not exist */ } finally { stmt?.free(); }
  return rows;
}

// ---- WhatsApp parser (improved: chat subject, message type, media caption) ----
function extractWhatsAppItems(db: SqlDb): RecoveredItem[] {
  const items: RecoveredItem[] = [];
  const tables = getTables(db);
  if (!tables.some((t) => t.name === "messages")) return items;
  const msgTable = tables.find((t) => t.name === "messages")!;
  const has = (c: string) => msgTable.columns.includes(c);
  const textCol = has("text_data") ? "text_data" : has("body") ? "body" : has("data") ? "data" : null;
  const tsCol = has("timestamp") ? "timestamp" : has("received_timestamp") ? "received_timestamp" : null;
  const fromMeCol = has("from_me") ? "from_me" : has("key_from_me") ? "key_from_me" : null;
  const chatCol = has("chat_row_id") ? "chat_row_id" : has("key_remote_jid") ? "key_remote_jid" : null;
  if (!textCol) return items;

  // Build chat lookup with subject
  const chatMap = new Map<number, { jid: string; subject: string | null }>();
  if (tables.some((t) => t.name === "chat")) {
    const chatRows = readTable(db, "chat", ["_id", "jid", "subject", "raw_string_jid"]);
    for (const r of chatRows) {
      const id = Number(r._id);
      chatMap.set(id, { jid: String(r.jid ?? r.raw_string_jid ?? `chat_${id}`), subject: r.subject ? String(r.subject) : null });
    }
  }

  const cols = ["_id"];
  if (chatCol) cols.push(chatCol);
  if (fromMeCol) cols.push(fromMeCol);
  if (tsCol) cols.push(tsCol);
  if (textCol) cols.push(textCol);
  if (has("media_caption")) cols.push("media_caption");
  if (has("message_type")) cols.push("message_type");

  const rows = readTable(db, "messages", cols);
  rows.forEach((r, i) => {
    const text = String(r[textCol!] ?? r.media_caption ?? "").trim();
    if (!text || text === "0" || text === "null") return;
    const ts = tsCol ? Number(r[tsCol]) : null;
    const chatRowId = chatCol ? Number(r[chatCol]) : 0;
    const chatInfo = chatMap.get(chatRowId);
    const chatJid = chatInfo?.jid ?? (chatCol ? String(r[chatCol]) : null);
    const chatLabel = chatInfo?.subject ?? (chatJid ? chatJid.split("@")[0] : null);
    const fromMe = fromMeCol ? Number(r[fromMeCol]) === 1 : null;
    const msgType = has("message_type") ? Number(r.message_type) : 1;
    const isMedia = msgType > 1 && !!r.media_caption;

    items.push({
      id: `wa_${i}`,
      source: "table",
      category: "WhatsApp Message",
      title: text.slice(0, 80) + (text.length > 80 ? "…" : ""),
      subtitle: chatLabel,
      text,
      fields: {
        chat: chatJid ?? null,
        chat_name: chatInfo?.subject ?? null,
        from_me: fromMe === null ? null : fromMe ? "Outgoing" : "Incoming",
        type: isMedia ? "Media caption" : "Text",
      },
      timestamp: ts && isPlausibleTimestamp(ts) ? ts : null,
      page: null, offset: null, confidence: null,
    });
  });
  return items;
}

// ---- Contacts parser (improved: organization, phone type, email type) ----
function extractContactsItems(db: SqlDb): RecoveredItem[] {
  const items: RecoveredItem[] = [];
  const tables = getTables(db);
  const contactsTable = tables.find((t) => t.name === "contacts" || t.name === "raw_contacts");
  const dataTable = tables.find((t) => t.name === "data");
  if (!contactsTable) return items;

  const nameCol = contactsTable.columns.find((c) => /display_name|display_name_alt/i.test(c));
  const contactRows = readTable(db, contactsTable.name, contactsTable.columns);

  // Build phone/email/org maps from data table
  const phoneMap = new Map<number, { num: string; type: string }[]>();
  const emailMap = new Map<number, { addr: string; type: string }[]>();
  const orgMap = new Map<number, string>();

  if (dataTable) {
    const dataRows = readTable(db, "data", ["raw_contact_id", "mimetype", "data1", "data2"]);
    for (const r of dataRows) {
      const cid = Number(r.raw_contact_id);
      const mime = String(r.mimetype ?? "");
      const val = String(r.data1 ?? "").trim();
      const subtype = String(r.data2 ?? "");
      if (!val) continue;
      if (mime.includes("phone")) {
        if (!phoneMap.has(cid)) phoneMap.set(cid, []);
        phoneMap.get(cid)!.push({ num: val, type: subtype || "Phone" });
      } else if (mime.includes("email")) {
        if (!emailMap.has(cid)) emailMap.set(cid, []);
        emailMap.get(cid)!.push({ addr: val, type: subtype || "Email" });
      } else if (mime.includes("organization")) {
        orgMap.set(cid, val);
      }
    }
  }

  contactRows.forEach((r, i) => {
    const id = Number(r._id ?? r.contact_id ?? i);
    const name = nameCol ? String(r[nameCol] ?? "").trim() : `Contact ${i}`;
    if (!name || name === "null") return;
    const phones = phoneMap.get(id) ?? [];
    const emails = emailMap.get(id) ?? [];
    const org = orgMap.get(id) ?? null;

    const parts = [
      name,
      ...phones.map(p => `📞 ${p.num} (${p.type})`),
      ...emails.map(e => `✉ ${e.addr} (${e.type})`),
      org ? `🏢 ${org}` : null,
    ].filter(Boolean);
    const text = parts.join("\n");

    items.push({
      id: `contact_${i}`,
      source: "table",
      category: "Contact",
      title: name,
      subtitle: phones[0]?.num ?? emails[0]?.addr ?? org ?? null,
      text,
      fields: {
        name,
        phones: phones.map(p => `${p.num} (${p.type})`).join(", ") || null,
        emails: emails.map(e => `${e.addr} (${e.type})`).join(", ") || null,
        organization: org,
      },
      timestamp: null, page: null, offset: null, confidence: null,
    });
  });
  return items;
}

// ---- SMS parser (improved: thread context, read status, type labels) ----
function extractSmsItems(db: SqlDb): RecoveredItem[] {
  const items: RecoveredItem[] = [];
  const tables = getTables(db);
  const smsTable = tables.find((t) => t.name === "sms");
  if (!smsTable) return items;

  const has = (c: string) => smsTable.columns.includes(c);
  const cols = ["_id"];
  if (has("address")) cols.push("address");
  if (has("body")) cols.push("body");
  if (has("date")) cols.push("date");
  if (has("type")) cols.push("type");
  if (has("thread_id")) cols.push("thread_id");
  if (has("read")) cols.push("read");
  if (has("subject")) cols.push("subject");

  const rows = readTable(db, smsTable.name, cols);
  const typeLabels: Record<number, string> = { 1: "Received", 2: "Sent", 3: "Draft", 4: "Outbox", 5: "Failed", 6: "Queued" };

  rows.forEach((r, i) => {
    const body = String(r.body ?? "").trim();
    if (!body) return;
    const ts = r.date ? Number(r.date) : null;
    const type = Number(r.type ?? 0);
    const dir = typeLabels[type] ?? "Unknown";
    const subject = r.subject ? String(r.subject) : null;
    const isRead = r.read !== undefined ? Number(r.read) === 1 : null;

    items.push({
      id: `sms_${i}`,
      source: "table",
      category: "SMS Message",
      title: body.slice(0, 80) + (body.length > 80 ? "…" : ""),
      subtitle: `${dir} · ${String(r.address ?? "")}`,
      text: subject ? `[${subject}] ${body}` : body,
      fields: {
        address: String(r.address ?? ""),
        direction: dir,
        thread_id: r.thread_id ? String(r.thread_id) : null,
        read: isRead === null ? null : isRead ? "Read" : "Unread",
        subject: subject,
      },
      timestamp: ts && isPlausibleTimestamp(ts) ? ts : null,
      page: null, offset: null, confidence: null,
    });
  });
  return items;
}

// ---- Call log parser (improved: formatted duration, all type labels) ----
function extractCallLogItems(db: SqlDb): RecoveredItem[] {
  const items: RecoveredItem[] = [];
  const tables = getTables(db);
  const callsTable = tables.find((t) => t.name === "calls");
  if (!callsTable) return items;

  const has = (c: string) => callsTable.columns.includes(c);
  const cols = ["_id"];
  if (has("number")) cols.push("number");
  if (has("date")) cols.push("date");
  if (has("duration")) cols.push("duration");
  if (has("type")) cols.push("type");
  if (has("name")) cols.push("name");
  if (has("geocoded_location")) cols.push("geocoded_location");

  const rows = readTable(db, "calls", cols);
  const typeMap: Record<number, string> = {
    1: "Incoming", 2: "Outgoing", 3: "Missed", 4: "Voicemail",
    5: "Rejected", 6: "Blocked", 7: "Answered Externally",
  };

  rows.forEach((r, i) => {
    const number = String(r.number ?? "");
    const name = String(r.name ?? "");
    const ts = r.date ? Number(r.date) : null;
    const type = Number(r.type ?? 0);
    const duration = Number(r.duration ?? 0);
    const location = r.geocoded_location ? String(r.geocoded_location) : null;
    const title = name || number;
    if (!title || title === "null") return;

    // Format duration
    const durStr = duration > 0
      ? duration >= 60 ? `${Math.floor(duration / 60)}m ${duration % 60}s` : `${duration}s`
      : "0s";

    items.push({
      id: `call_${i}`,
      source: "table",
      category: "Call Log",
      title,
      subtitle: `${typeMap[type] ?? "Unknown"} · ${number} · ${durStr}`,
      text: `${typeMap[type] ?? "Call"} ${name ? `with ${name}` : ""} ${number} — Duration: ${durStr}${location ? ` · Location: ${location}` : ""}`,
      fields: {
        number,
        name: name && name !== "null" ? name : null,
        type: typeMap[type] ?? null,
        duration: durStr,
        location: location,
      },
      timestamp: ts && isPlausibleTimestamp(ts) ? ts : null,
      page: null, offset: null, confidence: null,
    });
  });
  return items;
}

// ---- Generic parser (for any other SQLite database) ----
function extractGenericItems(db: SqlDb): RecoveredItem[] {
  const items: RecoveredItem[] = [];
  const tables = getTables(db);
  let idCounter = 0;
  for (const table of tables) {
    if (table.name.startsWith("sqlite_") || table.name === "android_metadata") continue;
    const rows = readTable(db, table.name, table.columns);
    for (const r of rows) {
      const entries = Object.entries(r);
      const textCols = entries.filter(([, v]) => typeof v === "string" && String(v).trim().length >= 2);
      if (textCols.length === 0) continue;
      const body = textCols.map(([k, v]) => `${k}: ${v}`).join("\n");
      const title = String(textCols[0][1] ?? "").slice(0, 80);
      const tsCol = table.columns.find((c) => /date|time|timestamp/i.test(c));
      const ts = tsCol && r[tsCol] ? Number(r[tsCol]) : null;
      idCounter++;
      items.push({
        id: `gen_${idCounter}`, source: "table", category: table.name,
        title, subtitle: table.name, text: body,
        fields: Object.fromEntries(entries.map(([k, v]) => [k, v === null ? null : String(v)])),
        timestamp: ts && isPlausibleTimestamp(ts) ? ts : null,
        page: null, offset: null, confidence: null,
      });
      if (items.length >= 5000) return items;
    }
  }
  return items;
}

// ---- Source-specific table reader selector ----
function readLiveItems(db: SqlDb, sourceType: SourceType): RecoveredItem[] {
  const tables = getTables(db);
  const tableNames = tables.map(t => t.name);
  // Auto-detect based on tables present
  if (tableNames.includes("messages") && (tableNames.includes("chat") || tableNames.includes("messages")))
    return [...extractWhatsAppItems(db), ...extractGenericItems(db)];
  if (tableNames.includes("contacts") || tableNames.includes("data"))
    return [...extractContactsItems(db), ...extractGenericItems(db)];
  if (tableNames.includes("sms"))
    return [...extractSmsItems(db), ...extractGenericItems(db)];
  if (tableNames.includes("calls"))
    return [...extractCallLogItems(db), ...extractGenericItems(db)];
  // Run all parsers — they self-detect
  return [
    ...extractWhatsAppItems(db),
    ...extractContactsItems(db),
    ...extractSmsItems(db),
    ...extractCallLogItems(db),
    ...extractGenericItems(db),
  ];
}

// ---- Main analysis function ----
export async function analyseDatabase(
  file: File,
  sourceType: SourceType,
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
  try { SQL = await getSqlJs(); } catch (err) {
    return fail(fileName, fileSizeBytes, fileHash, Date.now() - startedAt, sourceType,
      `Could not load SQLite engine: ${err instanceof Error ? err.message : String(err)}`);
  }

  onProgress({ phase: "reading", message: "Opening database…", percent: 22 });
  let db: SqlDb;
  try { db = new SQL.Database(new Uint8Array(buffer.slice(0))); } catch (err) {
    return fail(fileName, fileSizeBytes, fileHash, Date.now() - startedAt, sourceType,
      `Not a valid SQLite database: ${err instanceof Error ? err.message : String(err)}`);
  }

  const warnings: string[] = [];
  onProgress({ phase: "reading", message: "Reading live records…", percent: 40 });
  let liveItems: RecoveredItem[] = [];
  try { liveItems = readLiveItems(db, sourceType); } catch (err) { warnings.push(`Live read failed: ${err instanceof Error ? err.message : String(err)}`); }
  db.close();

  // Carve deleted records
  onProgress({ phase: "carving", message: "Carving deleted records from free space…", percent: 55 });
  const carved: RecoveredItem[] = [];
  try {
    const view = new DataView(buffer);
    const psRaw = readUint16BE(view, 16);
    const pageSize = psRaw === 1 ? 65536 : psRaw;
    const pageCount = readUint32BE(view, 28);
    const freelistTrunk = readUint32BE(view, 32);
    if (pageSize > 0 && (pageSize & (pageSize - 1)) === 0 && pageCount > 0) {
      const regions = enumerateCarvableRegions(view, pageSize, pageCount, freelistTrunk);
      const liveTexts = new Set(liveItems.map((m) => m.text.trim()).filter((t) => t.length >= 3));
      let carvedId = 0;
      for (let i = 0; i < regions.length; i++) {
        const r = regions[i];
        const hits = carveRegion(view, r);
        for (const h of hits) {
          let text = h.text.replace(/^[\x00-\x1f\x7f-\xff]+/, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]+$/, "");
          if (liveTexts.has(text.trim()) || text.trim().length < 3) continue;
          liveTexts.add(text.trim());
          carvedId++;
          carved.push({
            id: `carved_${carvedId}`, source: "carved", category: "Deleted Record",
            title: text.slice(0, 80) + (text.length > 80 ? "…" : ""),
            subtitle: null, text,
            fields: { region: "free_space", page: String(r.page) },
            timestamp: h.timestamp, page: r.page, offset: r.offset, confidence: h.confidence,
          });
        }
        if (i % 50 === 0) {
          onProgress({ phase: "carving", message: `Carving… ${i}/${regions.length} regions`, percent: 55 + Math.floor((i / Math.max(regions.length, 1)) * 35) });
          await new Promise((res) => setTimeout(res, 0));
        }
      }
    } else { warnings.push("Could not parse SQLite header; skipping free-space carving."); }
  } catch (err) { warnings.push(`Carving failed: ${err instanceof Error ? err.message : String(err)}`); }

  // De-duplicate carved fragments
  const dedupedCarved: typeof carved = [];
  for (const c of [...carved].sort((a, b) => b.text.length - a.text.length)) {
    if (!dedupedCarved.some((k) => k.text.includes(c.text) || c.text.includes(k.text))) dedupedCarved.push(c);
  }
  dedupedCarved.forEach((c, i) => (c.id = `carved_${i + 1}`));

  onProgress({ phase: "finalizing", message: "Finalizing results…", percent: 96 });
  const all = [...liveItems, ...dedupedCarved].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  const catMap = new Map<string, { live: number; recovered: number }>();
  for (const item of all) {
    const cat = item.category;
    const e = catMap.get(cat) ?? { live: 0, recovered: 0 };
    if (item.source === "table") e.live++; else e.recovered++;
    catMap.set(cat, e);
  }

  const result: AnalysisResult = {
    sourceType, fileName, fileSizeBytes, fileHash,
    existingItems: liveItems.length, recoveredFragments: dedupedCarved.length,
    categoryCount: catMap.size, items: all,
    durationMs: Date.now() - startedAt,
    status: warnings.length > 0 && liveItems.length === 0 && dedupedCarved.length === 0 ? "failed" : warnings.length > 0 ? "partial" : "completed",
    warnings,
    categorySummary: [...catMap.entries()].map(([category, v]) => ({ category, ...v })),
  };
  onProgress({ phase: "done", message: `Recovered ${dedupedCarved.length} deleted record(s) from ${liveItems.length} live item(s).`, percent: 100 });
  return result;
}

function fail(fileName: string, fileSizeBytes: number, fileHash: string, durationMs: number, sourceType: SourceType, message: string): AnalysisResult {
  return { sourceType, fileName, fileSizeBytes, fileHash, existingItems: 0, recoveredFragments: 0, categoryCount: 0, items: [], durationMs, status: "failed", warnings: [message], categorySummary: [] };
}

// ---- Format helpers ----
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatTimestamp(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
