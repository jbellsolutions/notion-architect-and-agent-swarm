import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "OPENAI_API_KEY missing" }, { status: 500 });

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File)) return NextResponse.json({ error: "no audio" }, { status: 400 });

  const openai = new OpenAI({ apiKey });
  const result = await openai.audio.transcriptions.create({
    file: audio,
    model: "whisper-1",
  });
  return NextResponse.json({ text: result.text });
}
