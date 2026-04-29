// Synthetic supervisor: runs a tiny turn against the Managed Agent and confirms it can talk.
//
// Auth: header `x-cron-secret` must match `process.env.CRON_SECRET`.
// Logs result to runs table with thread_key='__healthcheck__'.
// On 2 consecutive synthetic failures OR 3 user-run failures in last 10 min: posts to
// #alerts (channel id from ALERTS_SLACK_CHANNEL) and DMs JUSTIN_SLACK_USER_ID.

import { NextRequest, NextResponse } from "next/server";
import { runTurn } from "@/lib/agentRun";
import { withClient, isEnabled } from "@/lib/db";
import { postMessage } from "@/lib/slack";
import { makeKey } from "@/lib/sessionMap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEALTHCHECK_CHANNEL = "__healthcheck__";
const HEALTHCHECK_USER = "__healthcheck__";
// IMPORTANT: must match the thread_key written to runs by agentRun.ts (via makeKey).
const HEALTHCHECK_KEY = makeKey(HEALTHCHECK_CHANNEL, undefined, HEALTHCHECK_USER);

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }

async function handle(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const got = req.headers.get("x-cron-secret");
  if (!expected || !got || got !== expected) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  const t0 = Date.now();
  const result = await runTurn({
    channel: HEALTHCHECK_CHANNEL,
    threadTs: undefined,
    user: HEALTHCHECK_USER,
    text: "Reply with the single word PONG and nothing else.",
    title: "Healthcheck",
  }).catch((e) => ({
    sessionId: "",
    text: "",
    toolCalls: 0,
    truncated: false,
    error: `exception: ${e?.message ?? e}`,
  }));

  const latencyMs = Date.now() - t0;
  const replyText = (result.text ?? "").trim();
  const ok = !result.error && /\bPONG\b/i.test(replyText);

  // Decide whether to alert.
  let alerted = false;
  if (!ok && isEnabled()) {
    try {
      const recent = await withClient(async (c) => {
        const r = await c.query<{
          synthetic_failures: string;
          user_failures: string;
        }>(
          `WITH last_two_synth AS (
             SELECT status FROM runs
             WHERE thread_key = $1
             ORDER BY started_at DESC LIMIT 2
           ), recent_user AS (
             SELECT status FROM runs
             WHERE thread_key <> $1 AND started_at > NOW() - INTERVAL '10 minutes'
           )
           SELECT
             (SELECT COUNT(*) FROM last_two_synth WHERE status <> 'ok')::text AS synthetic_failures,
             (SELECT COUNT(*) FROM recent_user WHERE status <> 'ok')::text AS user_failures`,
          [HEALTHCHECK_KEY],
        );
        return r.rows[0];
      });
      const syntheticFails = Number(recent?.synthetic_failures ?? 0);
      const userFails = Number(recent?.user_failures ?? 0);
      if (syntheticFails >= 2 || userFails >= 3) {
        const msg = `🚨 *Ops Orchestrator unhealthy*\n• Synthetic failures (last 2): ${syntheticFails}\n• User-run failures (last 10 min): ${userFails}\n• Last error: \`${result.error ?? "no error, but reply did not match"}\`\n• Last reply: \`${replyText.slice(0, 200) || "(empty)"}\``;
        const channel = process.env.ALERTS_SLACK_CHANNEL;
        const dm = process.env.JUSTIN_SLACK_USER_ID;
        if (channel) await postMessage({ channel, text: msg }).catch(() => {});
        if (dm) await postMessage({ channel: dm, text: msg }).catch(() => {});
        alerted = true;
      }
    } catch (e) {
      console.error("alert-decision failed:", e);
    }
  }

  return NextResponse.json({
    ok,
    latency_ms: latencyMs,
    response: replyText.slice(0, 100),
    error: result.error ?? null,
    alerted,
    session_id: result.sessionId,
  });
}
