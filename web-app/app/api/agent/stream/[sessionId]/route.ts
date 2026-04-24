import { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BETA = "agent-api-2026-03-01";

export async function GET(req: NextRequest, ctx: { params: Promise<{ sessionId: string }> }) {
  if (!(await isAuthed())) return new Response("unauth", { status: 401 });
  const { sessionId } = await ctx.params;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return new Response("no key", { status: 500 });

  const upstream = await fetch(`https://api.anthropic.com/v1/sessions/${sessionId}/stream`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": BETA,
      "Accept": "text/event-stream",
    },
    signal: req.signal,
  });

  if (!upstream.ok || !upstream.body) {
    const txt = await upstream.text().catch(() => "");
    return new Response(`upstream ${upstream.status}: ${txt}`, { status: 502 });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
