import { NextRequest, NextResponse } from "next/server";
import { createSession } from "@/lib/anthropic";
import { isAuthed } from "@/lib/auth";

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauth" }, { status: 401 });
  try {
    const { title } = await req.json().catch(() => ({}));
    const s = await createSession(title);
    return NextResponse.json({ id: s.id, title: s.title });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
