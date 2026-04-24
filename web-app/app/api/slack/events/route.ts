import { NextRequest, NextResponse } from "next/server";
import { verifySlackSignature, postMessage, addReaction, removeReaction } from "@/lib/slack";
import { runTurn } from "@/lib/agentRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const sig = req.headers.get("x-slack-signature");
  const ts = req.headers.get("x-slack-request-timestamp");

  if (!verifySlackSignature(raw, sig, ts)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let body: any;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }

  // URL verification handshake (one-time setup)
  if (body.type === "url_verification") {
    return new Response(body.challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }

  // Event callback
  if (body.type === "event_callback") {
    const event = body.event ?? {};
    const isMention = event.type === "app_mention";
    const isDm = event.type === "message" && event.channel_type === "im";
    const isBot = event.bot_id || event.subtype === "bot_message" || event.subtype === "message_changed" || event.subtype === "message_deleted";

    if ((isMention || isDm) && !isBot && event.user && event.text) {
      // Strip the bot's own mention from the text
      const text = String(event.text).replace(/<@[A-Z0-9]+>/g, "").trim();
      const channel = event.channel as string;
      const threadTs = (event.thread_ts as string | undefined) ?? (event.ts as string | undefined);

      // Acknowledge fast (Slack requires <3s ack); kick off work in the background.
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
  try {
    const result = await runTurn({
      channel: opts.channel,
      threadTs: opts.threadTs,
      user: opts.user,
      text: opts.text,
      title: `Slack ${opts.channel}/${opts.threadTs ?? opts.slackTs}`,
    });

    let body = result.text || "_(no reply)_";
    if (result.error) body = `:warning: ${result.error}\n\n${body}`;
    if (result.toolCalls > 0) body += `\n\n_${result.toolCalls} tool call${result.toolCalls === 1 ? "" : "s"}_`;
    if (result.truncated) body += `\n\n_(response truncated — agent still running)_`;

    await postMessage({ channel: opts.channel, thread_ts: opts.threadTs, text: body });
  } catch (e: any) {
    await postMessage({
      channel: opts.channel,
      thread_ts: opts.threadTs,
      text: `:x: orchestrator error: \`${String(e?.message ?? e).slice(0, 500)}\``,
    });
  } finally {
    await removeReaction({ channel: opts.channel, timestamp: opts.slackTs, name: "hourglass_flowing_sand" });
    await addReaction({ channel: opts.channel, timestamp: opts.slackTs, name: "white_check_mark" });
  }
}
