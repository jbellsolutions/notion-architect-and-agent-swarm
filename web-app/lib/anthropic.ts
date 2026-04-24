const BETA = "managed-agents-2026-04-01";
const BASE = "https://api.anthropic.com/v1";

function headers() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY missing");
  return {
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-beta": BETA,
    "content-type": "application/json",
  };
}

export function readConfig() {
  return {
    agentId: process.env.ANTHROPIC_AGENT_ID ?? "",
    environmentId: process.env.ANTHROPIC_ENVIRONMENT_ID ?? "",
    vaultIds: (process.env.ANTHROPIC_VAULT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  };
}
export const config = readConfig();

export async function createSession(title?: string) {
  const cfg = readConfig();
  if (!cfg.agentId || !cfg.environmentId)
    throw new Error("ANTHROPIC_AGENT_ID and ANTHROPIC_ENVIRONMENT_ID must be set");
  const body: Record<string, unknown> = {
    agent: cfg.agentId,
    environment_id: cfg.environmentId,
    title: title ?? `Session ${new Date().toISOString()}`,
  };
  if (cfg.vaultIds.length) body.vault_ids = cfg.vaultIds;
  const r = await fetch(`${BASE}/sessions`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`session create failed (${r.status}): ${await r.text()}`);
  return r.json() as Promise<{ id: string; title?: string }>;
}

export async function sendUserMessage(sessionId: string, content: Array<Record<string, unknown>>) {
  const r = await fetch(`${BASE}/sessions/${sessionId}/events`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ events: [{ type: "user.message", content }] }),
  });
  if (!r.ok) throw new Error(`send failed (${r.status}): ${await r.text()}`);
  return r.json();
}
