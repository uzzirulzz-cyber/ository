import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { getDb, COLLECTIONS } from "@/lib/db";
import { getTokenFromRequest } from "@/lib/auth/auth";

const ItemSchema = z.object({
  id: z.string(), source: z.enum(["table","carved"]), category: z.string(),
  title: z.string(), subtitle: z.string().nullable(), text: z.string(),
  fields: z.record(z.string(), z.string().nullable()), timestamp: z.number().nullable(),
  page: z.number().nullable(), offset: z.number().nullable(), confidence: z.number().nullable(),
});
const CreateSchema = z.object({
  sourceType: z.string(), fileName: z.string(), fileSizeBytes: z.number(),
  existingItems: z.number(), recoveredFragments: z.number(), categoryCount: z.number(),
  durationMs: z.number(), status: z.string(), fileHash: z.string(),
  note: z.string().nullable().optional(), items: z.array(ItemSchema),
  categorySummary: z.array(z.object({ category: z.string(), live: z.number(), recovered: z.number() })),
});

export async function GET(req: Request) {
  try {
    const db = await getDb();
    const user = getTokenFromRequest(req);
    const filter = user ? { userId: user.userId } : {};
    const sessions = await db.collection(COLLECTIONS.sessions).find(filter).sort({ createdAt: -1 }).limit(100).toArray();
    const data = sessions.map(s => ({
      id: String(s._id), sourceType: s.sourceType, fileName: s.fileName,
      fileSizeBytes: s.fileSizeBytes, existingItems: s.existingItems,
      recoveredFragments: s.recoveredFragments, categoryCount: s.categoryCount,
      durationMs: s.durationMs, status: s.status, fileHash: s.fileHash,
      note: s.note, createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    }));
    return NextResponse.json({ items: data });
  } catch (err) { console.error("[GET /api/recovery]", err); return NextResponse.json({ error: "Failed" }, { status: 500 }); }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });
    const d = parsed.data;
    const db = await getDb();
    const user = getTokenFromRequest(req);
    const sessionId = randomUUID();
    const sanitize = (s: string | null): string | null => s ? s.replace(/\0/g,"").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,"") : null;

    await db.collection(COLLECTIONS.sessions).insertOne({
      _id: sessionId, userId: user?.userId ?? null,
      sourceType: d.sourceType, fileName: sanitize(d.fileName), fileSizeBytes: d.fileSizeBytes,
      existingItems: d.existingItems, recoveredFragments: d.recoveredFragments,
      categoryCount: d.categoryCount, durationMs: d.durationMs, status: d.status,
      fileHash: d.fileHash, note: d.note ?? null, categorySummary: d.categorySummary,
      createdAt: new Date(),
    });
    if (d.items.length > 0) {
      const docs = d.items.map(m => ({
        _id: `${sessionId}:${m.id}`, sessionId,
        source: m.source, category: sanitize(m.category), title: sanitize(m.title),
        subtitle: sanitize(m.subtitle), text: sanitize(m.text), fields: m.fields ?? {},
        timestamp: m.timestamp, page: m.page, offset: m.offset, confidence: m.confidence,
        createdAt: new Date(),
      }));
      await db.collection(COLLECTIONS.items).insertMany(docs, { ordered: false });
    }
    return NextResponse.json({ id: sessionId, createdAt: new Date().toISOString() });
  } catch (err) { console.error("[POST /api/recovery]", err); return NextResponse.json({ error: "Failed" }, { status: 500 }); }
}
