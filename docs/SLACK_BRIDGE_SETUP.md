# Slack Bridge Setup — 5 minutes

This wires Slack DMs and `@Ops Orchestrator` mentions into the Managed Agent on Railway. Same brain as the web app, just a different front door.

## 1. Create the Slack app from manifest

1. Go to https://api.slack.com/apps?new_app=1
2. Click **From a manifest** → pick your **AI Integraterz** workspace → **Next**
3. Choose **JSON** and paste this:

```json
{
  "display_information": {
    "name": "Ops Orchestrator",
    "description": "AI Integraterz Operations Orchestrator — talk to Notion, Slack, Gmail, Calendar from any channel.",
    "background_color": "#0a0a0b"
  },
  "features": {
    "bot_user": {
      "display_name": "Ops Orchestrator",
      "always_online": true
    },
    "app_home": {
      "messages_tab_enabled": true,
      "messages_tab_read_only_enabled": false
    }
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "app_mentions:read",
        "chat:write",
        "chat:write.public",
        "im:history",
        "im:read",
        "im:write",
        "channels:history",
        "groups:history",
        "reactions:read",
        "reactions:write",
        "users:read"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "request_url": "https://YOUR-APP.up.railway.app/api/slack/events",
      "bot_events": [
        "app_mention",
        "message.im"
      ]
    },
    "interactivity": { "is_enabled": false },
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  }
}
```

4. Click **Next** → **Create**

> Slack will hit `/api/slack/events` for URL verification immediately. The route handles the `url_verification` challenge — should turn green.

## 2. Install to your workspace

1. In the new app's left sidebar → **Install App** → **Install to AI Integraterz**
2. Click **Allow**
3. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

## 3. Get the signing secret

1. Left sidebar → **Basic Information** → scroll to **App Credentials**
2. Copy the **Signing Secret** (32-char hex)

## 4. Set both in Railway

```bash
railway variables \
  --set "SLACK_BOT_TOKEN=xoxb-..." \
  --set "SLACK_SIGNING_SECRET=..." 
```

Or paste them via the Railway dashboard → notion-pm-managed-agent-fleet → web → Variables.

The redeploy that follows will pick them up automatically.

## 5. Invite the bot into channels you want it to read

In any channel:

```
/invite @Ops Orchestrator
```

Or open the channel → Settings → Integrations → Add an app.

For DMs, no invite needed — just open a DM with `@Ops Orchestrator` from your sidebar.

## 6. Test

- **DM test**: open a DM with `@Ops Orchestrator` → type `count clients`. You should see an ⏳ reaction within 1s, then a reply within ~30s, then ✅ reaction when done.
- **Mention test**: in `#general`: `@Ops Orchestrator how many tasks are in progress?`

Threads share session context — replies in the same thread continue the same Anthropic session for ~6 hours.

## How it works under the hood

```
Slack event (mention or DM)
    ↓
POST /api/slack/events  (verifies HMAC signature, acks <3s)
    ↓ (background)
Lookup or create Anthropic session for this thread/user
    ↓
Send user.message to session
    ↓
Stream events until status_idle
    ↓
chat.postMessage to Slack thread with the agent's reply
```

Errors surface as `:warning:` or `:x:` messages in-thread. Tool call counts and truncation warnings are appended.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Slack says "Your URL didn't respond" during install | Check Railway logs for `/api/slack/events` — likely the SLACK_SIGNING_SECRET wasn't set yet, or middleware blocked it. Both are handled in this build. |
| DM gets no reply | (a) Bot wasn't invited to a channel where you're @-mentioning, or (b) `xoxb-` token wrong scope, or (c) Anthropic stream timing out. Check Railway logs. |
| Reply is `:warning: stream 401` | Anthropic API key invalid — check `ANTHROPIC_API_KEY` in Railway. |
| Reply is "MCP server 'composio' initialize failed: no credential" | Re-auth the Composio Tool Router for the relevant toolkit. |
