# Notion Project Manager — Managed Agent Fleet

Phase 2 of the AI Integraterz Ops System. Conversational Operations Orchestrator on top of [Claude Managed Agents](https://platform.claude.com/docs/en/managed-agents/quickstart), deployed on Railway.

Two-pane dashboard: chat (left) + live agent activity (right) showing every tool call and subagent spawn as it happens.

## Inputs supported

- Text
- Voice notes (browser MediaRecorder → OpenAI Whisper → text into prompt)
- File uploads (text files inlined; binaries base64-passed to the agent)

## Stack

- Next.js 15 (App Router) + React 19
- Anthropic SDK with `managed-agents-2026-04-01` beta header
- OpenAI SDK for Whisper transcription
- Tailwind v4 (PostCSS plugin)
- Cookie-based shared-password auth (Justin + Xander only)

## Local dev

```bash
cp .env.example .env.local
# fill in:
#   ANTHROPIC_API_KEY
#   ANTHROPIC_AGENT_ID, ANTHROPIC_ENVIRONMENT_ID  (after creating via `ant` CLI)
#   OPENAI_API_KEY
#   APP_PASSWORD, APP_SESSION_SECRET (openssl rand -hex 32)
npm install
npm run dev
```

## Provisioning the Managed Agent

```bash
brew install anthropics/tap/ant
export ANTHROPIC_API_KEY=...

# 1. Create the agent (paste Operations Orchestrator system prompt + DB IDs)
ant beta:agents create \
  --name "AI Integraterz Operations Orchestrator" \
  --model '{id: claude-opus-4-7}' \
  --system "$(cat ../AI\ Inetgraterz\ Ops\ Home/agents/agent_configs.md | sed -n '795,831p')" \
  --tool '{type: agent_toolset_20260401}'

# 2. Create the environment
ant beta:environments create \
  --name "ops-orchestrator-env" \
  --config '{type: cloud, networking: {type: unrestricted}}'

# 3. Plug the returned IDs into .env.local as ANTHROPIC_AGENT_ID and ANTHROPIC_ENVIRONMENT_ID
```

Attach Notion / Gmail / Calendar MCP connectors to the agent per the [tools docs](https://platform.claude.com/docs/en/managed-agents/tools).

## Deploy to Railway

```bash
railway login
railway init      # create new project: "Notion PM — Managed Agent Fleet"
railway link
railway variables set \
  ANTHROPIC_API_KEY=... \
  ANTHROPIC_AGENT_ID=... \
  ANTHROPIC_ENVIRONMENT_ID=... \
  OPENAI_API_KEY=... \
  APP_PASSWORD=... \
  APP_SESSION_SECRET=$(openssl rand -hex 32)
railway up
```

## Architecture

```
Browser
  │
  ├─ POST /api/agent/session       → creates a session
  ├─ POST /api/agent/send          → forwards user.message to Anthropic
  ├─ GET  /api/agent/stream/[sid]  → SSE proxy from Anthropic → EventSource
  ├─ POST /api/agent/upload        → file → text/base64
  └─ POST /api/agent/transcribe    → audio → Whisper text

Anthropic Managed Agent (claude-opus-4-7 + agent_toolset_20260401)
  ├─ Notion MCP
  ├─ Gmail MCP
  ├─ Calendar MCP
  └─ (optional) Unipile, Stripe, etc.
```
