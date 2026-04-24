# AI Integraterz — Notion-Native Operations System

**Version:** 4.0 | **Built:** 2026-04-22

## What's Built

| Component | Status | Location |
|---|---|---|
| 10 core Notion databases | ✅ Existed, verified | Operations Hub in Notion |
| Community Members DB | ✅ Created | Operations Hub in Notion |
| Intel Briefings DB | ✅ Created | Operations Hub in Notion |
| Seed data (team + clients) | ✅ Inserted | Notion |
| Agent config guide (12 agents) | ✅ Ready | agents/agent_configs.md |
| n8n: Read.ai → Meetings | ✅ Ready to import | n8n/workflow_readai_to_notion.json |
| n8n: Stripe → Invoices | ✅ Ready to import | n8n/workflow_stripe_to_notion.json |
| n8n: Job Scraping | ✅ Ready to import | n8n/workflow_job_scraping.json |

## Database IDs

| Database | ID |
|---|---|
| Clients | f57e30ec-a7da-4246-95e0-313d4e3fbe1c |
| Projects | 9dc3586b-84b5-44dc-a2e8-9bbfcaffae47 |
| Tasks | f52411c6-2cc6-48e8-a6f8-2c3378dcc8ab |
| Time Entries | 253abb88-637e-44f7-a0aa-6c1093a3c90a |
| Invoices | 5b824640-fb43-4d32-b5ce-6f5010af75fc |
| Meetings | b33f9993-5266-43d4-ae0b-8dbf538438d9 |
| Content Calendar | 9fabc332-d7ad-438c-b096-e06947c8299f |
| Community Members | 34a3fa00-4c9d-815a-b2bb-c9f98f57b9f9 |
| Team Members | e596c0ba-e2c6-45a1-830b-e978ff547a00 |
| Competitors | 6305ef90-e8f4-4362-a803-792c16c40dd8 |
| Agent Logs | 4ea81396-ab21-465d-8038-4e4167da1ed2 |
| Intel Briefings | 34a3fa00-4c9d-813b-8065-fbb432413761 |

## Next Steps

### 1. Rotate your Notion token (SECURITY)
Go to notion.so/profile/integrations → find your integration → regenerate token.

### 2. Set up Slack channels
See the "Slack Channel Setup Checklist" in agents/agent_configs.md.

### 3. Configure Notion Custom Agents
Follow agents/agent_configs.md — activate in the order listed at the bottom.
Requires Notion Business or Enterprise plan.

### 4. Import n8n workflows
1. Open n8n Cloud → Workflows → Import from file
2. Import each JSON file from the n8n/ folder
3. Add your Notion credentials to n8n
4. Activate each workflow
5. Copy webhook URLs → configure in Read.ai and Stripe dashboards

### 5. Update n8n job scraping workflow
Open n8n/workflow_job_scraping.json and replace `COMMUNITY_MEMBERS_DB_ID` 
with `34a3fa00-4c9d-815a-b2bb-c9f98f57b9f9`

### 6. Add database views manually in Notion
The Notion API has limited view creation support. Create views per the spec manually:
- See Part 2 of the original build spec for the full view list per database.
- Priority views to create first: Sprint Board (Tasks), Pipeline (Clients), 
  Certification Pipeline (Community Members), Calendar (Meetings).
