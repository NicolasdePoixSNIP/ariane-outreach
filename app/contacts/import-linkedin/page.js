"use client";
import { useState } from "react";
import Link from "next/link";
import { parseCsv } from "@/lib/csv";

export default function ImportLinkedin() {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState("");

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setRes(null); setErr("");
    const all = parseCsv((await f.text()).replace(/^﻿/, ""));
    const h = all[0].map((x) => x.trim());
    if (!h.includes("campagne") || !h.includes("user_id")) { setErr("Ce n’est pas le fichier Prospection_LinkedIn.csv (colonnes campagne et user_id absentes)."); return; }
    setRows(all.slice(1).map((r) => Object.fromEntries(h.map((k, i) => [k, r[i] ?? ""]))));
  }

  async function send() {
    setBusy(true); setErr("");
    try {
      let imported = 0; const camps = new Set();
      for (let i = 0; i < rows.length; i += 200) {
        const r = await fetch("/api/import/linkedin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rows: rows.slice(i, i + 200) }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        imported += j.imported; j.campaigns.forEach((c) => camps.add(c));
      }
      const r = await fetch("/api/import/linkedin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ finalize: true, campaigns: [...camps] }) });
      const stats = await r.json();
      setRes({ imported, stats });
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const byCamp = rows ? rows.reduce((a, r) => ((a[r.campagne] = (a[r.campagne] || 0) + 1), a), {}) : {};
  return (
    <>
      <div className="top">
        <div><p className="eye">Contacts et audiences</p><h1>Reprendre le suivi LinkedIn</h1>
          <p className="lead">Fichier Prospection_LinkedIn.csv (dossier Documents/Prospection). Les campagnes sont créées avec l’état réel de chaque contact. Vous pouvez réimporter le fichier à tout moment : les états sont mis à jour, sans doublon.</p></div>
        <div className="btns"><Link className="btn" href="/campagnes">Voir les campagnes</Link></div>
      </div>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div><label className="lbl" htmlFor="f">Fichier</label><input id="f" className="field" type="file" accept=".csv,text/csv" onChange={onFile} /></div>
        {rows ? (<>
          <div className="note">{rows.length} lignes : {Object.entries(byCamp).map(([k, v]) => `${k} (${v})`).join(", ")}</div>
          <div><button className="btn pri" type="button" onClick={send} disabled={busy}>{busy ? "Import en cours…" : "Importer le suivi"}</button></div>
        </>) : null}
        {res ? <div className="ok">{res.imported} contacts repris. {Object.entries(res.stats).map(([k, s]) => `${k} : ${s.invites} invitations, ${s.accepted} acceptations, ${s.messages} messages, ${s.replies} réponses`).join(" · ")}</div> : null}
        {err ? <div className="err">{err}</div> : null}
      </div>
    </>
  );
}
