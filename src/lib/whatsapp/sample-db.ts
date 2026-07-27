// Generates a realistic WhatsApp msgstore.db entirely in the browser using
// sql.js. Some messages are inserted and then DELETE'd (without VACUUM), so
// their text physically remains in the SQLite file's free space and can be
// genuinely carved back by the forensic engine. This lets a visitor try the
// full recovery workflow without needing their own msgstore.db.

import type initSqlJsType from "sql.js";
import type { AnalysisResult } from "./types";

type SqlJsStatic = Awaited<ReturnType<typeof initSqlJsType>>;

let sqlPromise: Promise<SqlJsStatic> | null = null;

async function getSqlJs(): Promise<SqlJsStatic> {
  if (!sqlPromise) {
    const init = (await import("sql.js")).default;
    sqlPromise = init({ locateFile: (file: string) => `/${file}` });
  }
  return sqlPromise;
}

interface SampleChat {
  jid: string;
  subject: string | null;
  messages: { fromMe: boolean; minutesAgo: number; text: string }[];
  /** messages that get INSERTed then DELETEd (recoverable via carving) */
  deleted: { fromMe: boolean; minutesAgo: number; text: string }[];
}

// A plausible multi-chat conversation. The deleted messages are the ones a
// user would actually want back — accidental deletes, important info, etc.
const SAMPLE_DATA: SampleChat[] = [
  {
    jid: "15551234567@s.whatsapp.net",
    subject: null,
    messages: [
      { fromMe: false, minutesAgo: 240, text: "Hey! Are we still on for dinner tonight?" },
      { fromMe: true, minutesAgo: 235, text: "Yes! 8pm at the usual place 🍝" },
      { fromMe: false, minutesAgo: 230, text: "Perfect, see you then" },
      { fromMe: false, minutesAgo: 120, text: "I just booked the table, window seat" },
    ],
    deleted: [
      { fromMe: false, minutesAgo: 200, text: "Please don't tell Sarah about the surprise party, she has no idea" },
      { fromMe: false, minutesAgo: 180, text: "I'm having second thoughts about the job offer, the salary is low" },
    ],
  },
  {
    jid: "12025550177-1623185448@g.us",
    subject: "Weekend Trip 🏔️",
    messages: [
      { fromMe: false, minutesAgo: 600, text: "Who is bringing the camping gear?" },
      { fromMe: true, minutesAgo: 590, text: "I'll get the tent and stove" },
      { fromMe: false, minutesAgo: 580, text: "Nice, I'll handle food" },
      { fromMe: false, minutesAgo: 300, text: "Forecast says clear skies all weekend" },
    ],
    deleted: [
      { fromMe: true, minutesAgo: 560, text: "The wifi password for the cabin is orangutan4422, save it" },
      { fromMe: false, minutesAgo: 400, text: "My flight lands at 6am terminal 2, can someone pick me up" },
    ],
  },
  {
    jid: "15559876543@s.whatsapp.net",
    subject: null,
    messages: [
      { fromMe: false, minutesAgo: 1440, text: "Did you send the contract documents?" },
      { fromMe: true, minutesAgo: 1420, text: "Yes, emailed them this morning" },
      { fromMe: false, minutesAgo: 1380, text: "Got them, reviewing now" },
    ],
    deleted: [
      { fromMe: false, minutesAgo: 1410, text: "The bank account number for the transfer is 4491-8820-3371" },
    ],
  },
];

/**
 * Build a real SQLite msgstore.db in-browser and return it as a File ready
 * to feed to the analyzer. `onProgress` is called with short status updates.
 */
export async function generateSampleDatabase(
  onProgress: (msg: string) => void,
): Promise<File> {
  onProgress("Loading SQLite engine…");
  const SQL = await getSqlJs();

  onProgress("Building sample database…");
  const db = new SQL.Database();
  // WhatsApp-style page size; journal mode DELETE keeps deleted rows in free
  // space rather than rewriting the file.
  db.run("PRAGMA page_size = 4096");
  db.run("PRAGMA journal_mode = DELETE");

  db.run(`CREATE TABLE chat (
    _id INTEGER PRIMARY KEY,
    jid TEXT,
    subject TEXT,
    raw_string_jid TEXT,
    hidden INTEGER DEFAULT 0,
    display_number TEXT
  )`);

  db.run(`CREATE TABLE messages (
    _id INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_row_id INTEGER,
    key_id TEXT,
    from_me INTEGER,
    timestamp INTEGER,
    received_timestamp INTEGER,
    message_type INTEGER,
    text_data TEXT,
    media_caption TEXT,
    status INTEGER,
    origin INTEGER
  )`);

  const now = Date.now();
  const insChat = db.prepare(
    "INSERT INTO chat (_id, jid, subject, raw_string_jid) VALUES (?, ?, ?, ?)",
  );
  const insMsg = db.prepare(
    "INSERT INTO messages (chat_row_id, key_id, from_me, timestamp, received_timestamp, message_type, text_data, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );

  let chatId = 0;
  for (const chat of SAMPLE_DATA) {
    chatId++;
    insChat.run([chatId, chat.jid, chat.subject, chat.jid]);

    const all = [
      ...chat.messages.map((m) => ({ ...m, willDelete: false })),
      ...chat.deleted.map((m) => ({ ...m, willDelete: true })),
    ];
    // Interleave live + to-be-deleted so they share pages (more realistic).
    all.sort((a, b) => b.minutesAgo - a.minutesAgo);

    const toDeleteIds: number[] = [];
    for (const m of all) {
      const ts = now - m.minutesAgo * 60_000;
      const keyId = `msg_${chatId}_${ts}`;
      const res = insMsg.run([
        chatId,
        keyId,
        m.fromMe ? 1 : 0,
        ts,
        ts,
        1,
        m.text,
        1,
      ]);
      if (m.willDelete && res.lastInsertRowid) {
        toDeleteIds.push(Number(res.lastInsertRowid));
      }
    }

    if (toDeleteIds.length > 0) {
      const idList = toDeleteIds.join(",");
      db.run(`DELETE FROM messages WHERE _id IN (${idList})`);
      // Deliberately NOT running VACUUM — the deleted bytes must remain in
      // the file's free space for the carving engine to recover them.
    }
  }

  insChat.free();
  insMsg.free();

  onProgress("Exporting database file…");
  const bytes = db.export();
  db.close();

  // Wrap in a File so the existing analyzer handles it identically to an
  // uploaded file.
  return new File([bytes], "sample-msgstore.db", {
    type: "application/x-sqlite3",
  });
}

/** Convenience: generate + analyse in one step, returning the full result. */
export async function buildSampleAnalysisResult(): Promise<{
  file: File;
  result: AnalysisResult;
}> {
  // Lazy import to avoid pulling the analyzer into the sample bundle path.
  const { analyseWhatsAppDatabase } = await import("./forensics");
  const file = await generateSampleDatabase(() => {});
  const result = await analyseWhatsAppDatabase(file, () => {});
  return { file, result };
}
