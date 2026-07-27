import { NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/db";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await getDb();
    const session = await db.collection(COLLECTIONS.sessions).findOne({ _id: id });
    if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const items = await db.collection(COLLECTIONS.items).find({ sessionId: id }).sort({ timestamp: -1 }).toArray();
    return NextResponse.json({
      session: { id: String(session._id), sourceType: session.sourceType, fileName: session.fileName,
        fileSizeBytes: session.fileSizeBytes, existingItems: session.existingItems,
        recoveredFragments: session.recoveredFragments, categoryCount: session.categoryCount,
        durationMs: session.durationMs, status: session.status, fileHash: session.fileHash,
        note: session.note, createdAt: session.createdAt instanceof Date ? session.createdAt.toISOString() : session.createdAt },
      items: items.map((m, i) => ({ id: `m${i}`, source: m.source, category: m.category, title: m.title,
        subtitle: m.subtitle, text: m.text, fields: m.fields ?? {}, timestamp: m.timestamp ?? null,
        page: m.page ?? null, offset: m.offset ?? null, confidence: m.confidence ?? null })),
    });
  } catch (err) { console.error("[GET /api/recovery/[id]]", err); return NextResponse.json({ error: "Failed" }, { status: 500 }); }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const db = await getDb();
    await db.collection(COLLECTIONS.items).deleteMany({ sessionId: id });
    await db.collection(COLLECTIONS.sessions).deleteOne({ _id: id });
    return NextResponse.json({ ok: true });
  } catch (err) { console.error("[DELETE]", err); return NextResponse.json({ error: "Failed" }, { status: 500 }); }
}
