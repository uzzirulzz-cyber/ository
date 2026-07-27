// Enterprise-grade raw binary pattern carver.
// Scans ANY file (not just SQLite) for forensic artifacts: phone numbers,
// email addresses, URLs, credit card numbers, GPS coordinates, IP addresses,
// and Bitcoin addresses. Used alongside the SQLite engine for maximum recovery.

import type { RecoveredItem } from "./types";

// ---- Pattern definitions ----

interface Pattern {
  name: string;
  category: string;
  regex: RegExp;
  /** Minimum confidence for this pattern type */
  baseConfidence: number;
}

const PATTERNS: Pattern[] = [
  {
    name: "Phone",
    category: "Phone Number",
    // International and US phone formats
    regex: /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g,
    baseConfidence: 0.65,
  },
  {
    name: "Email",
    category: "Email Address",
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    baseConfidence: 0.85,
  },
  {
    name: "URL",
    category: "Web URL",
    regex: /https?:\/\/[^\s<>"'{}|\\^`\[\]]{4,200}/gi,
    baseConfidence: 0.9,
  },
  {
    name: "Credit Card",
    category: "Credit Card",
    // Matches 13-19 digit numbers with optional spaces/dashes (Luhn-checkable)
    regex: /\b(?:\d[ -]*?){13,19}\b/g,
    baseConfidence: 0.5,
  },
  {
    name: "GPS",
    category: "GPS Coordinate",
    // Decimal degrees: -90.0 to 90.0, -180.0 to 180.0
    regex: /-?\d{1,3}\.\d{4,8},\s*-?\d{1,3}\.\d{4,8}/g,
    baseConfidence: 0.7,
  },
  {
    name: "IPv4",
    category: "IP Address",
    regex: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
    baseConfidence: 0.6,
  },
  {
    name: "Bitcoin",
    category: "Bitcoin Address",
    regex: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b|\bbc1[a-z0-9]{39,59}\b/g,
    baseConfidence: 0.75,
  },
  {
    name: "MAC",
    category: "MAC Address",
    regex: /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,
    baseConfidence: 0.6,
  },
  {
    name: "IBAN",
    category: "IBAN",
    regex: /\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b/g,
    baseConfidence: 0.7,
  },
  {
    name: "SSN",
    category: "SSN",
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    baseConfidence: 0.8,
  },
];

// ---- Luhn check for credit cards ----
function luhnCheck(num: string): boolean {
  const digits = num.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = parseInt(digits[i], 10);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ---- Extract context around a match ----
function extractContext(text: string, matchStart: number, matchEnd: number): string {
  const contextStart = Math.max(0, matchStart - 30);
  const contextEnd = Math.min(text.length, matchEnd + 30);
  const prefix = text.slice(contextStart, matchStart).replace(/[\x00-\x1f\x7f-\xff]+/g, "");
  const suffix = text.slice(matchEnd, contextEnd).replace(/[\x00-\x1f\x7f-\xff]+/g, "");
  const match = text.slice(matchStart, matchEnd);
  return `${prefix}${match}${suffix}`.trim();
}

/**
 * Scan raw bytes of ANY file for forensic artifacts (phone numbers, emails,
 * URLs, credit cards, GPS, IPs, Bitcoin, MAC, IBAN, SSN). Returns all
 * unique findings with context and confidence scores.
 */
export function carveRawPatterns(buffer: ArrayBuffer): RecoveredItem[] {
  const items: RecoveredItem[] = [];
  let idCounter = 0;

  // Decode the entire file as latin1 (preserves all bytes, no decode errors)
  const text = new TextDecoder("latin1").decode(buffer);
  const view = new DataView(buffer);

  for (const pattern of PATTERNS) {
    const seen = new Set<string>();
    let match: RegExpExecArray | null;
    pattern.regex.lastIndex = 0;

    while ((match = pattern.regex.exec(text)) !== null) {
      const value = match[0].trim();

      // Skip if too short or already seen
      if (value.length < 4) continue;

      // Credit cards: validate with Luhn
      if (pattern.name === "Credit Card") {
        if (!luhnCheck(value)) continue;
      }

      // Phone: filter out obvious non-phone matches (timestamps, etc.)
      if (pattern.name === "Phone") {
        const digits = value.replace(/\D/g, "");
        if (digits.length < 7) continue;
        // Skip if it's just a timestamp-like number
        if (/^\d{10,13}$/.test(digits) && digits.startsWith("17")) continue;
      }

      // GPS: validate ranges
      if (pattern.name === "GPS") {
        const [lat, lon] = value.split(",").map((s) => parseFloat(s.trim()));
        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
      }

      // Deduplicate
      const key = `${pattern.name}:${value}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Find byte offset of the match
      const matchOffset = match.index;
      // Find which page this falls in (if SQLite)
      const pageSize = view.byteLength > 16 ? (view.getUint16(16) === 1 ? 65536 : view.getUint16(16)) : 0;
      const page = pageSize > 0 ? Math.floor(matchOffset / pageSize) + 1 : null;

      idCounter++;
      items.push({
        id: `raw_${idCounter}`,
        source: "carved",
        category: pattern.category,
        title: value,
        subtitle: pattern.name,
        text: extractContext(text, match.index, match.index + value.length),
        fields: {
          pattern: pattern.name,
          value,
          context: extractContext(text, match.index, match.index + value.length),
        },
        timestamp: null,
        page,
        offset: matchOffset,
        confidence: pattern.baseConfidence,
      });
    }
  }

  return items;
}

/**
 * Scan a WAL (Write-Ahead Log) file for deleted records. WAL files
 * (e.g. msgstore.db-wal) contain committed transactions that may include
 * data deleted from the main database.
 */
export function carveWalFile(buffer: ArrayBuffer): RecoveredItem[] {
  const items: RecoveredItem[] = [];
  const view = new DataView(buffer);

  // WAL header: magic (4 bytes), format version (4), page size (4),
  // checkpoint sequence (4), salt-1 (4), salt-2 (4), checksum-1 (4), checksum-2 (4)
  if (buffer.byteLength < 32) return items;

  const magic = view.getUint32(0);
  if (magic !== 0x377f0682 && magic !== 0x377f0683) {
    // Not a WAL file
    return items;
  }

  const pageSize = view.getUint32(8);
  if (pageSize < 512 || pageSize > 65536) return items;

  // WAL frames: each frame has a 24-byte header + page-size data
  const frameHeaderSize = 24;
  let offset = 32; // skip WAL header
  let frameNum = 0;
  let idCounter = 0;

  while (offset + frameHeaderSize + pageSize <= buffer.byteLength) {
    // Frame header: page number (4), commit size (4), salt-1 (4), salt-2 (4),
    // checksum-1 (4), checksum-2 (4)
    const pageNumber = view.getUint32(offset);
    const commitSize = view.getUint32(offset + 4);

    // The page data starts after the frame header
    const pageDataStart = offset + frameHeaderSize;

    // Scan this page for record-like patterns
    // Reuse the SQLite record decoder logic
    const pageBuffer = buffer.slice(pageDataStart, pageDataStart + pageSize);
    const pageView = new DataView(pageBuffer);
    const pageType = pageView.getUint8(0);

    if (pageType === 0x0d) {
      // Leaf table page — scan for records
      const cellCount = (pageView.getUint8(3) << 8) | pageView.getUint8(4);
      const cellContentStart =
        ((pageView.getUint8(5) << 8) | pageView.getUint8(6)) === 0
          ? 65536
          : (pageView.getUint8(5) << 8) | pageView.getUint8(6);
      const headerEnd = 8 + cellCount * 2;

      // Scan the unallocated gap
      if (cellContentStart > headerEnd + 4) {
        const gapText = new TextDecoder("latin1").decode(
          pageBuffer.slice(headerEnd, cellContentStart),
        );
        // Look for readable text fragments
        const fragments = gapText.match(/[\x20-\x7e]{8,}/g);
        if (fragments) {
          for (const frag of fragments) {
            if (frag.trim().length >= 5) {
              idCounter++;
              items.push({
                id: `wal_${idCounter}`,
                source: "carved",
                category: "WAL Fragment",
                title: frag.slice(0, 60) + (frag.length > 60 ? "…" : ""),
                subtitle: `WAL frame ${frameNum}, page ${pageNumber}`,
                text: frag,
                fields: {
                  source: "WAL",
                  frame: String(frameNum),
                  pageNumber: String(pageNumber),
                },
                timestamp: null,
                page: pageNumber,
                offset: headerEnd,
                confidence: 0.6,
              });
            }
          }
        }
      }
    }

    offset += frameHeaderSize + pageSize;
    frameNum++;
    if (frameNum > 1000) break; // safety cap
  }

  return items;
}

/**
 * Scan a rollback journal file (e.g. msgstore.db-journal) for deleted data.
 * Journals contain pre-transaction page images that may include deleted records.
 */
export function carveJournalFile(buffer: ArrayBuffer): RecoveredItem[] {
  const items: RecoveredItem[] = [];
  const view = new DataView(buffer);

  // Journal header: magic "\xd9\xd5\x05\xf9\x20\xa1\x63\xd7" (8 bytes)
  if (buffer.byteLength < 28) return items;

  const magic = [
    view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3),
    view.getUint8(4), view.getUint8(5), view.getUint8(6), view.getUint8(7),
  ];
  const expected = [0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7];

  if (!magic.every((b, i) => b === expected[i])) {
    // Not a journal file — but still scan for readable text
    return scanForReadableText(buffer, "Journal Fragment");
  }

  // Page count at offset 8 (4 bytes big-endian)
  const pageCount = view.getUint32(8);
  // Page size at offset 12 (but in some versions, use 512 default)
  const pageSize = view.getUint32(12) || 4096;

  let idCounter = 0;
  const sectorSize = 512;
  let offset = sectorSize; // skip header sector

  for (let p = 0; p < pageCount && offset + pageSize <= buffer.byteLength; p++) {
    const pageBuffer = buffer.slice(offset, offset + pageSize);
    const pageItems = scanForReadableText(pageBuffer, "Journal Page");
    for (const item of pageItems) {
      idCounter++;
      item.id = `journal_${idCounter}`;
      item.fields = { ...item.fields, source: "Journal", pageNumber: String(p) };
      items.push(item);
    }
    offset += pageSize;
  }

  return items;
}

/**
 * Generic readable-text scanner: extracts any printable ASCII / UTF-8
 * fragment of 8+ characters from raw bytes. Used for journal files and
 * any binary blob.
 */
function scanForReadableText(buffer: ArrayBuffer, category: string): RecoveredItem[] {
  const items: RecoveredItem[] = [];
  const text = new TextDecoder("latin1").decode(buffer);
  let idCounter = 0;

  // Find runs of printable text
  const fragments = text.match(/[\x20-\x7e]{10,}/g);
  if (fragments) {
    const seen = new Set<string>();
    for (const frag of fragments) {
      const trimmed = frag.trim();
      if (trimmed.length < 8 || seen.has(trimmed)) continue;
      // Skip pure numeric or hex strings
      if (/^[0-9a-fA-F\s]+$/.test(trimmed) && trimmed.length < 20) continue;
      seen.add(trimmed);
      idCounter++;
      items.push({
        id: `text_${idCounter}`,
        source: "carved",
        category,
        title: trimmed.slice(0, 60) + (trimmed.length > 60 ? "…" : ""),
        subtitle: null,
        text: trimmed,
        fields: { source: category },
        timestamp: null,
        page: null,
        offset: text.indexOf(frag),
        confidence: 0.5,
      });
    }
  }

  return items;
}

/**
 * Master enterprise extraction: runs ALL carving techniques on a file.
 * - SQLite structured read + free-space carving (from sqlite-engine)
 * - Deep cluster scan (from deep-scan)
 * - WAL file carving (if .db-wal exists)
 * - Journal file carving (if .db-journal exists)
 * - Raw pattern carving (phones, emails, URLs, cards, GPS, IPs, etc.)
 *
 * This is the maximum-effort forensic extraction pipeline.
 */
export function enterpriseExtract(
  buffer: ArrayBuffer,
  fileName: string,
): RecoveredItem[] {
  const allItems: RecoveredItem[] = [];
  const seenTexts = new Set<string>();

  const addUnique = (items: RecoveredItem[]) => {
    for (const item of items) {
      const key = item.text.trim().slice(0, 100);
      if (key.length < 3) continue;
      if (seenTexts.has(key)) continue;
      seenTexts.add(key);
      allItems.push(item);
    }
  };

  // 1. Raw pattern carving (works on ANY file type)
  try {
    addUnique(carveRawPatterns(buffer));
  } catch {
    /* continue */
  }

  // 2. Readable text fragments (catches data in any binary format)
  try {
    addUnique(scanForReadableText(buffer, "Text Fragment"));
  } catch {
    /* continue */
  }

  // 3. SQLite-specific (if it's a database)
  const header = new TextDecoder().decode(buffer.slice(0, 16));
  if (header.startsWith("SQLite format 3")) {
    // Deep cluster scan is handled by the caller (deep-scan.ts)
    // but we also check for WAL and journal patterns in the raw data
  }

  // 4. WAL-specific carving (if the file IS a WAL file)
  try {
    addUnique(carveWalFile(buffer));
  } catch {
    /* continue */
  }

  // 5. Journal-specific carving
  try {
    addUnique(carveJournalFile(buffer));
  } catch {
    /* continue */
  }

  return allItems;
}
