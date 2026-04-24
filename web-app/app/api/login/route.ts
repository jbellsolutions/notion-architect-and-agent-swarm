import { NextRequest, NextResponse } from "next/server";
import { checkPassword, setAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (!checkPassword(password ?? "")) return NextResponse.json({ ok: false }, { status: 401 });
  await setAuth();
  return NextResponse.json({ ok: true });
}
