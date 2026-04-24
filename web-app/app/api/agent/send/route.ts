import { NextRequest, NextResponse } from "next/server";
import { sendUserMessage } from "@/lib/anthropic";
import { isAuthed } from "@/lib/auth";

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauth" }, { status: 401 });
  try {
    const { sessionId, text, attachments } = await req.json();
    if (!sessionId || (!text && (!Array.isArray(attachments) || attachments.length === 0)))
      return NextResponse.json({ error: "missing sessionId or content" }, { status: 400 });

    const content: Array<Record<string, unknown>> = [];
    if (text) content.push({ type: "text", text });
    if (Array.isArray(attachments)) {
      for (const a of attachments) {
        if (a?.kind === "text" && a.text) content.push({ type: "text", text: `\n\n[Attachment: ${a.name ?? "file"}]\n${a.text}` });
        else if (a?.kind === "binary" && a.name) content.push({ type: "text", text: `\n\n[Attachment: ${a.name} (${a.mime}, ${a.size} bytes) — base64 truncated]` });
      }
    }

    await sendUserMessage(sessionId, content);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e instanceof Error ? e.message : e) }, { status: 500 });
  }
}
