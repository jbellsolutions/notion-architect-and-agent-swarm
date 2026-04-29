// Per-Slack-thread → Anthropic session mapping.
//
// Two-layer:
//   1) In-memory cache (fast, lost on restart)
//   2) Postgres-backed persistence via lib/db (survives restarts, 6h TTL on read)
//
// The synchronous `get` returns from the cache; if the cache is empty (e.g. just after a deploy)
// the caller can `await getAsync` to hit Postgres. Slack bridge uses the async API so threads
// keep their session through deploys.

import { withClient, isEnabled } from "@/lib/db";

type Entry = { sessionId: string; lastUsed: number };

const cache = new Map<string, Entry>();
const TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function gc() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of cache.entries()) if (v.lastUsed < cutoff) cache.delete(k);
}

export function get(key: string): string | null {
  gc();
  const e = cache.get(key);
  if (!e) return null;
  e.lastUsed = Date.now();
  return e.sessionId;
}

export async function getAsync(key: string): Promise<string | null> {
  const cached = get(key);
  if (cached) return cached;
  if (!isEnabled()) return null;
  const row = await withClient(async (c) => {
    const r = await c.query<{ session_id: string; last_used_at: Date }>(
      "SELECT session_id, last_used_at FROM slack_sessions WHERE thread_key = $1",
      [key],
    );
    return r.rows[0] ?? null;
  });
  if (!row) return null;
  if (Date.now() - new Date(row.last_used_at).getTime() > TTL_MS) return null;
  cache.set(key, { sessionId: row.session_id, lastUsed: Date.now() });
  // bump last_used_at async (fire and forget)
  withClient((c) => c.query("UPDATE slack_sessions SET last_used_at = NOW() WHERE thread_key = $1", [key])).catch(() => {});
  return row.session_id;
}

export function set(key: string, sessionId: string) {
  cache.set(key, { sessionId, lastUsed: Date.now() });
}

export async function setAsync(key: string, sessionId: string, agentId?: string): Promise<void> {
  set(key, sessionId);
  if (!isEnabled()) return;
  await withClient(async (c) => {
    await c.query(
      `INSERT INTO slack_sessions (thread_key, session_id, agent_id, last_used_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (thread_key) DO UPDATE
       SET session_id = EXCLUDED.session_id,
           agent_id = COALESCE(EXCLUDED.agent_id, slack_sessions.agent_id),
           last_used_at = NOW()`,
      [key, sessionId, agentId ?? null],
    );
  });
}

export function clear(key: string) {
  cache.delete(key);
}

export function makeKey(channel: string, threadTs?: string, user?: string) {
  if (threadTs) return `t:${channel}:${threadTs}`;
  if (user) return `dm:${channel}:${user}`;
  return `c:${channel}`;
}
