// One-shot helper: send a user message to a session and stream the agent reply.
// Used by the Slack bridge so we can post a single Slack message that updates as text/tools arrive.

import { createSession, sendUserMessage } from "@/lib/anthropic";
import { getAsync as sessionGet, setAsync as sessionSet, makeKey } from "@/lib/sessionMap";
import { startRun, endRun } from "@/lib/db";

const BASE = "https://api.anthropic.com/v1";
const STREAM_BETA = "agent-api-2026-03-01";
const MAX_WAIT_MS = 480_000; // 8 min — Composio multi-step queries routinely exceed 90s
const RETRY_DELAY_MS = 3_000;

export type ProgressEvent =
  | { type: "text"; textDelta: string; total: string }
  | { type: "tool_use"; toolName: string; toolCount: number }
  | { type: "tool_result"; toolName?: string; toolCount: number };

export type RunResult = {
  sessionId: string;
  text: string;
  toolCalls: number;
  truncated: boolean;
  error?: string;
  retried?: boolean;
};

export type RunOpts = {
  channel: string;
  threadTs?: string;
  user?: string;
  text: string;
  title?: string;
  onProgress?: (evt: ProgressEvent) => void;
};

export async function runTurn(opts: RunOpts): Promise<RunResult> {
  const key = makeKey(opts.channel, opts.threadTs, opts.user);
  let sessionId = await sessionGet(key);
  if (!sessionId) {
    const s = await createSession(opts.title);
    sessionId = s.id;
    await sessionSet(key, sessionId);
  }

  await sendUserMessage(sessionId, [{ type: "text", text: opts.text }]);

  const startedAt = Date.now();
  const runId = await startRun({ threadKey: key, sessionId }).catch(() => null);

  // Try the stream; on connect failure / 5xx / immediate drop, retry once after 3s.
  let attempt = 0;
  let result: RunResult | null = null;
  let retried = false;
  while (attempt < 2) {
    const r = await streamOnce({ sessionId, onProgress: opts.onProgress });
    if (r.error && /^stream 5\d\d/.test(r.error) && r.text.length === 0 && attempt === 0) {
      attempt += 1;
      retried = true;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      continue;
    }
    result = r;
    break;
  }
  if (!result) result = { sessionId, text: "", toolCalls: 0, truncated: true, error: "no result" };

  const status: "ok" | "error" | "timeout" = result.error
    ? "error"
    : result.truncated
      ? "timeout"
      : "ok";
  endRun({
    id: runId,
    status,
    toolCount: result.toolCalls,
    durationMs: Date.now() - startedAt,
    error: result.error ?? null,
  }).catch(() => {});

  return { ...result, sessionId, retried };
}

async function streamOnce(opts: {
  sessionId: string;
  onProgress?: (evt: ProgressEvent) => void;
}): Promise<RunResult> {
  const { sessionId, onProgress } = opts;
  const apiKey = process.env.ANTHROPIC_API_KEY!;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MAX_WAIT_MS);

  let r: Response;
  try {
    r = await fetch(`${BASE}/sessions/${sessionId}/stream`, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": STREAM_BETA,
        Accept: "text/event-stream",
      },
      signal: ctrl.signal,
    });
  } catch (e: any) {
    clearTimeout(timer);
    return { sessionId, text: "", toolCalls: 0, truncated: false, error: `stream connect: ${e?.message ?? e}` };
  }

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
        for (const b of evt.content ?? []) {
          if (b?.type === "text") {
            const delta = b.text ?? "";
            if (delta) {
              text += delta;
              try { onProgress?.({ type: "text", textDelta: delta, total: text }); } catch {}
            }
          }
        }
      } else if (t === "tool_use") {
        toolCalls += 1;
        const toolName = evt.name ?? evt.tool_name ?? "tool";
        try { onProgress?.({ type: "tool_use", toolName, toolCount: toolCalls }); } catch {}
      } else if (t === "tool_result") {
        try { onProgress?.({ type: "tool_result", toolName: evt.name, toolCount: toolCalls }); } catch {}
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
