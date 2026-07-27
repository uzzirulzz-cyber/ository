import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, COLLECTIONS } from "@/lib/db";
import { verifyPassword, createToken } from "@/lib/auth/auth";

const Schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const { email, password } = parsed.data;
    const db = await getDb();
    const user = await db.collection(COLLECTIONS.users).findOne({ email });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (!verifyPassword(password, user.passwordHash)) return NextResponse.json({ error: "Wrong password" }, { status: 401 });

    const token = createToken(String(user._id), email);
    return NextResponse.json({ token, user: { id: String(user._id), name: user.name, email } });
  } catch (err) {
    console.error("[login]", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
