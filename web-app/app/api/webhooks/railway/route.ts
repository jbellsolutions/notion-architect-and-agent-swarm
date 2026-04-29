// Railway webhook receiver. Posts to Slack on FAILED / CRASHED deploys.
//
// Auth: the URL itself is unguessable (UUID path), and we additionally check
// `?secret=<RAILWAY_WEBHOOK_SECRET>`. Set this on Railway as a query param when
// configuring the webhook (Project Settings → Webhooks → Add Webhook).
//
// Railway's payload shape: { type, project, environment, service, deployment, ... }
// We care about `type === "DEPLOY"` with `deployment.status` in {FAILED, CRASHED, REMOVED}.

import { NextRequest, NextResponse } from "next/server";
import { postMessage } from "@/lib/slack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BAD_STATUSES = new Set(["FAILED", "CRASHED", "REMOVED"]);

export async function POST(req: NextRequest) {
  const expected = process.env.RAILWAY_WEBHOOK_SECRET;
  const got = req.nextUrl.searchParams.get("secret");
  if (!expected || !got || got !== expected) {
    return NextResponse.json({ error: "unauth" }, { status: 401 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  const type = body?.type ?? body?.event?.type;
  const status = body?.deployment?.status ?? body?.status;
  const serviceName = body?.service?.name ?? body?.serviceName ?? "unknown";
  const envName = body?.environment?.name ?? "production";
  const deployId = body?.deployment?.id ?? body?.deploymentId ?? "—";
  const projectName = body?.project?.name ?? "";
  const meta = body?.deployment?.meta ?? {};
  const commitMsg = meta?.commitMessage ?? meta?.commit_message ?? "";

  if (type !== "DEPLOY" || !status) {
    return NextResponse.json({ ok: true, ignored: true, type, status });
  }

  if (!BAD_STATUSES.has(String(status).toUpperCase())) {
    return NextResponse.json({ ok: true, healthy: true, status });
  }

  const channel = process.env.ALERTS_SLACK_CHANNEL;
  if (channel) {
    const msg = [
      `🚨 *Railway deploy ${status}* — \`${projectName}/${serviceName}\` (${envName})`,
      `Deploy: \`${deployId}\``,
      commitMsg ? `> ${String(commitMsg).slice(0, 200)}` : "",
      `Logs: https://railway.com/project/_/service/_?id=${deployId}`,
    ].filter(Boolean).join("\n");
    await postMessage({ channel, text: msg }).catch((e) => console.error("alert failed:", e));
  }

  return NextResponse.json({ ok: true, alerted: Boolean(channel) });
}

export async function GET() {
  // simple health probe for Railway webhook test button
  return NextResponse.json({ ok: true, hint: "POST with ?secret=… to receive Railway events" });
}
