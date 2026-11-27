"use client";
import { useState } from "react";
import Link from "next/link";
import { parseCsv, mapColumns } from "@/lib/csv";

const PROFS = [
  ["avocat", "Avocats"], ["expert-comptable", "Experts-comptables"], ["notaire", "Notaires"],
  ["cgp", "CGP"], ["banquier-prive", "Banquiers privés"], ["autre", "Autres"],
];
const FIELDS = { email: "Email", prenom: "Prénom", nom: "Nom", cabinet: "Cabinet", ville: "Ville", titre: "Titre", linkedin: "LinkedIn", profession: "Métier", dernier_contact: "Dernier contact" };

export default function Import() {
  const [rows, setRows] = useState(null);
  const [map, setMap] = useState({});
  const [fileName, setFileName] = useState("");
  const [profession, setProfession] = useState("avocat");
  const [mode, setMode] = useState("contacts");
  const [exclusion, setExclusion] = useState("stop");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    setResult(null); setError("");
    const text = await f.text();
    const all = parseCsv(text.replace(/^﻿/, ""));
    setFileName(f.name);
    setSource(f.name.replace(/\.[^.]+$/, "").slice(0, 60));
    setMap(mapColumns(all[0] || []));
    setRows(all);
  }

  async function send() {
    setBusy(true); setError(""); setResult(null);
    const data = rows.slice(1).map((r) => Object.fromEntries(Object.entries(map).map(([k, i]) => [k, r[i] ?? ""])));
    const total = { created: 0, completed: 0, skipped: 0, excluded: 0 };
    try {
      for (let i = 0; i < data.length; i += 500) {
        const res = await fetch("/api/contacts/import", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: data.slice(i, i + 500), profession, mode, exclusion, source }),
        });
        const j = await res.json();
        if (!res.ok) throw new Error(j.error || "Erreur d’import");
        for (const k in total) total[k] += j[k] || 0;
        setResult({ ...total, progress: Math.min(i + 500, data.length), of: data.length });
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const found = Object.keys(map);
  const canSend = rows && (map.email !== undefined || map.linkedin !== undefined) && !busy;

  return (
    <>
      <div className="top">
        <div>
          <p className="eye">Contacts et audiences</p>
          <h1>Importer des contacts</h1>
          <p className="lead">Fichier CSV (séparateur ; ou ,). Une colonne email ou LinkedIn est obligatoire. Un contact déjà connu n’est jamais écrasé : ses champs vides sont seulement complétés.</p>
        </div>
        <div className="btns"><Link className="btn" href="/contacts">Retour aux contacts</Link></div>
      </div>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div>
          <label className="lbl" htmlFor="f">Fichier</label>
          <input id="f" className="field" type="file" accept=".csv,text/csv" onChange={onFile} />
        </div>
        {rows ? (
          <>
            <div className="note">
              <b style={{ color: "#1E293B" }}>{fileName}</b> : {rows.length - 1} lignes. Colonnes reconnues :{" "}
              {found.length ? found.map((k) => FIELDS[k]).join(", ") : "aucune"}.
            </div>
            <div className="form-row">
              <div>
                <label className="lbl" htmlFor="mode">Type d’import</label>
                <select id="mode" className="field" value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="contacts">Contacts à prospecter</option>
                  <option value="exclusion">Liste d’exclusion</option>
                </select>
              </div>
              {mode === "contacts" ? (
                <div>
                  <label className="lbl" htmlFor="prof">Métier par défaut</label>
                  <select id="prof" className="field" value={profession} onChange={(e) => setProfession(e.target.value)}>
                    {PROFS.map(([id, l]) => <option key={id} value={id}>{l}</option>)}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="lbl" htmlFor="ex">Motif d’exclusion</label>
                  <select id="ex" className="field" value={exclusion} onChange={(e) => setExclusion(e.target.value)}>
                    <option value="stop">« Stop », désinscrits, refus</option>
                    <option value="client">Clients et prospects Ariane</option>
                  </select>
                </div>
              )}
              <div>
                <label className="lbl" htmlFor="src">Source</label>
                <input id="src" className="field" value={source} onChange={(e) => setSource(e.target.value)} />
              </div>
            </div>
            <div className="scroll">
              <table className="tbl">
                <thead><tr>{found.map((k) => <th key={k}>{FIELDS[k]}</th>)}</tr></thead>
                <tbody>
                  {rows.slice(1, 6).map((r, i) => (
                    <tr key={i}>{found.map((k) => <td key={k} className="sm">{r[map[k]]}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div><button className="btn pri" type="button" disabled={!canSend} onClick={send}>{busy ? "Import en cours…" : `Importer ${rows.length - 1} lignes`}</button></div>
          </>
        ) : null}
        {result ? (
          <div className="ok">
            {result.progress} / {result.of} lignes traitées : {result.created} nouveaux contacts, {result.completed} complétés,{" "}
            {result.skipped} ignorés (ni email ni LinkedIn){mode === "exclusion" ? `, ${result.excluded} exclus` : ""}.
          </div>
        ) : null}
        {error ? <div className="err">{error}</div> : null}
      </div>
    </>
  );
}
