import { createHmac, timingSafeEqual } from "crypto";

const SLACK_API = "https://slack.com/api";

export function verifySlackSignature(
  body: string,
  signature: string | null,
  timestamp: string | null,
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !signature || !timestamp) return false;
  const ts = parseInt(timestamp, 10);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;
  const base = `v0:${timestamp}:${body}`;
  const computed = "v0=" + createHmac("sha256", secret).update(base).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(computed);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function slack<T = Record<string, unknown>>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN missing");
  const r = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as { ok?: boolean; error?: string } & T;
  if (!j.ok) throw new Error(`slack ${method}: ${j.error ?? "unknown"}`);
  return j;
}

export function postMessage(args: { channel: string; text: string; thread_ts?: string; mrkdwn?: boolean }) {
  return slack<{ ts: string; channel: string }>("chat.postMessage", { mrkdwn: true, ...args });
}

export function updateMessage(args: { channel: string; ts: string; text: string }) {
  return slack<{ ts: string }>("chat.update", { ...args });
}

export function addReaction(args: { channel: string; timestamp: string; name: string }) {
  return slack("reactions.add", args).catch(() => {});
}

export function removeReaction(args: { channel: string; timestamp: string; name: string }) {
  return slack("reactions.remove", args).catch(() => {});
}
