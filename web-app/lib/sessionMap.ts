// Per-Slack-thread → Anthropic session mapping. In-memory; resets on deploy.
// Sessions are scoped per Slack thread (thread_ts) so threaded replies share context.
// Top-level (non-thread) DMs use a sentinel "_dm:<user>" key.

type Entry = { sessionId: string; lastUsed: number };

const map = new Map<string, Entry>();
const TTL_MS = 1000 * 60 * 60 * 6; // 6 hours

function gc() {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of map.entries()) if (v.lastUsed < cutoff) map.delete(k);
}

export function get(key: string): string | null {
  gc();
  const e = map.get(key);
  if (!e) return null;
  e.lastUsed = Date.now();
  return e.sessionId;
}

export function set(key: string, sessionId: string) {
  map.set(key, { sessionId, lastUsed: Date.now() });
}

export function clear(key: string) {
  map.delete(key);
}

export function makeKey(channel: string, threadTs?: string, user?: string) {
  if (threadTs) return `t:${channel}:${threadTs}`;
  if (user) return `dm:${channel}:${user}`;
  return `c:${channel}`;
}
