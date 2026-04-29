import { NextRequest } from "next/server";
import { isAuthed } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BETA = "agent-api-2026-03-01";
const HEARTBEAT_MS = 25_000;

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

  // Wrap upstream body in a TransformStream that:
  //   1) forwards every upstream chunk through unchanged
  //   2) emits `: ping\n\n` every HEARTBEAT_MS when idle (resets on each upstream chunk)
  //   3) closes cleanly on `event: session.status_idle`
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  let textBuffer = ""; // for status_idle detection
  let lastActivityAt = Date.now();

  const ts = new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      heartbeatTimer = setInterval(() => {
        if (closed) return;
        if (Date.now() - lastActivityAt < HEARTBEAT_MS) return;
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          // controller may have been closed if browser disconnected
          if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
        }
      }, HEARTBEAT_MS);
    },
    transform(chunk, controller) {
      lastActivityAt = Date.now();
      controller.enqueue(chunk);
      // Detect status_idle so we can close gracefully and stop the upstream read loop.
      try {
        textBuffer += decoder.decode(chunk, { stream: true });
        // keep buffer bounded
        if (textBuffer.length > 16_000) textBuffer = textBuffer.slice(-8_000);
        if (textBuffer.includes("\"status_idle\"") || textBuffer.includes("session.status_idle")) {
          // schedule close on next tick so the chunk fully flushes
          setTimeout(() => {
            if (!closed) {
              closed = true;
              if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
              try { controller.terminate(); } catch {}
            }
          }, 50);
        }
      } catch {}
    },
    flush() {
      closed = true;
      if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
    },
  });

  // pipe upstream → transform; consumer (browser) reads the transform's readable side
  upstream.body.pipeTo(ts.writable).catch(() => {
    closed = true;
    if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  });

  return new Response(ts.readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
