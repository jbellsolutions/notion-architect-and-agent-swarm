# Architecture

Two layers, one brain, two front doors.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          USER SURFACES                                  │
├──────────────────────────────────┬──────────────────────────────────────┤
│  Web App (Railway)               │  Slack (mobile + desktop)            │
│  • two-pane chat + activity      │  • DM @Ops Orchestrator              │
│  • voice (Whisper) + uploads     │  • @-mention in any channel          │
│  • Cookie auth (single shared    │  • thread = persistent session       │
│    password for the team)        │    for ~6h                           │
└────────────────┬─────────────────┴───────────────────┬──────────────────┘
                 │                                     │
                 │ POST /api/agent/{session,send}      │ POST /api/slack/events
                 │ GET  /api/agent/stream/[sid]        │ (HMAC-verified)
                 ▼                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                  RAILWAY WEB APP (Next.js 16)                           │
│                                                                         │
│   /api/agent/session    → POST /v1/sessions  (with vault_ids)           │
│   /api/agent/send       → POST /v1/sessions/{id}/events                 │
│   /api/agent/stream/[]  → SSE proxy from /v1/sessions/{id}/stream       │
│   /api/agent/upload     → text/binary inlining                          │
│   /api/agent/transcribe → OpenAI Whisper                                │
│   /api/slack/events     → bridge: thread→session map → runTurn()        │
│   /api/login, /api/health, /api/debug                                   │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             │ x-api-key + anthropic-beta:managed-agents-2026-04-01
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                ANTHROPIC MANAGED AGENT (Anthropic-hosted)               │
│                                                                         │
│  agent_xxx (claude-opus-4-7)                                            │
│  ├─ system prompt: Operations Orchestrator instructions + DB IDs        │
│  ├─ tools:                                                              │
│  │    • agent_toolset_20260401  (bash, file, web, code exec)            │
│  │    • mcp_toolset → "composio"                                        │
│  ├─ mcp_servers:                                                        │
│  │    • composio → https://backend.composio.dev/tool_router/.../mcp     │
│  └─ environment: env_xxx (cloud, unrestricted networking)               │
│                                                                         │
│  per-session: vault_ids:[vlt_xxx]                                       │
│    └─ static_bearer credential for the Composio MCP URL                 │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             │ MCP over streamable HTTP
                             ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                COMPOSIO TOOL ROUTER (Composio-hosted)                   │
│                                                                         │
│  trs_xxx                                                                │
│  ├─ Notion        (OAuth, scoped to your Operations Hub teamspace)      │
│  ├─ Slack         (OAuth, scoped to your workspace)                     │
│  ├─ Gmail         (OAuth)                                               │
│  └─ Google Calendar (OAuth)                                             │
│                                                                         │
│  Exposes: COMPOSIO_SEARCH_TOOLS, COMPOSIO_MULTI_EXECUTE_TOOL,           │
│           COMPOSIO_GET_TOOL_SCHEMAS, COMPOSIO_REMOTE_BASH_TOOL, ...     │
│  Plus dynamic resolution of any tool in any of the 4 toolkits.          │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
        ┌────────────────────┼─────────────────────┬──────────────┐
        ▼                    ▼                     ▼              ▼
   ┌─────────────┐    ┌─────────────┐    ┌──────────────┐    ┌──────────┐
   │   NOTION    │    │    SLACK    │    │    GMAIL     │    │ CALENDAR │
   │             │    │             │    │              │    │          │
   │ 12 DBs:     │    │ Workspace:  │    │ Drafts +     │    │ Events + │
   │ - Clients   │    │ - channels  │    │ send         │    │ invites  │
   │ - Projects  │    │ - DMs       │    │              │    │          │
   │ - Tasks     │    │ - threads   │    │              │    │          │
   │ - Time      │    │ - reactions │    │              │    │          │
   │ - Invoices  │    │ - canvases  │    │              │    │          │
   │ - Meetings  │    └─────────────┘    └──────────────┘    └──────────┘
   │ - Content   │                                                       
   │ - Community │      ◄─── 11 Notion Custom Agents run here ───►       
   │ - Team      │           (Phase 1 — UI-configured background SOPs)   
   │ - Competit. │                                                       
   │ - AgentLogs │                                                       
   │ - Intel     │                                                       
   └─────────────┘                                                       
```

## Data flow walkthroughs

### "Count clients in Notion" (web app)

1. User types in chat → POST `/api/agent/send` → forwards to `POST /v1/sessions/{id}/events` with the user message
2. EventSource on `/api/agent/stream/{sid}` is already open → SSE proxies Anthropic → browser
3. Agent loads (cache hit on system prompt + Composio tool catalog ~16K tokens)
4. Agent calls `COMPOSIO_SEARCH_TOOLS({use_case: "query notion database"})` via MCP
5. Composio returns the right tool slug (`NOTION_QUERY_DATABASE`)
6. Agent calls `COMPOSIO_MULTI_EXECUTE_TOOL` with that slug + database_id
7. Composio routes to Notion API, returns row data
8. Agent counts and replies "Count: N"
9. Browser sees `agent` event → renders text; `tool_use`/`tool_result` events render as cards in the right pane
10. `status_idle` event → cards mark complete, streaming indicator clears

End-to-end latency: ~25-40s for a Notion query (most of it is Composio's tool discovery + execution).

### "Hey @Ops Orchestrator, how many tasks are in progress?" (Slack)

1. Slack POSTs to `/api/slack/events`
2. `verifySlackSignature` checks HMAC against `SLACK_SIGNING_SECRET` (replay window 5 min)
3. URL verification handshake done once at app install — handled inline
4. `event_callback` with `event.type === "app_mention"` → returns 200 immediately, kicks off `handleAsync` in the background (Slack requires <3s ack)
5. `handleAsync` adds ⏳ reaction, calls `runTurn()`
6. `runTurn` looks up the thread→session map. If thread is new, creates a new Anthropic session
7. Sends user message, opens stream, accumulates `agent` text events until `status_idle`
8. Posts assembled reply via `chat.postMessage` to the same thread
9. Replaces ⏳ with ✅

Threads are sticky for 6 hours of inactivity → conversational context persists across messages in the same thread.

## Why this architecture

**Anthropic-hosted agent runtime** instead of self-hosted: no container management, automatic model upgrades, native MCP support, vault-managed credentials. Trade-off: Anthropic-only and behind a beta header.

**Composio Tool Router** instead of direct MCP per app: one URL, one credential, four apps. Composio handles OAuth refresh, rate limiting, and MCP protocol translation. Trade-off: extra hop adds 1-3s of latency per tool call vs. direct.

**Notion Custom Agents** for background SOPs (Phase 1) instead of putting everything in the Managed Agent: Notion's agents can subscribe to database triggers natively (e.g., "when a page is added to Clients DB, do X"). The Managed Agent doesn't have webhook ingress without us building it — Notion gets it for free.

**Railway** instead of Vercel: edge functions don't easily handle long-lived SSE streams; standard Node hosting is simpler. Plus the user pays for Railway already.

**Slack bridge as a separate route** instead of running through the same `/api/agent/send`: Slack has its own auth (HMAC), its own ack-deadline (3s), and its own user/thread session model. Cleaner to keep separate.
