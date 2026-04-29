// Tiny pg Pool wrapper, lazy-initialized. Used by sessionMap (persistence) and runs (telemetry).
//
// All callers are async. If DATABASE_URL is missing we fall back to in-memory only — `init()`
// returns null and `isEnabled()` returns false. The Slack bridge degrades to ephemeral session
// state in that case (same behavior as before Wave 2).

import { Pool, PoolClient } from "pg";

let pool: Pool | null = null;
let initPromise: Promise<Pool | null> | null = null;

function makePool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return new Pool({
    connectionString: url,
    // Railway-managed Postgres uses a self-signed cert; rejectUnauthorized=false is the recommended setting.
    ssl: url.includes("sslmode=disable") ? undefined : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30_000,
  });
}

export function isEnabled(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export async function init(): Promise<Pool | null> {
  if (pool) return pool;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const p = makePool();
    if (!p) return null;
    const client = await p.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS slack_sessions (
          thread_key TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          agent_id TEXT,
          last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS runs (
          id BIGSERIAL PRIMARY KEY,
          thread_key TEXT,
          session_id TEXT,
          started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          ended_at TIMESTAMPTZ,
          status TEXT,
          tool_count INT,
          duration_ms INT,
          error TEXT
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS runs_started_idx ON runs (started_at DESC);`);
    } finally {
      client.release();
    }
    pool = p;
    return p;
  })();
  return initPromise;
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T | null> {
  const p = await init();
  if (!p) return null;
  const c = await p.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

// Convenience: runs telemetry
export async function startRun(args: {
  threadKey: string;
  sessionId: string;
}): Promise<number | null> {
  return withClient(async (c) => {
    const r = await c.query<{ id: string }>(
      "INSERT INTO runs (thread_key, session_id, status) VALUES ($1, $2, 'running') RETURNING id",
      [args.threadKey, args.sessionId],
    );
    return r.rows[0] ? Number(r.rows[0].id) : null;
  }).then((v) => v ?? null);
}

export async function endRun(args: {
  id: number | null;
  status: "ok" | "error" | "timeout";
  toolCount: number;
  durationMs: number;
  error?: string | null;
}): Promise<void> {
  if (args.id == null) return;
  await withClient(async (c) => {
    await c.query(
      "UPDATE runs SET ended_at = NOW(), status = $1, tool_count = $2, duration_ms = $3, error = $4 WHERE id = $5",
      [args.status, args.toolCount, args.durationMs, args.error ?? null, args.id],
    );
  });
}
