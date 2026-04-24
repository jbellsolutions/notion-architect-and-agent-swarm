"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch("/api/login", { method: "POST", body: JSON.stringify({ password: pw }) });
    if (r.ok) router.push("/");
    else { setErr("Wrong password"); setBusy(false); }
  }

  return (
    <main style={{ display: "grid", placeItems: "center", minHeight: "100vh" }}>
      <form onSubmit={submit} style={{ background: "var(--panel)", padding: 32, borderRadius: 12, border: "1px solid var(--border)", width: 360 }}>
        <h1 style={{ marginBottom: 4 }}>Notion PM</h1>
        <p style={{ color: "var(--muted)", marginBottom: 20 }}>Managed Agent Fleet</p>
        <input
          autoFocus
          type="password"
          placeholder="Shared password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          style={{ width: "100%", padding: 10, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)" }}
        />
        {err && <div style={{ color: "var(--red)", marginTop: 8, fontSize: 13 }}>{err}</div>}
        <button
          type="submit"
          disabled={busy}
          style={{ marginTop: 14, width: "100%", padding: 10, background: "var(--accent)", color: "#0a0a0b", border: 0, borderRadius: 8, fontWeight: 600, cursor: "pointer" }}
        >
          {busy ? "..." : "Enter"}
        </button>
      </form>
    </main>
  );
}
