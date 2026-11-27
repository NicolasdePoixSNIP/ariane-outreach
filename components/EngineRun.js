"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EngineRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(null);
  async function run() {
    setBusy(true); setLog(null);
    try {
      const r = await fetch("/api/engine/run", { method: "POST" });
      const j = await r.json();
      setLog(r.ok ? j.log : [j.error]);
      router.refresh();
    } catch (e) { setLog([e.message]); } finally { setBusy(false); }
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><button className="btn pri" type="button" onClick={run} disabled={busy}>{busy ? "Exécution en cours (jusqu’à 5 minutes)…" : "Lancer le moteur maintenant"}</button></div>
      {log ? <pre style={{ background: "#F1F5F9", borderRadius: 12, padding: 14, fontSize: 13, whiteSpace: "pre-wrap", margin: 0 }}>{log.join("\n") || "Rien à faire."}</pre> : null}
    </div>
  );
}
