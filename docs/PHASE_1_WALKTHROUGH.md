# Phase 1 Walkthrough — Notion Custom Agents Activation

**Audience:** Justin (and Xander if delegating). **Estimated time:** ~90 minutes total. **Prerequisite:** Notion Business plan, Slack admin access, Google account `your-email@yourdomain.com` available for Gmail/Calendar connectors.

This guide turns the 12 agent specs in [agents/agent_configs.md](agents/agent_configs.md) into live Notion Custom Agents. It assumes Claude has already (a) created the 11 Slack channels via Composio and (b) verified the 12 databases exist.

> **Why you have to click these yourself:** Notion's public API does not expose Custom Agent CRUD. There is no "create agent via API." This is a manual setup. The good news: it's a one-time job and the instructions copy-paste cleanly.

---

## 0. Pre-flight (5 min)

1. **Rotate the Notion integration token** flagged in [README.md](README.md) step #1. Go to https://notion.so/profile/integrations → find the integration that owns the Operations Hub → "Regenerate token". Save the new token to `~/.env.notion` or your password manager — do not paste in chat.
2. **Confirm Custom Agents are enabled** in Notion: Settings → AI → Custom Agents. If you don't see this menu, your plan tier doesn't include them. Upgrade to Business or Enterprise.
3. **Confirm the 11 Slack channels exist**: open Slack → look for `#new-clients`, `#client-health`, `#finance`, `#revenue`, `#content`, `#community`, `#market-intel`, `#team`, `#daily-dashboard`, `#weekly-report`. (Claude creates these via Composio; if any are missing, ping Claude.)
4. **Add the priority Notion views manually** (the Notion API can't create persistent views — listed in [README.md](README.md) step #6):
   - **Tasks DB**: "Sprint Board" — Kanban grouped by Status, filtered to current sprint
   - **Clients DB**: "Pipeline" — Kanban grouped by Status
   - **Community Members DB**: "Certification Pipeline" — Kanban grouped by Cert Level
   - **Meetings DB**: "Calendar" — Calendar view by Date

---

## 1. Activation order (DO NOT skip — dependencies)

Per [agents/agent_configs.md:855-870](agents/agent_configs.md), activate in this order so each agent has the dependencies it needs:

| # | Agent | Why this position |
|---|---|---|
| 1 | Reporting Agent | Read-only — confirms all DB access works without risk |
| 2 | Project Management Agent | Enables Slack→Notion task capture immediately |
| 3 | Operations Orchestrator (#12) | Conversational access to everything |
| 4 | Finance Agent | Daily overdue invoice check |
| 5 | Client Success Agent | Health scoring kicks in |
| 6 | Content Operations Agent | Content pipeline live |
| 7 | Community Growth Agent | Certification tracking |
| 8 | HR / Team Operations Agent | Team onboarding flows |
| 9 | Market Intelligence Agent | Competitor tracking |
| 10 | Workspace Health Agent | Weekly cleanup |
| 11 | Meeting Intelligence Agent | **Only after** n8n Read.ai workflow is live |
| 12 | Client Onboarding Agent | **Only after** end-to-end test with a dummy client |

---

## 2. Per-agent setup (repeat 12 times)

For each agent in `agents/agent_configs.md`:

1. Notion → **Settings (gear)** → **AI** → **Custom Agents** → **New Agent**
2. **Name**: copy the bold "**Name:**" field from the spec
3. **Icon**: copy the emoji
4. **Model**: pick Claude (default for all 12)
5. **Instructions**: paste the entire `Instructions (paste as-is):` code block — verbatim. Do not paraphrase.
6. **Triggers**: configure each `Trigger:` line:
   - "Database trigger — X — Page added" → Triggers tab → Add Trigger → Database → select X → Page added
   - "Schedule — daily at 9:00 AM ET" → Triggers tab → Add Trigger → Schedule → cron `0 9 * * *` (set timezone to ET)
   - "Slack trigger — emoji reaction `:task:`" → Triggers tab → Add Trigger → Slack → Reaction → emoji name
   - "Slack trigger — direct mention" → Add Trigger → Slack → Mention
7. **Database access**: per the `Database access:` line, grant only the listed databases (least privilege)
8. **Connectors**: per the `Connectors:` line, install Slack/Gmail/Google Calendar — Notion will walk you through OAuth. Use `your-email@yourdomain.com` for Google.
9. **Web browsing**: enable only on Agents 5, 10 (per their specs)
10. **Save**, then **Activate**
11. **Run the test scenario** at the bottom of each agent's spec → confirm expected behavior
12. ✅ Move to next agent

---

## 3. Pin the DB ID table inside each agent's instructions

Notion Custom Agents work better when DB IDs are explicit. After pasting the instructions, append this block at the bottom of every agent's instructions field:

```
DATABASE IDs (always reference by ID, never by title alone):
- Clients:           f57e30ec-a7da-4246-95e0-313d4e3fbe1c
- Projects:          9dc3586b-84b5-44dc-a2e8-9bbfcaffae47
- Tasks:             f52411c6-2cc6-48e8-a6f8-2c3378dcc8ab
- Time Entries:      253abb88-637e-44f7-a0aa-6c1093a3c90a
- Invoices:          5b824640-fb43-4d32-b5ce-6f5010af75fc
- Meetings:          b33f9993-5266-43d4-ae0b-8dbf538438d9
- Content Calendar:  9fabc332-d7ad-438c-b096-e06947c8299f
- Community Members: 34a3fa00-4c9d-815a-b2bb-c9f98f57b9f9
- Team Members:      e596c0ba-e2c6-45a1-830b-e978ff547a00
- Competitors:       6305ef90-e8f4-4362-a803-792c16c40dd8
- Agent Logs:        4ea81396-ab21-465d-8038-4e4167da1ed2
- Intel Briefings:   34a3fa00-4c9d-813b-8065-fbb432413761
```

---

## 4. n8n imports (after Reporting + PM + Orchestrator are live)

Per [README.md](README.md) steps 4–5:

1. n8n Cloud → Workflows → Import from file
2. Import each JSON in [n8n/](n8n/):
   - `workflow_readai_to_notion.json`
   - `workflow_stripe_to_notion.json`
   - `workflow_job_scraping.json`
3. Add your rotated Notion credential to n8n
4. **Edit `workflow_job_scraping.json`** — replace `COMMUNITY_MEMBERS_DB_ID` with `34a3fa00-4c9d-815a-b2bb-c9f98f57b9f9`
5. Activate each workflow
6. Copy the webhook URLs n8n generates → paste into Read.ai dashboard (meeting webhooks) and Stripe dashboard (invoice events)
7. **Now activate Agent #11 (Meeting Intelligence)** — it depends on `workflow_readai_to_notion`

---

## 5. End-to-end smoke tests (15 min)

Run these in order — each one validates a layer.

| Test | Action | Expected within 60s |
|---|---|---|
| **Reporting Agent** | DM Operations Orchestrator: "run daily dashboard" | Formatted report posted to `#daily-dashboard` |
| **PM Agent** | React with `:task:` to any Slack message | Task appears in Tasks DB; thread reply with link |
| **Orchestrator** | DM: "Give me a full picture of [an existing client]" | Returns health + open tasks + last meeting + invoice status |
| **Community Growth** | Add a dummy row to Community Members DB | Welcome comment + Cert Level=Entry + 3 onboarding tasks + post to `#community` |
| **Finance** | Create an Invoice with Status=Sent, Due Date=yesterday | Next 9 AM ET run flips it to Overdue + posts to `#finance` |
| **Onboarding (last test)** | Add test client with Offer = "30 Day AI Chief Officer" | Project + 22 tasks + Slack post + Gmail draft + calendar invites |

If any test fails, check the agent's "Activity" panel inside Notion's Custom Agent UI — it shows the agent's reasoning trace and any errors. Most failures are missing DB access grants or unmapped Slack channel names.

---

## 6. After Phase 1 is bedded in

- Use the system for ~1 week before touching Phase 2.
- Note what feels missing (e.g., longer reasoning, file uploads, parallel subagents) — that's exactly what Phase 2's Managed Agent on Railway adds.
- The Railway app at `Notion Project Manager - Managed Agent Fleet` is already scaffolded; it'll be ready when you are.

---

## Troubleshooting

- **Custom Agent menu doesn't appear** → Plan tier issue. Verify Business+ at https://notion.so/upgrade.
- **"Database not found" errors in agent traces** → Database access grant missing. Re-edit the agent → Database access tab.
- **Slack messages not posting** → Slack connector not authed in Notion, or channel name typo. Re-install the connector and re-test.
- **Schedule triggers not firing** → Notion's scheduler runs in UTC by default; double-check timezone is set to ET in each agent's trigger config.
- **Gmail drafts not appearing** → Gmail connector authed under wrong account. Disconnect and re-auth as `your-email@yourdomain.com`.
