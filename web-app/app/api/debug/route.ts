import { NextResponse } from "next/server";
import { isAuthed } from "@/lib/auth";
import { readConfig } from "@/lib/anthropic";

export async function GET() {
  if (!(await isAuthed())) return NextResponse.json({ error: "unauth" }, { status: 401 });
  const cfg = readConfig();
  return NextResponse.json({
    agentId: cfg.agentId,
    environmentId: cfg.environmentId,
    vaultIdsCount: cfg.vaultIds.length,
    vaultIds: cfg.vaultIds,
    rawEnvVaultIds: process.env.ANTHROPIC_VAULT_IDS ?? null,
    nodeVersion: process.version,
  });
}
