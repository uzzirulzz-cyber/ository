import { NextResponse } from "next/server";
import { getDb, COLLECTIONS } from "@/lib/db";
import { getTokenFromRequest } from "@/lib/auth/auth";

export async function GET(req: Request) {
  try {
    const db = await getDb();
    const user = getTokenFromRequest(req);
    const filter = user ? { userId: user.userId } : {};
    const pipeline = [
      { $match: filter },
      { $group: { _id: null, totalSessions: { $sum: 1 }, totalLiveItems: { $sum: "$existingItems" },
        totalRecoveredFragments: { $sum: "$recoveredFragments" }, lastCreatedAt: { $max: "$createdAt" } } },
    ];
    const rows = await db.collection(COLLECTIONS.sessions).aggregate(pipeline).toArray() as Array<{
      totalSessions: number; totalLiveItems: number; totalRecoveredFragments: number; lastCreatedAt: Date | string;
    }>;
    if (rows.length === 0) return NextResponse.json({ totalSessions: 0, totalLiveItems: 0, totalRecoveredFragments: 0, lastRecoveryAt: null });
    const r = rows[0];
    return NextResponse.json({
      totalSessions: r.totalSessions ?? 0, totalLiveItems: r.totalLiveItems ?? 0,
      totalRecoveredFragments: r.totalRecoveredFragments ?? 0,
      lastRecoveryAt: r.lastCreatedAt instanceof Date ? r.lastCreatedAt.toISOString() : r.lastCreatedAt ?? null,
    });
  } catch (err) { console.error("[GET /api/stats]", err); return NextResponse.json({ error: "Failed" }, { status: 500 }); }
}
