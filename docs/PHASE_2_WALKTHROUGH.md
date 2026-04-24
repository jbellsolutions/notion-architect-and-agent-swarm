# Phase 2 walkthrough — Web app + Slack bridge + Managed Agent

This is the actual click-by-click for everything in [SETUP.md](../SETUP.md) phases 3-6. Use SETUP.md if you want Claude to drive; use this if you're driving manually.

## Time required

| Step | Time |
|---|---|
| Anthropic Managed Agent (Phase 3) | 5 min |
| Composio Tool Router (Phase 4) | 10 min (4 OAuth clicks) |
| Web app on Railway (Phase 5) | 10 min |
| Slack bridge (Phase 6) | 5 min (Slack app create + tokens) |
| **Total** | **~30 min** |

## Phase 3: Provision the Managed Agent

### 3.1 Anthropic API key

1. https://console.anthropic.com/settings/keys
2. **Create Key** → name it `notion-architect-and-agent-swarm` → copy the value (`sk-ant-api03-...`)
3. Save: `export ANTHROPIC_API_KEY=sk-ant-...`

### 3.2 Create the agent

The agent's system prompt should reference the 12 Notion DB IDs you got from Phase 2. Substitute them into the template at `notion-databases/agents/agent_configs.md` (see Agent #12 — Operations Orchestrator, lines 795-831).

```bash
curl -sS https://api.anthropic.com/v1/agents \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d @- << 'EOF'
{
  "name": "Operations Orchestrator",
  "model": "claude-opus-4-7",
  "system": "<paste from agent_configs.md lines 795-831, with your DB IDs substituted>",
  "tools": [{"type": "agent_toolset_20260401"}]
}
EOF
```

Save the `id` field as `ANTHROPIC_AGENT_ID`.

### 3.3 Create the environment

```bash
curl -sS https://api.anthropic.com/v1/environments \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{"name":"ops-env","config":{"type":"cloud","networking":{"type":"unrestricted"}}}'
```

Save the `id` as `ANTHROPIC_ENVIRONMENT_ID`.

## Phase 4: Composio Tool Router

### 4.1 Create the Tool Router

1. https://app.composio.dev → **Tool Router** (or "Composio for You")
2. **+ Create Tool Router**
3. Toolkits to enable: **Notion, Slack, Gmail, Google Calendar**
4. Save → copy:
   - **MCP URL** (e.g. `https://backend.composio.dev/tool_router/trs_XXXX/mcp`)
   - **Bearer token** (e.g. `sphxXXXXXXXX`)

### 4.2 Test the MCP responds

```bash
curl -sS -X POST "$COMPOSIO_MCP_URL" \
  -H "Authorization: Bearer $COMPOSIO_TOKEN" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"0.1"}}}'
```

Should return `serverInfo` with no error.

### 4.3 Attach the MCP to the agent

```bash
curl -sS -X POST "https://api.anthropic.com/v1/agents/$ANTHROPIC_AGENT_ID" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d "{\"version\":1,\"mcp_servers\":[{\"type\":\"url\",\"name\":\"composio\",\"url\":\"$COMPOSIO_MCP_URL\"}],\"tools\":[{\"type\":\"agent_toolset_20260401\"},{\"type\":\"mcp_toolset\",\"mcp_server_name\":\"composio\",\"default_config\":{\"permission_policy\":{\"type\":\"always_allow\"}}}]}"
```

Should return `version: 2` (or higher).

### 4.4 Vault + credential

```bash
# Create vault
VAULT=$(curl -sS https://api.anthropic.com/v1/vaults \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{"display_name":"ops"}')
VAULT_ID=$(echo "$VAULT" | jq -r '.id')

# Add credential
curl -sS "https://api.anthropic.com/v1/vaults/$VAULT_ID/credentials" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d "{\"display_name\":\"Composio Tool Router\",\"auth\":{\"type\":\"static_bearer\",\"mcp_server_url\":\"$COMPOSIO_MCP_URL\",\"token\":\"$COMPOSIO_TOKEN\"}}"

echo "ANTHROPIC_VAULT_IDS=$VAULT_ID"
```

Save `VAULT_ID`.

### 4.5 Authorize the 4 apps in the Tool Router

In the web app (after Phase 5 deploys), or via direct API:

> Use COMPOSIO_MANAGE_CONNECTIONS in a single call to initiate connections for these 4 toolkits in the Tool Router: notion, slack, gmail, googlecalendar. Set reinitiate_all=true. Output ONLY the 4 redirect URLs, one per line, formatted as markdown links.

The agent will reply with 4 links (each ~10 min TTL). Click each, authorize, close tab. After this, the Tool Router has persistent OAuth connections.

## Phase 5: Web app on Railway

### 5.1 Railway project

```bash
cd web-app
railway login
railway init --name "notion-architect-and-agent-swarm"
railway add --service web   # accept the prompt
railway service web
```

### 5.2 Env vars

```bash
SECRET=$(openssl rand -hex 32)
railway variables \
  --set "ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY" \
  --set "ANTHROPIC_AGENT_ID=$ANTHROPIC_AGENT_ID" \
  --set "ANTHROPIC_ENVIRONMENT_ID=$ANTHROPIC_ENVIRONMENT_ID" \
  --set "ANTHROPIC_VAULT_IDS=$VAULT_ID" \
  --set "OPENAI_API_KEY=sk-proj-..." \
  --set "APP_PASSWORD=$(openssl rand -base64 12)" \
  --set "APP_SESSION_SECRET=$SECRET" \
  --set "NODE_ENV=production"
```

### 5.3 Deploy + domain

```bash
railway up --detach
railway domain
```

Note the URL (e.g. `https://web-production-XXXX.up.railway.app`). Wait ~2 min for the build.

### 5.4 Smoke test

```bash
curl https://YOUR-APP.up.railway.app/api/health  # → {"ok":true,...}
```

Then open the URL in a browser, log in with the password from above, and chat:

```
List 5 Composio MCP tools you have access to.
```

If you get real tool names (`COMPOSIO_SEARCH_TOOLS`, etc.), MCP is wired. If not, see the troubleshooting in SETUP.md.

## Phase 6: Slack bridge

See [SLACK_BRIDGE_SETUP.md](SLACK_BRIDGE_SETUP.md). After it's done you can DM `@Ops Orchestrator` from anywhere and get the same Notion-aware orchestrator.

---

## Common pitfalls

1. **Agent's MCP URL ≠ vault credential's URL** — they must be byte-identical. Trailing slashes, query params, and path differences all break the lookup.
2. **Beta headers per endpoint differ** — `/v1/sessions` and `/v1/agents` use `managed-agents-2026-04-01`; `/v1/sessions/{id}/stream` uses `agent-api-2026-03-01`. Don't combine them in one header.
3. **Module-level `process.env` reads** — Next.js may evaluate them at build time if cached. Read env inside the request handler, not at module top.
4. **TypeScript build failures kill silent deploys on Railway** — always `npx next build` locally before `railway up`.
5. **Slack URL verification fails if signing secret isn't set** — set both Slack vars in Railway, redeploy, then re-verify in Slack app.
