# Reliability — Always-On Architecture

This system is built so that you can DM `@Ops Orchestrator` from Slack at 3am from a hotel and trust it answered. That requires more than "deploy a Next.js app and hope" — it requires layers of independent supervision so any single component can fail without taking the system down silently.

## Defense in depth

Each layer assumes the previous one might fail. The whole stack survives because the layers are **independent** — they don't share infrastructure, processes, or alert paths.

| Layer | What it does | Where it lives | Why independent |
|---|---|---|---|
| **L1: Container self-heal** | Restarts the web service on crash | Railway, `restartPolicy: ON_FAILURE`, retries=10 | Railway's runtime supervises the Node process |
| **L2: Persistent state** | Survives restart — Slack threads keep their session through deploys | Railway Postgres, `slack_sessions` + `runs` tables | Separate database container |
| **L3: Internal supervisor** | Active probe — runs a real PONG turn through the agent every 5 min, alerts on consecutive failures | `/api/cron/healthcheck` + a cron service | Two cron sources — see below |
| **L4: External uptime monitor** | Independent eye — pings `/api/health` from outside our infra | UptimeRobot (free tier) | Different cloud, different alert path |
| **L5: Build-failure alerts** | Slack ping when a Railway deploy fails | `/api/webhooks/railway` | Triggered by Railway, not by us |
| **L6: Credential drift watch** | Daily check that Composio/Slack/Notion tokens still work | Manual today, automate later | (gap — see roadmap) |

## How it actually works

### Synthetic supervisor (L3)

The `/api/cron/healthcheck` endpoint runs a real turn against the Managed Agent: it sends `"Reply with the single word PONG and nothing else."` and expects exactly that back. The full path is exercised:

- Anthropic API → Managed Agent → MCP (Composio Tool Router) is reachable
- Postgres write succeeds (`runs` row inserted)
- Slack auth still valid (alerts use the same token)

If the response isn't PONG, or the call errors, the row gets `status=error`. The endpoint then queries:

- Last 2 synthetic results — if both failed → alert
- Last 10 min of user runs — if 3+ failed → alert

Alerts post to `ALERTS_SLACK_CHANNEL` and DM `JUSTIN_SLACK_USER_ID`. Two strikes prevents flapping; three user fails catches degradation that synthetic might miss.

### Two cron sources

The synthetic check needs *something* to fire every 5 min. We support two sources, listed by reliability:

**Option A (best): Railway cron service.** A separate Railway service in the same project, sharing the codebase, runs `bash cron/healthcheck.sh` on a `*/5 * * * *` schedule. See [PHASE_2_WALKTHROUGH.md](PHASE_2_WALKTHROUGH.md) for setup. Independent of your laptop, runs 24/7.

**Option B (good enough): cron-job.org.** Free, web-hosted. Add a job hitting `https://your-app.up.railway.app/api/cron/healthcheck` with header `x-cron-secret: <CRON_SECRET>` every 5 min. Slightly less private (third party holds the secret).

**Option C (laptop only — fragile): Anthropic `mcp__scheduled-tasks__create_scheduled_task`** running locally. Fine for prototyping but stops firing whenever your laptop sleeps. Not recommended for production.

### External uptime monitor (L4)

Set up [UptimeRobot](https://uptimerobot.com) (free tier, 50 monitors, 5-min interval):

1. Create monitor: HTTP(s)
2. URL: `https://your-app.up.railway.app/api/health`
3. Interval: 5 minutes
4. Alert contacts: your email + SMS

Why this matters: if the *entire* Railway region is down, our internal supervisor can't fire (it lives there too). UptimeRobot lives elsewhere, sees the outage, pages you. It also catches the "everything is up but the app returns 200 with garbage" case if you point it at `/api/cron/healthcheck` instead — but that costs you a real agent turn every 5 min, which is overkill.

### Build-failure alerts (L5)

When Railway deploys fail (typo, missing env var, build script error), they fail silently — the previous deploy keeps serving traffic. We learned this the hard way during Wave 2 setup: a failed build looked like a successful one until we noticed the new routes weren't there.

`/api/webhooks/railway` receives Railway's webhook events and posts to Slack on `FAILED`/`CRASHED`/`REMOVED` deploys. Setup:

1. Railway dashboard → Project → Settings → Webhooks → Add Webhook
2. URL: `https://your-app.up.railway.app/api/webhooks/railway?secret=$RAILWAY_WEBHOOK_SECRET`
3. Events: select **Deploy** events
4. Save → Test → confirm Slack post appears in `#daily-dashboard`

## Status dashboard

`/admin/status` (auth-gated by `APP_PASSWORD`) shows:

- Success rate last 1h / 24h
- p50 / p95 turn duration
- Last 50 runs with thread, status, duration, tool count, error
- Last healthcheck timestamp + status

Use this when something feels off — usually you can tell at a glance whether the issue is intermittent (high p95, low fail rate) or systemic (success rate cratered).

## Tuning knobs

In `lib/agentRun.ts`:

- `MAX_WAIT_MS` — how long a turn can run before timing out. Default 480s (8 min). Bump for queries that legitimately take longer; lower if you'd rather fail fast.
- `RETRY_DELAY_MS` — backoff before the one auto-retry on Anthropic 5xx. Default 3s.

In `app/api/slack/events/route.ts`:

- `UPDATE_INTERVAL_MS` — minimum gap between `chat.update` calls. Default 2s. Lower = chattier UX but risks Slack rate limits.

In `railway.json`:

- `restartPolicyMaxRetries` — how many crashes Railway will tolerate before giving up. Default 10. Don't set 0 unless you're testing.

## Failure modes & what happens

| Failure | What you'll see | What recovers automatically |
|---|---|---|
| Web container crashes | Slack bot stops replying | Railway restart (L1) within ~30s |
| Postgres unavailable | Sessions reset on next restart, no telemetry | App degrades to in-memory; reads/writes resume when DB is back |
| Anthropic 5xx | Run fails with `stream 5xx` | Auto-retry once after 3s; if still failing, alert fires after 3 fails in 10 min |
| Composio MCP rejected | Run completes but the agent says "I tried but…" | Manual: re-auth at https://app.composio.dev. Symptom: high tool count + apologetic replies |
| Slack token expired | Replies don't post; placeholder stays as `🧠 Thinking…` | Manual: rotate `SLACK_BOT_TOKEN` |
| All Railway down | UptimeRobot pages you | Manual: redeploy when region recovers |
| Bad deploy | Old version keeps serving | `/api/webhooks/railway` posts FAIL alert; rollback via `railway rollback` |
| Synthetic cron stops firing | No new healthcheck rows; UptimeRobot still confirms uptime | Run a manual curl; investigate the cron source |

## Roadmap

**Active:**
- ✅ Persistent session map (Postgres)
- ✅ Synthetic supervisor (5-min PONG)
- ✅ Run telemetry + status page
- ✅ Streaming Slack updates
- ✅ Railway build-failure webhook

**Next:**
- ⏳ Auto-remediator: 5 consecutive synth fails → call Railway API to redeploy
- ⏳ Credential drift watch: daily test of each MCP toolkit
- ⏳ Subagent visibility: parse SSE for sub-session events, show in `/admin/status`
- ⏳ Cost monitor: weekly Anthropic spend posted to `#daily-dashboard`
