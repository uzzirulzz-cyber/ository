// Deep cluster scanner: examines EVERY page/cluster of a SQLite file for
// recoverable data — not just free space, but also active page slack space,
// journal remnants, and every byte of freelist pages. Reports findings by
// page number and cluster.

import type { RecoveredItem } from "./types";

interface ClusterScanResult {
  totalPages: number;
  pageSize: number;
  clusters: {
    page: number;
    pageType: string;
    liveRecords: number;
    deletedFragments: number;
    bytesScanned: number;
  }[];
  recoveredItems: RecoveredItem[];
  warnings: string[];
}

function readUint16BE(view: DataView, offset: number): number {
  return (view.getUint8(offset) << 8) | view.getUint8(offset + 1);
}

function readUint32BE(view: DataView, offset: number): number {
  return (
    (view.getUint8(offset) << 24) |
    (view.getUint8(offset + 1) << 16) |
    (view.getUint8(offset + 2) << 8) |
    view.getUint8(offset + 3)
  );
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
  } catch {
    return null;
  }
}

function isPlausibleTimestamp(ms: number): boolean {
  if (ms <= 0) return false;
  return ms >= Date.UTC(2009, 0, 1) && ms <= Date.now() + 86_400_000;
}

const PAGE_TYPES: Record<number, string> = {
  0x02: "Interior Index",
  0x05: "Interior Table",
  0x0a: "Leaf Index",
  0x0d: "Leaf Table",
};

/**
 * Deep-scan every page/cluster of a SQLite database file. For each page,
 * extract both live records AND deleted fragments from free space, slack
 * space, and unallocated regions. Returns per-cluster statistics plus all
 * recovered items.
 */
export function deepClusterScan(buffer: ArrayBuffer): ClusterScanResult {
  const view = new DataView(buffer);
  const warnings: string[] = [];
  const clusters: ClusterScanResult["clusters"] = [];
  const recoveredItems: RecoveredItem[] = [];

  const psRaw = readUint16BE(view, 16);
  const pageSize = psRaw === 1 ? 65536 : psRaw;
  const pageCount = readUint32BE(view, 28);
  const freelistTrunk = readUint32BE(view, 32);

  if (pageSize === 0 || (pageSize & (pageSize - 1)) !== 0 || pageCount === 0) {
    warnings.push("Could not parse SQLite header.");
    return { totalPages: 0, pageSize: 0, clusters: [], recoveredItems: [], warnings };
  }

  const liveTexts = new Set<string>();
  let itemId = 0;

  for (let page = 1; page <= pageCount; page++) {
    const pageStart = (page - 1) * pageSize;
    if (pageStart + pageSize > view.byteLength) break;

    const pageType = view.getUint8(pageStart);
    const typeLabel = PAGE_TYPES[pageType] ?? `Unknown (0x${pageType.toString(16)})`;
    let liveRecords = 0;
    let deletedFragments = 0;
    const bytesScanned = Math.min(pageSize, view.byteLength - pageStart);

    // For leaf table pages, scan for records
    if (pageType === 0x0d) {
      const cellCount = readUint16BE(view, pageStart + 3);
      const cellContentStart =
        readUint16BE(view, pageStart + 5) === 0 ? 65536 : readUint16BE(view, pageStart + 5);
      const headerEnd = pageStart + 8 + cellCount * 2;

      // Count live cells
      liveRecords = cellCount;

      // Scan unallocated gap for deleted records
      const gapStart = headerEnd;
      const gapEnd = pageStart + cellContentStart;
      if (gapEnd > gapStart + 4) {
        const gapHits = scanRegionForRecords(view, gapStart, gapEnd - gapStart);
        for (const h of gapHits) {
          const text = h.text.replace(/^[\x00-\x1f\x7f-\xff]+/, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]+$/, "");
          if (text.trim().length < 3 || liveTexts.has(text.trim())) continue;
          liveTexts.add(text.trim());
          itemId++;
          deletedFragments++;
          recoveredItems.push({
            id: `d${itemId}`,
            source: "carved",
            category: "Deleted",
            title: text.slice(0, 60) + (text.length > 60 ? "…" : ""),
            subtitle: null,
            text,
            fields: { region: "unallocated_gap" },
            timestamp: h.timestamp,
            page,
            offset: gapStart - pageStart,
            confidence: h.confidence,
          });
        }
      }

      // Scan free blocks
      let freeBlock = readUint16BE(view, pageStart + 1);
      const guard = new Set<number>();
      while (freeBlock !== 0 && freeBlock < pageSize && !guard.has(freeBlock)) {
        guard.add(freeBlock);
        const fbStart = pageStart + freeBlock;
        const next = readUint16BE(view, fbStart);
        const size = readUint16BE(view, fbStart + 2);
        if (size > 4 && fbStart + size <= pageStart + pageSize) {
          const fbHits = scanRegionForRecords(view, fbStart + 4, size - 4);
          for (const h of fbHits) {
            const text = h.text.replace(/^[\x00-\x1f\x7f-\xff]+/, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]+$/, "");
            if (text.trim().length < 3 || liveTexts.has(text.trim())) continue;
            liveTexts.add(text.trim());
            itemId++;
            deletedFragments++;
            recoveredItems.push({
              id: `d${itemId}`,
              source: "carved",
              category: "Deleted",
              title: text.slice(0, 60) + (text.length > 60 ? "…" : ""),
              subtitle: null,
              text,
              fields: { region: "free_block" },
              timestamp: h.timestamp,
              page,
              offset: freeBlock,
              confidence: h.confidence,
            });
          }
        }
        freeBlock = next;
      }
    }

    // For ALL page types, also scan the entire page for any record-like
    // patterns (catches data in interior pages, index pages, etc.)
    const fullPageHits = scanRegionForRecords(view, pageStart, bytesScanned);
    for (const h of fullPageHits) {
      const text = h.text.replace(/^[\x00-\x1f\x7f-\xff]+/, "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]+$/, "");
      if (text.trim().length < 5 || liveTexts.has(text.trim())) continue;
      // Only add if not already found in the targeted scans above
      liveTexts.add(text.trim());
      itemId++;
      deletedFragments++;
      recoveredItems.push({
        id: `d${itemId}`,
        source: "carved",
        category: "Deleted",
        title: text.slice(0, 60) + (text.length > 60 ? "…" : ""),
        subtitle: null,
        text,
        fields: { region: "full_page_scan" },
        timestamp: h.timestamp,
        page,
        offset: 0,
        confidence: h.confidence * 0.8, // slightly lower confidence for full-page hits
      });
    }

    // For freelist pages, scan the entire page content
    // (handled by the full-page scan above)

    clusters.push({
      page,
      pageType: typeLabel,
      liveRecords,
      deletedFragments,
      bytesScanned,
    });
  }

  // Also scan the freelist trunk pages specifically
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
        // Already scanned by full-page scan, but log it
        const existing = clusters.find((c) => c.page === leafPage);
        if (existing) {
          existing.pageType += " (Freelist)";
        }
      }
    }
    trunk = nextTrunk;
  }

  return {
    totalPages: pageCount,
    pageSize,
    clusters,
    recoveredItems,
    warnings,
  };
}

function scanRegionForRecords(
  view: DataView,
  offset: number,
  length: number,
): { text: string; timestamp: number | null; confidence: number }[] {
  const found: { text: string; timestamp: number | null; confidence: number }[] = [];
  const end = offset + length;
  let pos = offset;
  while (pos < end - 2) {
    const headerLenByte = view.getUint8(pos);
    if (headerLenByte < 2 || headerLenByte > 64) { pos++; continue; }
    const decoded = tryDecodeRecord(view, pos, end - pos);
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

function tryDecodeRecord(
  view: DataView,
  offset: number,
  maxLen: number,
): { texts: string[]; timestamp: number | null; recordEnd: number } | null {
  const end = Math.min(offset + maxLen, view.byteLength);
  let pos = offset;
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
      let v = 0;
      for (let i = 0; i < 8; i++) v = v * 256 + view.getUint8(bodyPos + i);
      if (isPlausibleTimestamp(v)) timestamp = v;
    } else if (st === 5) {
      let v = 0;
      for (let i = 0; i < 6; i++) v = v * 256 + view.getUint8(bodyPos + i);
      if (isPlausibleTimestamp(v)) timestamp = v;
    } else if (st === 4) {
      const v = readUint32BE(view, bodyPos);
      if (isPlausibleTimestamp(v)) timestamp = v;
    }
    bodyPos += len;
  }
  return { texts, timestamp, recordEnd: bodyPos };
}
