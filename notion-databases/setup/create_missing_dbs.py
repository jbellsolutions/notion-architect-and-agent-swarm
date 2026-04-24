"""
Creates the 2 missing Notion databases + seed data for AI Integraterz Ops System.
Run: python3 setup/create_missing_dbs.py
"""

import requests
import json
import time
import os

NOTION_TOKEN = os.environ.get("NOTION_TOKEN")
if not NOTION_TOKEN:
    raise SystemExit("NOTION_TOKEN env var required. Get one at https://notion.so/profile/integrations.")

# These IDs are example values from the AI Integraterz reference deployment.
# Override via env vars for your own workspace, or replace with values from your provisioning run.
OPS_HUB_ID = os.environ.get("OPS_HUB_ID", "3493fa00-4c9d-8105-8a4e-ccdb8f4700c9")
CLIENTS_DB_ID = os.environ.get("CLIENTS_DB_ID", "f57e30ec-a7da-4246-95e0-313d4e3fbe1c")
TASKS_DB_ID = os.environ.get("TASKS_DB_ID", "f52411c6-2cc6-48e8-a6f8-2c3378dcc8ab")
TEAM_DB_ID = os.environ.get("TEAM_DB_ID", "e596c0ba-e2c6-45a1-830b-e978ff547a00")

HEADERS = {
    "Authorization": f"Bearer {NOTION_TOKEN}",
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
}

def api(method, path, body=None):
    url = f"https://api.notion.com/v1{path}"
    resp = getattr(requests, method)(url, headers=HEADERS, json=body)
    if not resp.ok:
        print(f"  ERROR {resp.status_code}: {resp.text[:300]}")
    return resp.json()

def create_db(title, parent_id, properties, emoji=None):
    icon = {"type": "emoji", "emoji": emoji} if emoji else None
    body = {
        "parent": {"type": "page_id", "page_id": parent_id},
        "title": [{"type": "text", "text": {"content": title}}],
        "properties": properties,
    }
    if icon:
        body["icon"] = icon
    result = api("post", "/databases", body)
    db_id = result.get("id", "ERROR")
    print(f"  Created: {title} → {db_id}")
    time.sleep(0.4)
    return db_id

def create_page(db_id, properties):
    body = {"parent": {"database_id": db_id}, "properties": properties}
    result = api("post", "/pages", body)
    page_id = result.get("id", "ERROR")
    time.sleep(0.35)
    return page_id


# ─── 1. Community Members DB ────────────────────────────────────────────────

print("\n[1/2] Creating Community Members database...")

community_props = {
    "Name": {"title": {}},
    "Email": {"email": {}},
    "SKOOL Profile": {"url": {}},
    "Cert Level": {
        "select": {
            "options": [
                {"name": "Entry", "color": "gray"},
                {"name": "Cert 1", "color": "blue"},
                {"name": "Cert 2", "color": "purple"},
                {"name": "Cert 3", "color": "orange"},
                {"name": "Certified", "color": "green"},
            ]
        }
    },
    "Status": {
        "status": {
            "options": [
                {"name": "Applied", "color": "gray"},
                {"name": "Enrolled", "color": "blue"},
                {"name": "In Progress", "color": "yellow"},
                {"name": "Capstone", "color": "orange"},
                {"name": "Certified", "color": "green"},
                {"name": "Active", "color": "purple"},
                {"name": "Inactive", "color": "red"},
            ],
            "groups": [
                {"name": "To-do", "color": "gray", "option_ids": []},
                {"name": "In progress", "color": "blue", "option_ids": []},
                {"name": "Complete", "color": "green", "option_ids": []},
            ],
        }
    },
    "Enrolled Date": {"date": {}},
    "Graduation Date": {"date": {}},
    "Capstone Project": {"rich_text": {}},
    "Client Landed": {"checkbox": {}},
    "Emails Sent This Week": {"number": {"format": "number"}},
    "DMs Sent This Week": {"number": {"format": "number"}},
    "Jobs Applied This Week": {"number": {"format": "number"}},
    "Job Leads Received": {"number": {"format": "number"}},
    "Cold Email Active": {"checkbox": {}},
    "Flywheel Posts This Week": {"number": {"format": "number"}},
    "Notes": {"rich_text": {}},
    "Member ID": {"unique_id": {"prefix": "CM"}},
}

community_db_id = create_db("Community Members", OPS_HUB_ID, community_props, "🎓")

# Add Capstone Client relation to Community Members
print("  Adding Capstone Client relation...")
patch_body = {
    "properties": {
        "Capstone Client": {
            "relation": {
                "database_id": CLIENTS_DB_ID,
                "single_property": {},
            }
        }
    }
}
api("patch", f"/databases/{community_db_id}", patch_body)
time.sleep(0.4)


# ─── 2. Intel Briefings DB ──────────────────────────────────────────────────

print("\n[2/2] Creating Intel Briefings database...")

intel_props = {
    "Title": {"title": {}},
    "Date": {"date": {}},
    "Type": {
        "select": {
            "options": [
                {"name": "Daily", "color": "gray"},
                {"name": "Weekly", "color": "blue"},
                {"name": "Ad Hoc", "color": "yellow"},
            ]
        }
    },
    "Alert Level": {
        "select": {
            "options": [
                {"name": "Red", "color": "red"},
                {"name": "Yellow", "color": "yellow"},
                {"name": "Green", "color": "green"},
            ]
        }
    },
    "Competitors Mentioned": {
        "multi_select": {
            "options": []
        }
    },
    "Opportunities": {"rich_text": {}},
    "Summary": {"rich_text": {}},
    "Briefing ID": {"unique_id": {"prefix": "INTEL"}},
}

intel_db_id = create_db("Intel Briefings", OPS_HUB_ID, intel_props, "📡")


# ─── 3. Seed Data ────────────────────────────────────────────────────────────

print("\n[3] Inserting seed data...")

# Check if team members already exist
existing_team = api("post", f"/databases/{TEAM_DB_ID}/query", {"page_size": 10})
existing_names = []
for page in existing_team.get("results", []):
    props = page.get("properties", {})
    name_prop = props.get("Name", {}).get("title", [])
    if name_prop:
        existing_names.append(name_prop[0]["plain_text"])

print(f"  Existing team members: {existing_names}")

if "Justin Bellware" not in existing_names:
    print("  Creating Justin Bellware...")
    create_page(TEAM_DB_ID, {
        "Name": {"title": [{"text": {"content": "Justin Bellware"}}]},
        "Email": {"email": "your-email@yourdomain.com"},
        "Role": {"select": {"name": "Founder"}},
        "Status": {"status": {"name": "In progress"}},
        "Skills": {"multi_select": [
            {"name": "AI Automation"},
            {"name": "Sales"},
            {"name": "Operations"},
        ]},
    })

if "John Xander" not in existing_names:
    print("  Creating John Xander...")
    create_page(TEAM_DB_ID, {
        "Name": {"title": [{"text": {"content": "John Xander"}}]},
        "Email": {"email": "xander@usingaitoscale.com"},
        "Role": {"select": {"name": "Operations"}},
        "Status": {"status": {"name": "In progress"}},
        "Skills": {"multi_select": [
            {"name": "Operations"},
        ]},
    })

# Check existing clients
existing_clients = api("post", f"/databases/{CLIENTS_DB_ID}/query", {"page_size": 20})
existing_client_names = []
for page in existing_clients.get("results", []):
    props = page.get("properties", {})
    name_prop = props.get("Company / Name", {}).get("title", [])
    if name_prop:
        existing_client_names.append(name_prop[0]["plain_text"])

print(f"  Existing clients: {existing_client_names}")

if "SpeakerAgent — Tony D'Agostino" not in existing_client_names and "Tony D'Agostino" not in existing_client_names:
    print("  Creating Tony D'Agostino / SpeakerAgent...")
    create_page(CLIENTS_DB_ID, {
        "Company / Name": {"title": [{"text": {"content": "SpeakerAgent"}}]},
        "Contact Name": {"rich_text": [{"text": {"content": "Tony D'Agostino"}}]},
        "Category": {"select": {"name": "Offer Delivery"}},
        "Offer": {"select": {"name": "30 Day AI Chief Officer"}},
        "Status": {"status": {"name": "In progress"}},
        "Industry": {"select": {"name": "Speaking"}},
        "Health Score": {"number": 100},
    })

if "Circle of Greatness" not in existing_client_names:
    print("  Creating Circle of Greatness...")
    create_page(CLIENTS_DB_ID, {
        "Company / Name": {"title": [{"text": {"content": "Circle of Greatness"}}]},
        "Category": {"select": {"name": "Offer Delivery"}},
        "Status": {"status": {"name": "In progress"}},
        "Health Score": {"number": 100},
    })

print("\n✅ Done! Summary:")
print(f"  Community Members DB: {community_db_id}")
print(f"  Intel Briefings DB:   {intel_db_id}")
print(f"\nNext: Open Notion → Operations Hub to verify, then set up Custom Agents.")
print(f"See agents/agent_configs.md for copy-paste agent setup instructions.")
