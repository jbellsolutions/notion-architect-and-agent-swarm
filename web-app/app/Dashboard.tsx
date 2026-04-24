"use client";

import { useEffect, useRef, useState } from "react";

type ChatMsg = { role: "user" | "agent"; text: string; ts: number };

type ActivityCard = {
  id: string;
  label: string;       // e.g. "Orchestrator" or "Subagent: Notion Reader"
  detail: string;      // current action / tool args summary
  status: "running" | "done" | "queued" | "error";
  startedAt: number;
  endedAt?: number;
};

type Attachment = { kind: "text" | "binary"; name: string; text?: string; mime?: string; size?: number };

export default function Dashboard() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [activity, setActivity] = useState<ActivityCard[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const esRef = useRef<EventSource | null>(null);
  const liveAgentMsgRef = useRef<string>("");
  const streamTurnTsRef = useRef<number>(0);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const r = await fetch("/api/agent/session", { method: "POST", body: JSON.stringify({}) });
    if (!r.ok) throw new Error(await r.text());
    const { id } = await r.json();
    setSessionId(id);
    return id;
  }

  function attachStream(sid: string) {
    esRef.current?.close();
    const es = new EventSource(`/api/agent/stream/${sid}`);
    esRef.current = es;
    setStreaming(true);
    liveAgentMsgRef.current = "";

    es.onmessage = (e) => {
      let evt: any;
      try { evt = JSON.parse(e.data); } catch { return; }
      handleEvent(evt);
    };
    es.onerror = () => { /* keep open; SSE auto-retries */ };
  }

  function handleEvent(evt: any) {
    const t = evt?.type;
    // Agent message (assistant response text)
    if (t === "agent") {
      const piece = (evt.content ?? []).map((b: any) => b?.text ?? "").join("");
      if (piece) {
        liveAgentMsgRef.current += piece;
        setMessages((m) => {
          const last = m[m.length - 1];
          if (last?.role === "agent" && last.ts === streamTurnTsRef.current) {
            return [...m.slice(0, -1), { ...last, text: liveAgentMsgRef.current }];
          }
          return [...m, { role: "agent", text: liveAgentMsgRef.current, ts: streamTurnTsRef.current }];
        });
      }
    }
    // Tool use (subagent or built-in tool)
    else if (t === "tool_use") {
      const id = evt.id ?? `${evt.name}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const name = evt.name ?? "tool";
      const isSubagent = name.toLowerCase().includes("agent") || name.toLowerCase().includes("task") || name === "dispatch_agent";
      setActivity((a) => [{
        id,
        label: isSubagent ? `Subagent · ${name}` : name,
        detail: summarizeArgs(evt.input ?? evt.arguments ?? {}),
        status: "running" as const,
        startedAt: Date.now(),
      }, ...a].slice(0, 50));
    }
    // Tool result
    else if (t === "tool_result") {
      const id = evt.tool_use_id ?? evt.id;
      setActivity((a) => a.map((c) => (c.id === id ? { ...c, status: evt.is_error ? "error" : "done", endedAt: Date.now() } : c)));
    }
    // Model request boundaries — useful for showing "thinking" state
    else if (t === "model_request_start") {
      // mark a new turn boundary so streaming text appends fresh
      streamTurnTsRef.current = Date.now();
      liveAgentMsgRef.current = "";
    }
    // Idle = turn complete
    else if (t === "status_idle") {
      setStreaming(false);
      setActivity((a) => a.map((c) => (c.status === "running" ? { ...c, status: "done", endedAt: Date.now() } : c)));
      liveAgentMsgRef.current = "";
    }
    // Errors
    else if (t === "error" || t === "session_error") {
      setError(evt.message ?? evt.error?.message ?? "stream error");
    }
  }

  async function send() {
    setError(null);
    const text = input.trim();
    if (!text && attachments.length === 0) return;
    const sid = await ensureSession().catch((e) => { setError(String(e)); return null; });
    if (!sid) return;

    setMessages((m) => [...m, { role: "user", text: text || "(attachments only)", ts: Date.now() }]);
    setInput("");

    if (!esRef.current || esRef.current.readyState === 2) attachStream(sid);

    const r = await fetch("/api/agent/send", {
      method: "POST",
      body: JSON.stringify({ sessionId: sid, text, attachments }),
    });
    if (!r.ok) setError(`send failed: ${await r.text()}`);
    setAttachments([]);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch("/api/agent/upload", { method: "POST", body: fd });
    if (!r.ok) { setError("upload failed"); return; }
    const a = await r.json();
    setAttachments((xs) => [...xs, a]);
    e.target.value = "";
  }

  async function toggleMic() {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      recRef.current = rec;
      chunksRef.current = [];
      rec.ondataavailable = (e) => chunksRef.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("audio", new File([blob], "voice.webm", { type: "audio/webm" }));
        const r = await fetch("/api/agent/transcribe", { method: "POST", body: fd });
        if (r.ok) {
          const { text } = await r.json();
          setInput((x) => (x ? `${x} ${text}` : text));
        } else setError("transcription failed");
      };
      rec.start();
      setRecording(true);
    } catch (err) { setError(String(err)); }
  }

  return (
    <main style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", height: "100vh" }}>
      {/* CHAT */}
      <section style={{ display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)" }}>
        <header style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 600 }}>Notion PM — Operations Orchestrator</div>
            <div style={{ color: "var(--muted)", fontSize: 12 }}>{sessionId ? `Session ${sessionId.slice(0, 12)}…` : "No session yet"}</div>
          </div>
          <button
            onClick={() => { esRef.current?.close(); setSessionId(null); setMessages([]); setActivity([]); }}
            style={{ background: "transparent", border: "1px solid var(--border)", color: "var(--muted)", padding: "6px 12px", borderRadius: 6, cursor: "pointer" }}
          >
            New
          </button>
        </header>

        <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
          {messages.length === 0 && (
            <div style={{ color: "var(--muted)", textAlign: "center", marginTop: 60 }}>
              Ask anything. Try: <em>"Pull a full picture of SpeakerAgent — health, tasks, last meeting, invoices."</em>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ marginBottom: 16, display: "flex", gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: m.role === "user" ? "var(--accent-soft)" : "var(--panel-2)", color: m.role === "user" ? "var(--accent)" : "var(--muted)", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                {m.role === "user" ? "U" : "A"}
              </div>
              <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55, paddingTop: 4 }}>{m.text}</div>
            </div>
          ))}
          {streaming && <div style={{ color: "var(--muted)", fontSize: 12, marginLeft: 38 }}>● streaming…</div>}
          <div ref={chatBottomRef} />
        </div>

        <div style={{ borderTop: "1px solid var(--border)", padding: 14 }}>
          {attachments.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {attachments.map((a, i) => (
                <span key={i} style={{ background: "var(--panel-2)", padding: "4px 8px", borderRadius: 6, fontSize: 12, color: "var(--muted)" }}>
                  📎 {a.name}
                </span>
              ))}
            </div>
          )}
          {error && <div style={{ color: "var(--red)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={toggleMic} title={recording ? "Stop" : "Voice note"} style={iconBtn(recording)}>
              {recording ? "■" : "🎤"}
            </button>
            <label style={{ ...iconBtn(false), cursor: "pointer" }} title="Attach">
              📎
              <input type="file" hidden onChange={onFile} />
            </label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Ask or instruct…"
              rows={1}
              style={{ flex: 1, background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "10px 12px", color: "var(--text)", resize: "none", fontFamily: "inherit", fontSize: 14 }}
            />
            <button onClick={send} disabled={streaming || (!input.trim() && attachments.length === 0)} style={{ background: "var(--accent)", color: "#0a0a0b", border: 0, borderRadius: 8, padding: "0 16px", fontWeight: 600, cursor: "pointer", opacity: streaming ? 0.5 : 1 }}>
              Send
            </button>
          </div>
        </div>
      </section>

      {/* ACTIVITY */}
      <aside style={{ display: "flex", flexDirection: "column", background: "var(--panel)" }}>
        <header style={{ padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 600 }}>Live Agent Activity</div>
          <div style={{ color: "var(--muted)", fontSize: 12 }}>{activity.filter((c) => c.status === "running").length} running · {activity.filter((c) => c.status === "done").length} done</div>
        </header>
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {activity.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", marginTop: 40 }}>
              Tools and subagents will appear here as the orchestrator works.
            </div>
          ) : (
            activity.map((c) => <Card key={c.id} card={c} />)
          )}
        </div>
      </aside>
    </main>
  );
}

function Card({ card }: { card: ActivityCard }) {
  const dot =
    card.status === "running" ? "var(--green)" :
    card.status === "done" ? "var(--muted)" :
    card.status === "error" ? "var(--red)" : "var(--yellow)";
  const elapsed = ((card.endedAt ?? Date.now()) - card.startedAt) / 1000;
  return (
    <div style={{ background: "var(--panel-2)", border: "1px solid var(--border)", borderRadius: 8, padding: 12, marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: dot, boxShadow: card.status === "running" ? `0 0 8px ${dot}` : "none" }} />
        <div style={{ fontWeight: 600, fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{card.label}</div>
        <div style={{ color: "var(--muted)", fontSize: 11 }}>{elapsed.toFixed(1)}s</div>
      </div>
      {card.detail && (
        <div style={{ color: "var(--muted)", fontSize: 12, marginTop: 6, paddingLeft: 16, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          {card.detail}
        </div>
      )}
    </div>
  );
}

function iconBtn(active: boolean): React.CSSProperties {
  return {
    width: 38,
    height: 38,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: active ? "var(--accent-soft)" : "var(--panel-2)",
    color: active ? "var(--accent)" : "var(--muted)",
    fontSize: 16,
    cursor: "pointer",
    display: "grid",
    placeItems: "center",
  };
}

function summarizeArgs(input: any): string {
  if (!input || typeof input !== "object") return "";
  const keys = Object.keys(input);
  if (keys.length === 0) return "";
  const parts = keys.slice(0, 3).map((k) => {
    const v = input[k];
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return `${k}: ${s.length > 60 ? s.slice(0, 60) + "…" : s}`;
  });
  return parts.join(" · ");
}
