import { NextResponse } from "next/server";
import { getTokenFromRequest } from "@/lib/auth/auth";

export async function GET(req: Request) {
  const user = getTokenFromRequest(req);
  if (!user) return NextResponse.json({ valid: false }, { status: 401 });
  return NextResponse.json({ valid: true, user });
}
