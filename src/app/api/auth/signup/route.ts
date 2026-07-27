import { NextResponse } from "next/server";
import { z } from "zod";
import { getDb, COLLECTIONS } from "@/lib/db";
import { hashPassword, createToken } from "@/lib/auth/auth";

const Schema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const { name, email, password } = parsed.data;
    const db = await getDb();
    const existing = await db.collection(COLLECTIONS.users).findOne({ email });
    if (existing) return NextResponse.json({ error: "Email already registered" }, { status: 409 });

    const user = {
      name, email,
      passwordHash: hashPassword(password),
      createdAt: new Date(),
    };
    const result = await db.collection(COLLECTIONS.users).insertOne(user);
    const token = createToken(String(result.insertedId), email);
    return NextResponse.json({ token, user: { id: String(result.insertedId), name, email } });
  } catch (err) {
    console.error("[signup]", err);
    return NextResponse.json({ error: "Signup failed" }, { status: 500 });
  }
}
