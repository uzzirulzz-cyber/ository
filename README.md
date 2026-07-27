# RecoverLink — WhatsApp Deleted Message Forensic Recovery

Recover deleted WhatsApp messages from a `msgstore.db` file — **entirely in your browser**. RecoverLink uses the real SQLite engine (compiled to WebAssembly) to read your live messages and **carves deleted messages out of the database's free space** using the same technique forensic tools use. Recovered messages are saved to MongoDB so past recoveries can be re-opened, browsed, searched and exported at any time.

No dummy data, no simulation — the deleted message text is genuinely recovered from the file's unallocated regions.

---

## How it works

1. **Structured read** — opens your `msgstore.db` with [sql.js](https://github.com/sql-js/sql.js) (SQLite compiled to WebAssembly) and reads every live row from the `messages` table. It auto-detects column names across WhatsApp schema versions (`text_data`/`body`, `media_caption`, `timestamp`/`received_timestamp`, `from_me`/`key_from_me`, `chat_row_id`/`key_remote_jid`).

2. **Deleted-record carving** — when WhatsApp deletes a message, the row is removed but the text usually still physically occupies the SQLite file's **free space** until the database is vacuumed. RecoverLink:
   - Walks every table b-tree leaf page's **free blocks** and **unallocated gap**
   - Walks every page on the **freelist** (trunk + leaf pages)
   - Decodes SQLite **record headers** (varints + serial types) in those regions
   - Extracts TEXT payloads and validates nearby millisecond timestamps (2009 → now)
   - Scores confidence and de-duplicates against live messages

3. **MongoDB persistence** — the session metadata **and** every recovered message are saved to MongoDB Atlas, so you can re-open any past recovery later with full filters, search and export.

Everything except the optional server-side persistence runs in your browser — your database file never leaves your machine.

---

## Try it instantly

Don't have a `msgstore.db` yet? Click **"Try a sample database"** on the home screen. RecoverLink builds a realistic WhatsApp database **in your browser** (with some messages inserted and then deleted), then runs it through the real forensic engine — so you'll see genuine deleted messages carved back from free space.

---

## Getting a real `msgstore.db`

A browser cannot read WhatsApp's sandboxed, encrypted database directly from a phone over USB. You need the database file itself. Pick whichever route matches your device:

### From a local backup (`.crypt14` / `.crypt15`)
Copy `/sdcard/WhatsApp/Backups/msgstore.db.crypt15` to a computer and decrypt it with your 64-digit backup key using an open-source tool such as **wa-crypt-tools** or **bkcrack**. The decrypted output is the plain `msgstore.db` you drop here.

### From a rooted phone (most reliable)
```bash
adb shell su -c "cat /data/data/com.whatsapp/databases/msgstore.db" > msgstore.db
```
This file opens directly — no decryption needed.

---

## Features

- **Drag & drop upload** with SQLite magic-byte validation
- **Live progress** through analysis phases (read → carve → finalize → save)
- **Stat cards**: live messages, recovered fragments, chats, recovery rate
- **Filters**: source (live / recovered), chat, dated-only, full-text search
- **Export**: JSON and CSV
- **Saved recoveries**: re-open any past recovery from MongoDB with full browsing
- **Stats dashboard**: aggregated totals across all your recoveries
- **Confidence scores** and page/offset metadata on every carved fragment
- 100% client-side analysis; only metadata + messages are persisted server-side

---

## Tech stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS 4** + **shadcn/ui**
- **sql.js** — SQLite compiled to WebAssembly (in-browser parsing + carving)
- **MongoDB Atlas** — session + message persistence (full mode)
- **Zustand** + **TanStack Query** for state

---

## Setup

### Prerequisites
- Node.js 18+ or [Bun](https://bun.sh)
- A MongoDB Atlas connection string

### Install & run
```bash
bun install        # or npm install
cp .env.example .env
# edit .env and set MONGODB_URI + MONGODB_DB

bun run db:generate   # regenerate Prisma client (legacy schema, optional)
bun run dev           # starts on http://localhost:3000
```

### Environment
```
DATABASE_URL=file:./db/custom.db
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?appName=<appName>
MONGODB_DB=recoverlink
```

> **Never commit your real `.env`.** It is git-ignored. Only `.env.example` (with placeholders) is in the repo.

---

## Project structure

```
src/
├─ app/
│  ├─ api/
│  │  ├─ recovery/route.ts        # GET list, POST create (session + messages)
│  │  ├─ recovery/[id]/route.ts   # GET detail, DELETE cascade
│  │  └─ stats/route.ts           # aggregated totals
│  ├─ layout.tsx
│  └─ page.tsx                    # main orchestrator
├─ components/
│  └─ recovery/
│     ├─ upload-panel.tsx         # drag & drop + sample generator
│     ├─ results-viewer.tsx       # filters, search, export, message list
│     ├─ session-history.tsx      # saved recoveries + stats bar
│     ├─ header.tsx / footer.tsx
├─ lib/
│  ├─ db.ts                       # MongoDB singleton (Node runtime)
│  └─ whatsapp/
│     ├─ forensics.ts             # sql.js reader + free-space carving engine
│     ├─ sample-db.ts             # in-browser sample msgstore.db generator
│     └─ types.ts
└─ public/
   └─ sql-wasm-browser.wasm       # SQLite WASM binary
```

---

## Honest limitations

- **You need the `msgstore.db` file.** A browser cannot reach WhatsApp's sandboxed encrypted DB over USB — there is no way around this in a web app.
- **Recovery only works while deleted bytes still physically exist** in the file. If WhatsApp ran `VACUUM` (which overwrites deleted data) or the messages were deleted long ago, nothing can recover them. RecoverLink tells you this plainly when 0 fragments are found.
- **Carved fragments may include leading garbage bytes** (free-block remnants) and partial text — that's inherent to carving from unallocated regions. Each fragment shows a confidence score and its page/offset so you can judge reliability.

---

## License

MIT
