# SETUP.md — natural-language setup guide

> **Hey Claude, you're reading this because the user asked you to set up the Notion Architect and Agent Swarm for them. Follow this document end-to-end. Use TodoWrite to track progress. Pause and ask the user only when an action requires their browser, their account, or a credential you can't generate.**

This guide stands up the entire system from a fresh clone. ~60 minutes if you (Claude) drive most of it; ~90 minutes manual.

---

## Phase 0 — Local prerequisites (Claude: check these silently, install what's missing)

| Tool | Why | Install if missing |
|---|---|---|
| Node 22+ | web app | `brew install node` (macOS) or fnm |
| `npm` | web app | (comes with node) |
| `gh` (GitHub CLI) | publishing + repo ops | `brew install gh` |
| `railway` CLI | deploy web app | `brew install railwayapp/railway/railway` |
| `python3` | Notion DB provisioning | usually preinstalled on macOS |
| `pip` | Notion API client | `python3 -m ensurepip` |
| `jq` | JSON juggling in scripts | `brew install jq` |
| `curl` | API calls | preinstalled |

Claude: run `which node npm gh railway python3 jq curl` and report any missing. Install the missing ones with brew.

---

## Phase 1 — Accounts the user needs (ask user to confirm each)

Required:
- [ ] **Notion** workspace on **Business** plan or higher (Custom Agents need Business+)
- [ ] **Anthropic Console** account with API key — https://console.anthropic.com
- [ ] **Composio** account — https://app.composio.dev — free tier is fine
- [ ] **Slack** workspace with admin rights to install apps
- [ ] **Google Workspace** account for Gmail + Calendar OAuth (use the email you want the agent to send mail "from")
- [ ] **OpenAI** API key (for Whisper voice transcription) — https://platform.openai.com
- [ ] **Railway** account — https://railway.app — Hobby plan ($5/mo) is plenty
- [ ] **GitHub** account (you already have one if you cloned this repo)

Optional (only if you want the n8n workflows):
- [ ] **n8n Cloud** account or self-hosted n8n instance
- [ ] **Read.ai** account (meeting transcript ingestion)
- [ ] **Stripe** account (invoice ingestion)

Claude: ask the user to confirm each one with a single yes/no, then collect the API keys. Tell them you will store keys only in `web-app/.env.local` and Railway's environment — never commit them.

---

## Phase 2 — Notion database setup (the data layer)

The 12 databases in `notion-databases/setup/create_missing_dbs.py` are the schema your agents read from and write to.

### Step 2a — Create a Notion integration

1. Go to https://notion.so/profile/integrations → **+ New integration**
2. Name: `Operations Hub Integration`
3. Workspace: pick yours
4. Type: **Internal**
5. Copy the **Internal Integration Token** (starts with `ntn_`)

Save the token to `~/.env.notion` (Claude: write it for the user; do not echo it back to chat).

### Step 2b — Create the Operations Hub teamspace + share with integration

1. In Notion, create a new teamspace called **Operations Hub** (or use an existing one)
2. Inside it, create a top-level page called **Operations Databases**
3. Click the `…` on that page → **Connections** → add `Operations Hub Integration`
4. This permission cascades to every child page — every database the script creates will be readable/writable by the integration

Capture the page ID of `Operations Databases` (the 32-char hex in its URL after the workspace name).

### Step 2c — Run the provisioning script

```bash
cd notion-databases/setup
cp .env.example .env
# Edit .env: NOTION_TOKEN=ntn_..., PARENT_PAGE_ID=<page id from 2b>
pip install -r requirements.txt   # or: pip install requests python-dotenv
python create_missing_dbs.py
```

The script creates 12 databases under the parent page and prints their IDs. Save the printout — you'll paste these IDs into the Managed Agent's system prompt later.

### Step 2d — (Optional) Import seed data

If your team already has Clients, Projects, etc. in another tool, import via Notion's **Import** feature (Settings → Workspace → Import) or use the script template at `notion-databases/setup/seed_examples/`.

---

## Phase 3 — Anthropic Managed Agent (the brain)

### Step 3a — Get the API key + install the CLI

1. https://console.anthropic.com/settings/keys → create a key with full permissions
2. Save to env: `export ANTHROPIC_API_KEY=sk-ant-...`
3. Install the `ant` CLI: `brew install anthropics/tap/ant`
4. Verify: `ant --version`

### Step 3b — Provision the agent + environment via API

Claude: run these two curls (substitute the actual DB IDs from step 2c into the system prompt):

```bash
# Build the system prompt
cat > /tmp/orchestrator_system.txt << 'EOF'
You are the Operations Orchestrator for {{COMPANY_NAME}}. The team talks to you via Slack and a web app. You are the single point of contact for everything operational.

You have access to every database in the Notion workspace via the Composio MCP server (which routes to Notion, Slack, Gmail, Calendar). When asked something, figure out which database to query and answer directly.

CAPABILITIES:
- Answer questions across all DBs
- Create/update tasks, projects, clients, content
- Generate reports
- Post to Slack channels
- Draft Gmail
- Manage Calendar events

DATABASE IDs (always reference by ID, never by title alone):
- Clients:           {{CLIENTS_DB_ID}}
- Projects:          {{PROJECTS_DB_ID}}
- Tasks:             {{TASKS_DB_ID}}
- Time Entries:      {{TIME_ENTRIES_DB_ID}}
- Invoices:          {{INVOICES_DB_ID}}
- Meetings:          {{MEETINGS_DB_ID}}
- Content Calendar:  {{CONTENT_DB_ID}}
- Community Members: {{COMMUNITY_DB_ID}}
- Team Members:      {{TEAM_DB_ID}}
- Competitors:       {{COMPETITORS_DB_ID}}
- Agent Logs:        {{AGENT_LOGS_DB_ID}}
- Intel Briefings:   {{INTEL_DB_ID}}

TONE: Professional but efficient. Give direct answers. Link to Notion pages when referencing specific records.
EOF

# Create the agent
AGENT=$(curl -sS https://api.anthropic.com/v1/agents \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg sys "$(cat /tmp/orchestrator_system.txt)" '{
    name: "Operations Orchestrator",
    model: "claude-opus-4-7",
    system: $sys,
    tools: [{type: "agent_toolset_20260401"}]
  }')")
echo "AGENT_ID=$(echo "$AGENT" | jq -r '.id')"

# Create the environment
ENV=$(curl -sS https://api.anthropic.com/v1/environments \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{"name":"ops-env","config":{"type":"cloud","networking":{"type":"unrestricted"}}}')
echo "ENV_ID=$(echo "$ENV" | jq -r '.id')"
```

Save both IDs.

---

## Phase 4 — Composio Tool Router (the MCP server)

### Step 4a — Create a Tool Router

1. https://app.composio.dev → **Tool Router** (or "Composio for You")
2. **+ Create Tool Router** → enable: **Notion, Slack, Gmail, Google Calendar**
3. Copy:
   - **MCP URL** (looks like `https://backend.composio.dev/tool_router/trs_XXXX/mcp`)
   - **Bearer token** (looks like `sphxXXXXXXXX`)

### Step 4b — Attach Composio MCP to the agent

```bash
# Update agent (use AGENT_ID from step 3b)
curl -sS -X POST "https://api.anthropic.com/v1/agents/$AGENT_ID" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg url "$COMPOSIO_MCP_URL" '{
    version: 1,
    mcp_servers: [{type: "url", name: "composio", url: $url}],
    tools: [
      {type: "agent_toolset_20260401"},
      {type: "mcp_toolset", mcp_server_name: "composio", default_config: {permission_policy: {type: "always_allow"}}}
    ]
  }')"
```

### Step 4c — Create vault + credential

```bash
# Create vault
VAULT=$(curl -sS https://api.anthropic.com/v1/vaults \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d '{"display_name":"ops"}')
VAULT_ID=$(echo "$VAULT" | jq -r '.id')

# Add static_bearer credential for the Composio MCP URL
curl -sS "https://api.anthropic.com/v1/vaults/$VAULT_ID/credentials" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: managed-agents-2026-04-01" \
  -H "content-type: application/json" \
  -d "$(jq -n --arg url "$COMPOSIO_MCP_URL" --arg tok "$COMPOSIO_TOKEN" '{
    display_name: "Composio Tool Router",
    auth: {type: "static_bearer", mcp_server_url: $url, token: $tok}
  }')"
echo "VAULT_ID=$VAULT_ID"
```

Save `VAULT_ID`.

### Step 4d — Authorize each app to the Tool Router

This is the only multi-click step in Phase 4 — and it's a one-time per app. From the web app or via API, ask the agent to initiate connections:

> Use COMPOSIO_MANAGE_CONNECTIONS to initiate connections for these toolkits in the Tool Router: notion, slack, gmail, googlecalendar. Set reinitiate_all=true. Output the 4 redirect URLs.

The agent will reply with 4 OAuth URLs. Click each (links expire in 10 min):
- Notion: share your Operations Hub teamspace with the integration
- Slack: pick your workspace
- Gmail: sign in as the account you want the agent to send from
- Calendar: same Google account

---

## Phase 5 — Web app on Railway

### Step 5a — Create the Railway project

```bash
cd web-app
railway login
railway init --name "notion-architect-and-agent-swarm"
railway add --service web    # accept the prompt to create empty service
railway service web          # link this directory to that service
```

### Step 5b — Set env vars (combines all credentials from earlier phases)

```bash
SECRET=$(openssl rand -hex 32)
railway variables \
  --set "ANTHROPIC_API_KEY=sk-ant-..." \
  --set "ANTHROPIC_AGENT_ID=agent_..." \
  --set "ANTHROPIC_ENVIRONMENT_ID=env_..." \
  --set "ANTHROPIC_VAULT_IDS=vlt_..." \
  --set "OPENAI_API_KEY=sk-proj-..." \
  --set "APP_PASSWORD=$(openssl rand -base64 12)" \
  --set "APP_SESSION_SECRET=$SECRET" \
  --set "NODE_ENV=production"
# (SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET come in Phase 6)
```

### Step 5c — Deploy

```bash
railway up --detach
railway domain    # generates a public URL
```

Wait ~2 min, then `curl https://<your-app>.up.railway.app/api/health` should return `{"ok":true,...}`.

### Step 5d — Smoke test the chat

Open the Railway URL → log in with the password from above → ask:

```
List 5 MCP tools you have access to via Composio.
```

If you see actual Composio tool names (`COMPOSIO_SEARCH_TOOLS`, `COMPOSIO_MULTI_EXECUTE_TOOL`, etc.) → wired correctly.

If you see "no MCP tools available" → vault wiring issue. Check `/api/debug` to confirm `vaultIds` is non-empty in the running container.

If you see "MCP server 'composio' initialize failed: no credential" → URL mismatch between agent's `mcp_servers[0].url` and vault credential's `mcp_server_url`. They must be byte-identical.

---

## Phase 6 — Slack bridge

Follow [docs/SLACK_BRIDGE_SETUP.md](docs/SLACK_BRIDGE_SETUP.md) — 5 minutes, ends with you DM-ing the bot in Slack.

---

## Phase 7 — 11 Notion Custom Agents (background automations)

Follow [docs/PHASE_1_WALKTHROUGH.md](docs/PHASE_1_WALKTHROUGH.md). This is the only fully manual phase — Notion's Custom Agent UI doesn't have an API. Per agent: ~5 min of clicks; 11 agents × 5 min = ~55 min total. Or skip it for now and just use the orchestrator + web/Slack — the background agents are nice-to-have, not required.

---

## Phase 8 — Final smoke tests

Claude: run these in order. All should pass.

| Test | Through | Expected |
|---|---|---|
| Web login | browser | Login form → dashboard with empty activity feed |
| Web chat — count clients | web | "Count: N" with N matching your Notion |
| Web chat — list in-progress tasks | web | Bullet list or "No tasks in progress" |
| Web chat — create + delete test task | web | "Created page X, then archived. Verified gone." |
| Web chat — Slack post | web | `:white_check_mark: PING from Operations Orchestrator` posted to #general; `ts:` returned |
| Slack DM | Slack mobile | DM `@Ops Orchestrator` with "count clients" → ⏳ → reply → ✅ |
| Slack mention | Slack | `@Ops Orchestrator how's revenue this month?` in any channel where it's invited |
| Voice note | web mobile | Hold mic → speak → Whisper transcribes → orchestrator responds |
| File upload | web | Drop a PDF → orchestrator extracts and acts |

---

## Common failure modes + fixes

| Symptom | Fix |
|---|---|
| Railway build fails with TypeScript error | Run `npx next build` locally first to catch type errors before deploy |
| Railway build fails with Node version error | `nixpacks.toml` pins Node 22; if it changed, edit `package.json` `engines.node` |
| Sessions have empty `vault_ids` in API response | `lib/anthropic.ts` reads env at module load — make sure it reads at request time (function call) |
| "no credential is stored for this server URL" | Agent's MCP URL ≠ vault credential's `mcp_server_url`. Check byte-by-byte |
| "server rejected the static bearer token" | Composio token wrong or not associated with that Tool Router |
| Slack URL verification fails | Likely missing SLACK_SIGNING_SECRET in Railway when Slack first hits the URL. Set both Slack vars, redeploy, then go back to Slack app and re-trigger verification |
| Slack DM gets no reply | Bot not invited to the channel (for mentions); check Railway logs for the actual error |

---

## Cleanup / teardown

To remove your deployment:
1. `railway down` then delete the project from Railway dashboard
2. Archive the Anthropic Managed Agent: `curl -X POST .../v1/agents/$AGENT_ID/archive`
3. Archive the vault: `curl -X POST .../v1/vaults/$VAULT_ID/archive`
4. Delete the Slack app at https://api.slack.com/apps
5. Revoke the Composio Tool Router from the Composio dashboard
6. (Optional) Delete the Notion integration at https://notion.so/profile/integrations
7. Notion databases stay where they are — delete manually if you want them gone

---

That's it. The system is yours.
