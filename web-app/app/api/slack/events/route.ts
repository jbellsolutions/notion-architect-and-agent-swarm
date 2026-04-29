import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature, postMessage, updateMessage, addReaction, removeReaction } from "@/lib/slack";
import { runTurn } from "@/lib/agentRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPDATE_INTERVAL_MS = 2_000; // throttle chat.update calls
const SLACK_TEXT_MAX = 38_000; // chat.update body cap

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-slack-signature");
  const ts = req.headers.get("x-slack-request-timestamp");

  if (!verifySlackSignature(raw, sig, ts)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  if (body.type === "url_verification") {
    return new Response(body.challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }

  if (body.type === "event_callback") {
    const event = body.event ?? {};
    const isMention = event.type === "app_mention";
    const isDm = event.type === "message" && event.channel_type === "im";
    const isBot = event.bot_id || event.subtype === "bot_message" || event.subtype === "message_changed" || event.subtype === "message_deleted";

    if ((isMention || isDm) && !isBot && event.user && event.text) {
      const text = String(event.text).replace(/<@[A-Z0-9]+>/g, "").trim();
      const channel = event.channel as string;
      const threadTs = (event.thread_ts as string | undefined) ?? (event.ts as string | undefined);

      handleAsync({ channel, threadTs, user: event.user, text, slackTs: event.ts }).catch((err) => {
        console.error("slack handle error:", err);
      });
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: true });
}

async function handleAsync(opts: { channel: string; threadTs?: string; user: string; text: string; slackTs: string }) {
  await addReaction({ channel: opts.channel, timestamp: opts.slackTs, name: "hourglass_flowing_sand" });

  // Post placeholder immediately so the user sees activity within ~1s.
  let placeholderTs: string | undefined;
  try {
    const posted = await postMessage({
      channel: opts.channel,
      thread_ts: opts.threadTs,
      text: "🧠 Thinking…",
    });
    placeholderTs = posted.ts;
  } catch (e) {
    console.error("placeholder post failed:", e);
  }

  // Throttled updater — coalesces high-frequency text deltas into ≤1 update / UPDATE_INTERVAL_MS.
  let lastUpdateAt = 0;
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;
  let lastRendered = "";
  let toolCount = 0;
  let lastTool = "";

  const render = (running: string): string => {
    const header = toolCount > 0 ? `🔧 ${toolCount} tool call${toolCount === 1 ? "" : "s"}${lastTool ? ` — last: \`${lastTool}\`` : ""}\n\n` : "";
    const bodyText = running || "_(thinking…)_";
    let out = header + bodyText;
    if (out.length > SLACK_TEXT_MAX) out = out.slice(0, SLACK_TEXT_MAX) + "\n\n_…(truncated for Slack)_";
    return out;
  };

  const flush = async (running: string) => {
    if (!placeholderTs) return;
    const next = render(running);
    if (next === lastRendered) return;
    lastRendered = next;
    try {
      await updateMessage({ channel: opts.channel, ts: placeholderTs, text: next });
    } catch (e) {
      console.error("slack update failed:", e);
    }
  };

  const schedule = (running: string) => {
    const now = Date.now();
    const elapsed = now - lastUpdateAt;
    if (elapsed >= UPDATE_INTERVAL_MS) {
      lastUpdateAt = now;
      flush(running);
    } else if (!pendingTimer) {
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        lastUpdateAt = Date.now();
        flush(running);
      }, UPDATE_INTERVAL_MS - elapsed);
    }
  };

  let runningText = "";

  try {
    const result = await runTurn({
      channel: opts.channel,
      threadTs: opts.threadTs,
      user: opts.user,
      text: opts.text,
      title: `Slack ${opts.channel}/${opts.threadTs ?? opts.slackTs}`,
      onProgress: (evt) => {
        if (evt.type === "text") {
          runningText = evt.total;
          schedule(runningText);
        } else if (evt.type === "tool_use") {
          toolCount = evt.toolCount;
          lastTool = evt.toolName;
          schedule(runningText);
        }
      },
    });

    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }

    let body = result.text || runningText;
    if (!body) {
      // No text yet — write a specific failure cause so the user knows what went wrong.
      if (result.error) body = `⚠️ ${result.error} (session \`${result.sessionId}\`)`;
      else if (result.truncated) body = `⚠️ Agent ran ${Math.round(480)}s without idle — session \`${result.sessionId}\``;
      else body = "⚠️ Agent returned no text and no error (session \`" + result.sessionId + "\`)";
    } else {
      const meta: string[] = [];
      if (result.toolCalls > 0) meta.push(`${result.toolCalls} tool call${result.toolCalls === 1 ? "" : "s"}`);
      if (result.retried) meta.push(`retried once`);
      if (result.truncated) meta.push(`truncated`);
      if (result.error) meta.push(`⚠️ ${result.error}`);
      if (meta.length) body += `\n\n_${meta.join(" · ")}_`;
    }

    if (body.length > SLACK_TEXT_MAX) body = body.slice(0, SLACK_TEXT_MAX) + "\n\n_…(truncated for Slack)_";

    if (placeholderTs) {
      await updateMessage({ channel: opts.channel, ts: placeholderTs, text: body }).catch(async (e) => {
        console.error("final update failed, falling back to postMessage:", e);
        await postMessage({ channel: opts.channel, thread_ts: opts.threadTs, text: body });
      });
    } else {
      await postMessage({ channel: opts.channel, thread_ts: opts.threadTs, text: body });
    }
  } catch (e: any) {
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    const msg = `:x: orchestrator error: \`${String(e?.message ?? e).slice(0, 500)}\``;
    if (placeholderTs) {
      await updateMessage({ channel: opts.channel, ts: placeholderTs, text: msg }).catch(() => {
        return postMessage({ channel: opts.channel, thread_ts: opts.threadTs, text: msg });
      });
    } else {
      await postMessage({ channel: opts.channel, thread_ts: opts.threadTs, text: msg });
    }
  } finally {
    await removeReaction({ channel: opts.channel, timestamp: opts.slackTs, name: "hourglass_flowing_sand" });
    await addReaction({ channel: opts.channel, timestamp: opts.slackTs, name: "white_check_mark" });
  }
}
