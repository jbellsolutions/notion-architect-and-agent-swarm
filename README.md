# Notion Architect and Agent Swarm

A complete, two-layer operations system that turns Notion into a **conversational agent fleet** — one orchestrator brain you can talk to from a web app or from Slack, plus 11 background agents inside Notion that handle automated workflows (client onboarding, finance, content, community growth, reporting, etc.).

> **🚀 New to this repo? Open it in Claude Code (or paste this URL into Claude.ai with the GitHub connector) and say:**
>
> > **"Hey Claude, set this up for me. Read SETUP.md and walk me through every step."**
>
> Claude will read the entire setup guide, ask you only for things it can't do automatically (like "click this OAuth link"), and stand up your own deployment in about an hour.

---

## What you get when it's running

**Web app** (deployed on Railway):
- Two-pane chat with live agent activity feed (subagents and tool calls show in real time)
- Voice notes (browser → Whisper transcription)
- File uploads (PDFs, text, images get passed to the agent)
- Mobile-friendly — works in any browser on your phone

**Slack bot**:
- DM `@Ops Orchestrator` from anywhere — phone, desktop, web
- @-mention in channels for shared questions
- Threaded conversations keep context for ~6 hours

**Notion (the data layer + 11 background agents)**:
- 12 pre-modeled databases (Clients, Projects, Tasks, Time Entries, Invoices, Meetings, Content Calendar, Community Members, Team Members, Competitors, Agent Logs, Intel Briefings)
- 11 Notion Custom Agents that run on schedules and triggers (e.g., daily revenue report, overdue invoice nudges, client health scoring, content repurposing, weekly community metrics)

**One brain across all of it**: A single Claude Managed Agent (Opus 4.7) with the Composio Tool Router attached as an MCP server, giving the orchestrator access to **Notion + Slack + Gmail + Google Calendar** through one credential.

---

## Architecture in one picture

```
                      ┌──────────────────────────────────┐
You on phone ──Slack ─►│       Slack Bridge (Railway)     │
                      │   /api/slack/events               │
                      └──────────────┬───────────────────┘
                                     │
You on desktop ──Web ─►┌──────────────▼───────────────────┐
                      │   Web App (Railway, Next.js)      │
                      │   chat + live activity dashboard  │
                      └──────────────┬───────────────────┘
                                     │ Anthropic API
                                     ▼
                      ┌──────────────────────────────────┐
                      │  Claude Managed Agent (Opus 4.7)  │
                      │  + agent_toolset_20260401         │
                      │  + Composio MCP (vault-auth'd)    │
                      └──────────────┬───────────────────┘
                                     │
              ┌──────────────┬───────┴───────┬──────────────┐
              ▼              ▼               ▼              ▼
           Notion         Slack           Gmail          Calendar
             │
             ▼
   ┌─────────────────────┐
   │ 12 Notion DBs       │ ◄── 11 Notion Custom Agents
   │ + Operations Hub    │     (background SOPs)
   └─────────────────────┘
```

Detailed architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## Repo layout

```
notion-architect-and-agent-swarm/
├── README.md                 ← you are here
├── SETUP.md                  ← natural-language setup guide (Claude reads this)
├── .env.example              ← every env var across both layers
├── notion-databases/         ← Phase 1: Notion DBs + 11 background agents + n8n workflows
│   ├── agents/agent_configs.md     (12 Notion Custom Agent specs)
│   ├── n8n/*.json                  (3 import-ready workflows)
│   ├── setup/create_missing_dbs.py (DB provisioning script)
│   └── README.md
├── web-app/                  ← Phase 2: Railway-hosted web app + Slack bridge
│   ├── app/, lib/, middleware.ts, package.json, ...
│   └── README.md
└── docs/
    ├── ARCHITECTURE.md
    ├── PHASE_1_WALKTHROUGH.md   ← clicks for the 12 Notion Custom Agents
    ├── PHASE_2_WALKTHROUGH.md   ← Railway + Anthropic + Composio + Slack
    ├── SLACK_BRIDGE_SETUP.md    ← Slack app manifest + install
    └── HANDOFF_NOTES.md         ← original team handoff context
```

---

## Two ways to set this up

### Way 1 (recommended): Let Claude do it

In Claude Code (or Claude.ai with this repo connected via GitHub):

```
Hey Claude, set this up for me. Read SETUP.md and walk me through every step.
```

Claude will:
- Check what's installed on your machine (Node, Railway CLI, gh, etc.) and install what's missing
- Create the Anthropic Managed Agent + environment via the API
- Create the Composio Tool Router and authorize Notion/Slack/Gmail/Calendar
- Stand up the Railway project and deploy the web app
- Walk you through the 5 minutes of clicks needed for the Slack app + the 12 Notion Custom Agents

It will pause and ask you only when:
- It needs an API key it can't generate itself
- It needs you to click a one-time OAuth link
- A workspace-level admin action is required (Slack app install, Notion teamspace permission)

### Way 2: Manual

1. Read [SETUP.md](SETUP.md) end-to-end (~10 min read)
2. Follow [docs/PHASE_2_WALKTHROUGH.md](docs/PHASE_2_WALKTHROUGH.md) for the web app + Slack bridge
3. Follow [docs/PHASE_1_WALKTHROUGH.md](docs/PHASE_1_WALKTHROUGH.md) for the 12 Notion Custom Agents

Total time: ~90 min.

---

## What it costs to run

For a 2-person ops team with ~20 chatty turns/day:

| Item | Cost |
|---|---|
| Notion Business plan (required for Custom Agents) | $20/seat/mo |
| Anthropic API (Opus 4.7 with prompt caching) | ~$15–60/mo |
| OpenAI API (Whisper transcription only) | < $5/mo |
| Composio (free tier covers Tool Router) | $0 |
| Railway (Hobby plan, web app + bridge) | $5/mo |
| **Total marginal cost above Notion** | **~$25–70/mo** |

Notion's seat fee dominates. Everything else is metered and small.

---

## Stack

- **Brain**: Claude Managed Agent (claude-opus-4-7), `agent_toolset_20260401` (bash, file, web), MCP via Composio Tool Router
- **Web app**: Next.js 16 (App Router), React 19, Tailwind v4, Anthropic SDK, OpenAI SDK
- **Slack bridge**: HMAC-verified Events API webhook, in-memory thread→session map (6h TTL)
- **Notion data layer**: 12 databases provisioned via the Notion API (Python)
- **Background automation**: 11 Notion Custom Agents (UI-configured, paste-from-spec) + 3 n8n workflows for Read.ai, Stripe, and job scraping ingestion
- **Hosting**: Railway (web + bridge), Anthropic-hosted (agent runtime)

---

## Status of the reference deployment

This repo started as the operational system for **AI Integraterz**. The example agent configs, Slack channel names, and workflow logic reflect that real deployment — they're a **complete worked example**, not just stubs. When you set this up for yourself, you'll customize the agent instructions to match your business but the scaffolding (DBs, MCP wiring, Slack bridge, Railway config) all stays the same.

---

## License

MIT. Fork it, ship it, sell it. Attribution appreciated, not required.
