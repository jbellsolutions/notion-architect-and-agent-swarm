// One-shot helper: send a user message to a session and return the assembled agent reply.
// Used by the Slack bridge so we can post a single Slack message with the final answer.

import { createSession, sendUserMessage } from "@/lib/anthropic";
import { get as sessionGet, set as sessionSet, makeKey } from "@/lib/sessionMap";

const BASE = "https://api.anthropic.com/v1";
const STREAM_BETA = "agent-api-2026-03-01";
const MAX_WAIT_MS = 90_000;

export type RunResult = { sessionId: string; text: string; toolCalls: number; truncated: boolean; error?: string };

export async function runTurn(opts: {
  channel: string;
  threadTs?: string;
  user?: string;
  text: string;
  title?: string;
}): Promise<RunResult> {
  const key = makeKey(opts.channel, opts.threadTs, opts.user);
  let sessionId = sessionGet(key);
  if (!sessionId) {
    const s = await createSession(opts.title);
    sessionId = s.id;
    sessionSet(key, sessionId);
  }

  await sendUserMessage(sessionId, [{ type: "text", text: opts.text }]);

  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MAX_WAIT_MS);
  const r = await fetch(`${BASE}/sessions/${sessionId}/stream`, {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-beta": STREAM_BETA,
      Accept: "text/event-stream",
    },
    signal: ctrl.signal,
  });
  if (!r.ok || !r.body) {
    clearTimeout(timer);
    return { sessionId, text: "", toolCalls: 0, truncated: false, error: `stream ${r.status}` };
  }

  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let toolCalls = 0;
  let truncated = false;
  let lastError: string | undefined;
  let done = false;

  while (!done) {
    const { value, done: streamDone } = await reader.read().catch(() => ({ value: undefined, done: true }));
    if (streamDone) { truncated = true; break; }
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      let evt: any;
      try { evt = JSON.parse(line.slice(6)); } catch { continue; }
      const t = evt?.type;
      if (t === "agent") {
        for (const b of evt.content ?? []) if (b?.type === "text") text += b.text ?? "";
      } else if (t === "tool_use") {
        toolCalls += 1;
      } else if (t === "error" || t === "session_error") {
        lastError = evt.error?.message ?? "unknown error";
      } else if (t === "status_idle") {
        done = true;
        break;
      }
    }
  }
  clearTimeout(timer);
  reader.cancel().catch(() => {});

  return { sessionId, text, toolCalls, truncated, error: lastError };
}
