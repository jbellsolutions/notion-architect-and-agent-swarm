// /admin/status — auth-gated reliability dashboard.
// Shows last 50 turns + aggregates (success rate 1h/24h, p50/p95 duration, last healthcheck).

import { withClient, isEnabled } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Run = {
  id: number;
  thread_key: string | null;
  session_id: string | null;
  started_at: string;
  ended_at: string | null;
  status: string | null;
  tool_count: number | null;
  duration_ms: number | null;
  error: string | null;
};

type Agg = {
  total_1h: number;
  ok_1h: number;
  total_24h: number;
  ok_24h: number;
  p50_ms: number | null;
  p95_ms: number | null;
  last_healthcheck_at: string | null;
  last_healthcheck_status: string | null;
};

async function loadData(): Promise<{ runs: Run[]; agg: Agg | null; enabled: boolean }> {
  if (!isEnabled()) return { runs: [], agg: null, enabled: false };
  const data = await withClient(async (c) => {
    const runs = (await c.query<Run>(
      "SELECT id, thread_key, session_id, started_at, ended_at, status, tool_count, duration_ms, error FROM runs ORDER BY started_at DESC LIMIT 50",
    )).rows;
    const agg = (await c.query<Agg>(`
      SELECT
        (SELECT COUNT(*) FROM runs WHERE started_at > NOW() - INTERVAL '1 hour')::int AS total_1h,
        (SELECT COUNT(*) FROM runs WHERE started_at > NOW() - INTERVAL '1 hour' AND status = 'ok')::int AS ok_1h,
        (SELECT COUNT(*) FROM runs WHERE started_at > NOW() - INTERVAL '24 hours')::int AS total_24h,
        (SELECT COUNT(*) FROM runs WHERE started_at > NOW() - INTERVAL '24 hours' AND status = 'ok')::int AS ok_24h,
        (SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY duration_ms) FROM runs WHERE duration_ms IS NOT NULL AND started_at > NOW() - INTERVAL '24 hours')::int AS p50_ms,
        (SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY duration_ms) FROM runs WHERE duration_ms IS NOT NULL AND started_at > NOW() - INTERVAL '24 hours')::int AS p95_ms,
        (SELECT started_at::text FROM runs WHERE thread_key = '__healthcheck__' ORDER BY started_at DESC LIMIT 1) AS last_healthcheck_at,
        (SELECT status FROM runs WHERE thread_key = '__healthcheck__' ORDER BY started_at DESC LIMIT 1) AS last_healthcheck_status
    `)).rows[0] ?? null;
    return { runs, agg };
  });
  return { runs: data?.runs ?? [], agg: data?.agg ?? null, enabled: true };
}

function pct(ok: number, total: number): string {
  if (total === 0) return "—";
  return `${((ok / total) * 100).toFixed(1)}%`;
}

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default async function StatusPage() {
  const { runs, agg, enabled } = await loadData();

  if (!enabled) {
    return (
      <main className="p-8 max-w-5xl mx-auto text-zinc-200">
        <h1 className="text-2xl font-semibold mb-4">Status</h1>
        <p className="text-zinc-400">DATABASE_URL is not set — Postgres-backed telemetry disabled. Provision Railway Postgres to enable this page.</p>
      </main>
    );
  }

  return (
    <main className="p-8 max-w-5xl mx-auto text-zinc-200">
      <h1 className="text-2xl font-semibold mb-6">Ops Orchestrator Status</h1>

      {agg && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card label="Success (1h)" value={pct(agg.ok_1h, agg.total_1h)} sub={`${agg.ok_1h}/${agg.total_1h}`} />
          <Card label="Success (24h)" value={pct(agg.ok_24h, agg.total_24h)} sub={`${agg.ok_24h}/${agg.total_24h}`} />
          <Card label="p50 / p95 duration" value={`${fmtMs(agg.p50_ms)} / ${fmtMs(agg.p95_ms)}`} sub="last 24h" />
          <Card
            label="Last healthcheck"
            value={agg.last_healthcheck_status ?? "—"}
            sub={agg.last_healthcheck_at ? new Date(agg.last_healthcheck_at).toLocaleString() : "never"}
          />
        </div>
      )}

      <h2 className="text-lg font-semibold mb-3">Last 50 runs</h2>
      <div className="overflow-x-auto rounded border border-zinc-800">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              <th className="text-left px-3 py-2">Started</th>
              <th className="text-left px-3 py-2">Thread</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Duration</th>
              <th className="text-right px-3 py-2">Tools</th>
              <th className="text-left px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-zinc-800 hover:bg-zinc-900/50">
                <td className="px-3 py-2 whitespace-nowrap">{new Date(r.started_at).toLocaleString()}</td>
                <td className="px-3 py-2 truncate max-w-[200px]" title={r.thread_key ?? ""}>{r.thread_key ?? "—"}</td>
                <td className="px-3 py-2">
                  <span className={
                    r.status === "ok" ? "text-emerald-400"
                    : r.status === "running" ? "text-zinc-400"
                    : "text-rose-400"
                  }>{r.status ?? "—"}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMs(r.duration_ms)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{r.tool_count ?? "—"}</td>
                <td className="px-3 py-2 text-rose-400 truncate max-w-[260px]" title={r.error ?? ""}>{r.error ?? ""}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-zinc-500">No runs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-zinc-500 mt-1">{sub}</div>}
    </div>
  );
}
