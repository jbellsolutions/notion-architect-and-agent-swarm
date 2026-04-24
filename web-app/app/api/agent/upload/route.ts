import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no file" }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const isText = /^(text\/|application\/(json|xml|x-yaml))/.test(file.type) ||
    /\.(md|txt|csv|tsv|json|yaml|yml|log)$/i.test(file.name);

  if (isText) {
    return NextResponse.json({ kind: "text", name: file.name, text: buf.toString("utf8").slice(0, 200_000) });
  }

  // PDFs and other binaries — return base64 so the agent can process via tools
  return NextResponse.json({
    kind: "binary",
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: buf.length,
    base64: buf.toString("base64").slice(0, 5_000_000),
  });
}
