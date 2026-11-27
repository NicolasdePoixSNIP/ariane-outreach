"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { parseCsv, mapColumns } from "@/lib/csv";

const PROFS = [["avocat", "Avocats"], ["expert-comptable", "Experts-comptables"], ["notaire", "Notaires"], ["cgp", "CGP"], ["banquier-prive", "Banquiers privés"], ["conseil-ma", "Conseil M&A"], ["autre", "Autres"]];
const TYPES = [
  ["linkedin", "LinkedIn", "Invitation, puis message une fois l’invitation acceptée."],
  ["email", "Mail", "Séquence de mails depuis nicolas@arianebusiness.fr, relances dans le même fil."],
  ["hybride", "Hybride", "LinkedIn d’abord, puis mails pour ceux qui ont une adresse et n’ont pas répondu."],
];
const STEP_LABEL = { li_invite: "Invitation LinkedIn", li_message: "Message LinkedIn · si l’invitation est acceptée", email: "Mail" };
const ALLOWED = { linkedin: ["li_invite", "li_message"], email: ["email"], hybride: ["li_invite", "li_message", "email"] };
const SOURCES = {
  email: [["base", "Depuis la base", "Filtrer les contacts déjà dans la tour de contrôle."], ["fichier", "Importer un fichier", "CSV : ajouté à la base, comparé aux contacts existants et aux exclusions."]],
  linkedin: [["base", "Depuis la base", "Contacts de la base qui ont un profil LinkedIn."], ["url", "URL de recherche LinkedIn", "Collez l’adresse d’une recherche de personnes faite sur LinkedIn."], ["recherche", "Rechercher ici", "Mots-clés, titre, entreprise, localisation, niveau de relation."]],
};
SOURCES.hybride = [SOURCES.email[0], SOURCES.email[1], SOURCES.linkedin[1], SOURCES.linkedin[2]];
const VARS = ["{Salutation}", "{Prénom}", "{Nom}", "{Cabinet}", "{Ville}", "{LienVideo}", "{LienArticle}"];
const SIG = "\n\nBien à vous,\nNicolas de Poix\nFondateur d'Ariane\nAriane · 37, rue de Buzenval, 92210 Saint-Cloud";
const FIELDS = { email: "Email", prenom: "Prénom", nom: "Nom", cabinet: "Cabinet", ville: "Ville", titre: "Titre", linkedin: "LinkedIn" };

const T = {
  invite: { type: "li_invite", delay: 0, subject: "", text: "" },
  liMsg: { type: "li_message", delay: 1, subject: "", text: "Bonjour {Salutation},\nMerci d'avoir accepté ma demande de mise en relation.\nJ'accompagne les cabinets dans le développement de leur clientèle avec Ariane, une plateforme d'intelligence relationnelle : elle centralise vos contacts et vous signale le bon moment pour reprendre contact avec chacun.\nSi le sujet vous intéresse, je vous montre en 20 minutes comment cela fonctionne.\nNicolas" },
  mail1: { type: "email", delay: 0, subject: "Prendre 20 minutes pour gagner du temps et des clients ?", text: "Bonjour {Salutation},\n\nUne question simple : comme beaucoup de vos confrères, manquez-vous de temps pour développer le cabinet, sans avoir envie de jouer les commerciaux ?\n\nAriane centralise automatiquement vos contacts et vous signale le bon moment pour reprendre contact avec chacun d'eux.\n\nSi cela vous parle, répondez « oui » : 20 minutes suffisent pour vous montrer comment." + SIG + "\n\nP.-S. : si le sujet ne vous concerne pas, répondez « stop » et je ne vous écrirai plus." },
  mail2: { type: "email", delay: 3, subject: "", text: "Bonjour {Salutation},\n\nJe me permets de remonter mon message. Pour vous faire une idée en 2 minutes : {LienVideo}" + SIG },
  mail3: { type: "email", delay: 4, subject: "", text: "{Salutation},\n\nDernier message de ma part. Pourquoi 70 % du réseau d'un cabinet reste inexploité : {LienArticle}\n\nSi le sujet vous intéresse un jour, ma porte reste ouverte." + SIG },
};
const DEFAULT_STEPS = {
  linkedin: [T.invite, T.liMsg],
  email: [T.mail1, T.mail2, T.mail3],
  hybride: [T.invite, T.liMsg, { ...T.mail1, delay: 3 }, T.mail2, T.mail3],
};
const inferType = (steps = []) => {
  const li = steps.some((s) => s.type !== "email"), em = steps.some((s) => s.type === "email");
  return li && em ? "hybride" : li ? "linkedin" : "email";
};
const nextBusinessDay = () => {
  const d = new Date(Date.now() + 864e5);
  while ([0, 6].includes(d.getDay())) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};
const WIZ = ["Caractéristiques", "Cible", "Séquence", "Rythme et lancement"];

export default function CampaignEditor({ initial }) {
  const router = useRouter();
  const [c, setC] = useState(() => {
    const base = {
      name: "", type: "", startDate: nextBusinessDay(),
      audience: { source: "base", lotId: "", profession: "avocat", villes: "", motsCles: "", excludeContactedDays: 90, max: 300 },
      qualify: { secondDegreeOnly: true, locations: "", titleExclude: "collaborateur, counsel, juriste, stagiaire", maxHeadcount: 0 },
      steps: [], limits: { liPerDay: 20, liPerWeek: 100, invitesPerDay: 10, mailPerDay: 15, mailRampPerWeek: 5, mailMax: 50, withdrawAfterDays: 21, bouncePause: 5, newPerDay: 20 },
    };
    if (!initial) return base;
    return { ...base, ...initial, type: initial.type || inferType(initial.steps), audience: { ...base.audience, ...initial.audience }, qualify: { ...base.qualify, ...(initial.qualify || {}) }, limits: { ...base.limits, ...initial.limits } };
  });
  const [step, setStepN] = useState(initial ? 1 : 0);
  const [liMode, setLiMode] = useState(initial?.audience?.source === "linkedin" ? "url" : "");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState(null);
  const [checked, setChecked] = useState(false);
  const locked = Boolean(c.validatedAt);

  const set = (path, value) => setC((prev) => {
    const next = structuredClone(prev);
    const keys = path.split(".");
    let o = next;
    keys.slice(0, -1).forEach((k) => (o = o[k]));
    o[keys.at(-1)] = value;
    return next;
  });
  const setSt = (i, k, v) => setC((p) => ({ ...p, steps: p.steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));

  function chooseType(t) {
    if (locked) return;
    setC((p) => {
      const keep = p.steps.length && p.steps.every((s) => ALLOWED[t].includes(s.type)) && inferType(p.steps) === t;
      const okSource = SOURCES[t].some(([v]) => v === (p.audience.source === "linkedin" ? liMode || "url" : p.audience.source));
      return { ...p, type: t, steps: keep ? p.steps : structuredClone(DEFAULT_STEPS[t]), audience: okSource ? p.audience : { ...p.audience, source: "base", lotId: "" } };
    });
  }
  const sourceKey = c.audience.source === "linkedin" ? liMode || "url" : c.audience.source;
  function chooseSource(v) {
    if (locked) return;
    const src = v === "url" || v === "recherche" ? "linkedin" : v;
    if (src === "linkedin") setLiMode(v);
    setC((p) => ({ ...p, audience: { ...p.audience, source: src, lotId: p.audience.source === src ? p.audience.lotId : "" } }));
    setPreview(null);
  }

  async function refresh(cc = c) {
    setBusy("preview");
    try {
      const r = await fetch("/api/audience/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cc) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setPreview(j);
    } catch (e) { setMsg({ err: e.message }); } finally { setBusy(""); }
  }
  useEffect(() => { if (step >= 1 && c.type) refresh(); /* eslint-disable-next-line */ }, [step, c.audience.profession, c.audience.source, c.audience.lotId, c.type]);

  async function save() {
    setBusy("save"); setMsg(null);
    try {
      const r = await fetch("/api/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setC((p) => ({ ...p, id: j.id, status: j.status }));
      setMsg({ ok: "Brouillon enregistré." });
      return j;
    } catch (e) { setMsg({ err: e.message }); } finally { setBusy(""); }
  }
  async function validate() {
    const saved = await save();
    if (!saved) return;
    setBusy("validate");
    try {
      const r = await fetch(`/api/campaigns/${saved.id}/validate`, { method: "POST" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      router.push(`/campagnes/${saved.id}`);
    } catch (e) { setMsg({ err: e.message }); setBusy(""); }
  }

  const canNext = [Boolean(c.name && c.type && c.startDate), Boolean(preview?.retained || locked), c.steps.length > 0, true];
  const hasLi = c.type !== "email", hasMail = c.type !== "linkedin";

  return (
    <>
      <div className="top">
        <div>
          <p className="eye">{c.id ? "Modifier la campagne" : "Nouvelle campagne"}</p>
          <h1>{c.name || "Nouvelle campagne"}</h1>
          <p className="lead">Vous la validez une fois : le moteur envoie ensuite chaque jour ouvré, dans les limites fixées.</p>
        </div>
        <div className="btns"><button className="btn" type="button" onClick={save} disabled={!!busy || !c.type}>{busy === "save" ? "Enregistrement…" : "Enregistrer le brouillon"}</button></div>
      </div>

      <div className="wiz">
        {WIZ.map((l, i) => (
          <button key={l} type="button" className={step === i ? "on" : i < step ? "done" : ""} onClick={() => (i <= step || canNext.slice(0, i).every(Boolean)) && setStepN(i)}>
            <b>{i < step ? "✓" : i + 1}</b>{l}
          </button>
        ))}
      </div>
      {msg?.err ? <div className="err">{msg.err}</div> : null}
      {msg?.ok ? <div className="ok">{msg.ok}</div> : null}

      {step === 0 ? (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <h2>Caractéristiques</h2>
          <div className="form-row">
            <div><label className="lbl" htmlFor="n">Nom de la campagne</label><input id="n" className="field" value={c.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex. Avocats Île-de-France · décembre" /></div>
            <div><label className="lbl" htmlFor="d">Date de lancement</label><input id="d" className="field" type="date" value={c.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
            <div><label className="lbl" htmlFor="p">Métier ciblé</label>
              <select id="p" className="field" value={c.audience.profession} disabled={locked} onChange={(e) => set("audience.profession", e.target.value)}>{PROFS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          </div>
          <div>
            <p className="lbl">Type de campagne</p>
            <div className="choices">
              {TYPES.map(([v, l, d]) => (
                <button key={v} type="button" className={`choice ${c.type === v ? "on" : ""}`} disabled={locked && c.type !== v} onClick={() => chooseType(v)}><b>{l}</b>{d}</button>
              ))}
            </div>
            {locked ? <p className="note">Le type ne change plus après validation.</p> : null}
          </div>
        </div>
      ) : null}

      {step === 1 ? (
        <Cible c={c} set={set} setC={setC} locked={locked} sourceKey={sourceKey} chooseSource={chooseSource} preview={preview} refresh={refresh} busy={busy} setBusy={setBusy} setMsg={setMsg} hasLi={hasLi} />
      ) : null}

      {step === 2 ? (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <h2>Séquence</h2>
          <p className="note" style={{ margin: 0 }}>Dès qu’un contact répond, sur n’importe quel canal, il sort de la séquence. {hasMail ? "Les mails sont sautés pour les contacts sans adresse. " : ""}Variables : {VARS.join(" ")}. {`{Salutation}`} donne « Maître Durand » pour les avocats et notaires, le prénom sinon.</p>
          {(() => {
            let day = 0;
            return c.steps.map((s, i) => {
              day += i === 0 ? 0 : Number(s.delay || 0);
              return (
                <div className="tlstep" key={i}>
                  <div className="rail"><span>{i === 0 ? "Départ" : `J+${day}`}</span>{i < c.steps.length - 1 ? <i /> : null}</div>
                  <div style={{ flex: 1, border: "1px solid #E2E8F0", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 10, marginBottom: 6 }}>
                    <div className="form-row" style={{ alignItems: "flex-end" }}>
                      <div><label className="lbl">Étape {i + 1}</label>
                        <select className="field" value={s.type} onChange={(e) => setSt(i, "type", e.target.value)}>{ALLOWED[c.type].map((v) => <option key={v} value={v}>{STEP_LABEL[v]}</option>)}</select></div>
                      {i > 0 ? <div><label className="lbl">Jours ouvrés après l’étape précédente</label><input className="field" type="number" min="0" value={s.delay} onChange={(e) => setSt(i, "delay", Number(e.target.value))} /></div> : <div />}
                      <div style={{ flex: "0 0 auto" }}><button className="btn" type="button" onClick={() => setC((p) => ({ ...p, steps: p.steps.filter((_, j) => j !== i) }))}>Supprimer</button></div>
                    </div>
                    {s.type === "email" ? <input className="field" value={s.subject} onChange={(e) => setSt(i, "subject", e.target.value)} placeholder={i === c.steps.findIndex((x) => x.type === "email") ? "Objet du premier mail" : "Objet (vide = relance dans le fil du premier mail)"} aria-label="Objet" /> : null}
                    <textarea className="field" style={{ fontFamily: "inherit", fontSize: 14, minHeight: s.type === "li_invite" ? 70 : 150 }} value={s.text} onChange={(e) => setSt(i, "text", e.target.value)}
                      placeholder={s.type === "li_invite" ? "Note d’invitation (facultative, 300 caractères maximum). Vide recommandé." : "Texte"} aria-label="Texte" />
                    {s.type === "li_invite" && s.text.length > 300 ? <p className="note" style={{ color: "#B91C1C", margin: 0 }}>{s.text.length} caractères : LinkedIn limite la note à 300.</p> : null}
                    {preview?.previews?.[i]?.text ? (
                      <details><summary className="note" style={{ cursor: "pointer" }}>Aperçu sur {preview.sample.name}</summary>
                        <div style={{ background: "#F1F5F9", borderRadius: 12, padding: 14, whiteSpace: "pre-line", fontSize: 14, marginTop: 8 }}>{preview.previews[i].subject ? <b>{preview.previews[i].subject}{"\n\n"}</b> : null}{preview.previews[i].text}</div>
                      </details>
                    ) : null}
                  </div>
                </div>
              );
            });
          })()}
          <div className="btns">
            {ALLOWED[c.type].map((t) => (
              <button key={t} className="btn" type="button" onClick={() => setC((p) => ({ ...p, steps: [...p.steps, { type: t, delay: t === "li_message" ? 1 : 3, subject: "", text: "" }] }))}>+ {STEP_LABEL[t].split(" · ")[0]}</button>
            ))}
            <button className="btn" type="button" onClick={() => refresh()}>Actualiser les aperçus</button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="cols">
          <div className="card" style={{ flex: "1 1 520px", display: "flex", flexDirection: "column", gap: 14 }}>
            <h2>Rythme et garde-fous</h2>
            <div className="form-row">
              <div><label className="lbl">Nouveaux contacts par jour</label><input className="field" type="number" min="1" max="50" value={c.limits.newPerDay} onChange={(e) => set("limits.newPerDay", Number(e.target.value))} /></div>
              {hasLi ? <div><label className="lbl">Invitations par jour pour cette campagne</label><input className="field" type="number" min="1" max="25" value={c.limits.invitesPerDay} onChange={(e) => set("limits.invitesPerDay", Number(e.target.value))} /></div> : null}
            </div>
            {hasLi ? (
              <div className="form-row">
                <div><label className="lbl">Invitations / jour (tout le compte)</label><input className="field" type="number" min="0" max="25" value={c.limits.liPerDay} onChange={(e) => set("limits.liPerDay", Number(e.target.value))} /></div>
                <div><label className="lbl">Invitations / semaine (tout le compte)</label><input className="field" type="number" min="0" max="100" value={c.limits.liPerWeek} onChange={(e) => set("limits.liPerWeek", Number(e.target.value))} /></div>
                <div><label className="lbl">Retirer les invitations sans réponse après (jours)</label><input className="field" type="number" min="7" value={c.limits.withdrawAfterDays} onChange={(e) => set("limits.withdrawAfterDays", Number(e.target.value))} /></div>
              </div>
            ) : null}
            {hasMail ? (
              <div className="form-row">
                <div><label className="lbl">Mails / jour au départ</label><input className="field" type="number" min="0" value={c.limits.mailPerDay} onChange={(e) => set("limits.mailPerDay", Number(e.target.value))} /></div>
                <div><label className="lbl">+ par semaine</label><input className="field" type="number" min="0" value={c.limits.mailRampPerWeek} onChange={(e) => set("limits.mailRampPerWeek", Number(e.target.value))} /></div>
                <div><label className="lbl">Plafond mails / jour</label><input className="field" type="number" min="0" value={c.limits.mailMax} onChange={(e) => set("limits.mailMax", Number(e.target.value))} /></div>
                <div><label className="lbl">Pause si refus au-dessus de (%)</label><input className="field" type="number" min="1" value={c.limits.bouncePause} onChange={(e) => set("limits.bouncePause", Number(e.target.value))} /></div>
              </div>
            ) : null}
            <p className="note" style={{ margin: 0 }}>Envois les jours ouvrés uniquement, à partir de 8 h 35. Pause automatique du 24 décembre au 1er janvier.</p>
          </div>
          <div className="card" style={{ flex: "1 1 380px", border: "2px solid #3445B6", display: "flex", flexDirection: "column", gap: 12 }}>
            <h2>Validation</h2>
            <table className="tbl"><tbody>
              <tr><td>Type</td><td><b>{TYPES.find((t) => t[0] === c.type)?.[1]}</b></td></tr>
              <tr><td>Lancement</td><td><b>{c.startDate ? new Date(`${c.startDate}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) : "—"}</b></td></tr>
              <tr><td>Cible</td><td><b>{locked ? c.size : preview?.retained ?? "…"}</b> contacts · {SOURCES[c.type].find(([v]) => v === sourceKey)?.[1]}</td></tr>
              {hasLi && c.qualify ? <tr><td>Qualification</td><td className="sm">{[c.qualify.secondDegreeOnly && "2e niveau", c.qualify.locations && `zone : ${c.qualify.locations}`, c.qualify.titleExclude && `sans : ${c.qualify.titleExclude}`, c.qualify.maxHeadcount ? `≤ ${c.qualify.maxHeadcount} pers.` : ""].filter(Boolean).join(" · ") || "aucune"}</td></tr> : null}
              <tr><td>Séquence</td><td><b>{c.steps.length}</b> étapes</td></tr>
            </tbody></table>
            <div style={{ background: "#EEF1FD", borderRadius: 14, padding: 14, fontSize: 13.5 }}>À la validation, la liste, les textes et le rythme sont figés. Toute modification ultérieure repasse la campagne en « À valider ».</div>
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />J’ai relu la liste et les textes</label>
            <button className="btn pri" type="button" disabled={!checked || !!busy || !c.name || !c.steps.length} onClick={validate} style={{ justifyContent: "center" }}>{busy === "validate" ? "Validation…" : "Valider et lancer la campagne"}</button>
          </div>
        </div>
      ) : null}

      <div className="btns" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <button className="btn" type="button" disabled={step === 0} onClick={() => setStepN(step - 1)}>← Précédent</button>
        {step < 3 ? <button className="btn pri" type="button" disabled={!canNext[step]} onClick={() => setStepN(step + 1)}>Suivant →</button> : <span />}
      </div>
      {!canNext[step] && step < 3 ? <p className="note" style={{ textAlign: "right" }}>{["Indiquez un nom, une date et un type de campagne.", "Constituez une cible d’au moins un contact.", "Ajoutez au moins une étape."][step]}</p> : null}
    </>
  );
}

// ---------- étape « Cible » ----------

function Cible({ c, set, setC, locked, sourceKey, chooseSource, preview, refresh, busy, setBusy, setMsg, hasLi }) {
  const [bilan, setBilan] = useState(null);
  const [file, setFile] = useState(null); // { name, rows, map }
  const [url, setUrl] = useState("");
  const [crit, setCrit] = useState({ keywords: "", title: "", company: "", locations: [], degrees: [2] });
  const [locQ, setLocQ] = useState("");
  const [locRes, setLocRes] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [pages, setPages] = useState(5);
  const lotId = c.audience.lotId;

  useEffect(() => {
    if (locQ.trim().length < 2) { setLocRes([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/linkedin/locations?q=${encodeURIComponent(locQ)}`);
      const j = await r.json().catch(() => ({ data: [] }));
      setLocRes(j.data || []);
    }, 400);
    return () => clearTimeout(t);
  }, [locQ]);

  const attach = (j) => {
    setBilan(j);
    setC((p) => ({ ...p, audience: { ...p.audience, lotId: j.lotId } }));
  };

  async function onFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const all = parseCsv((await f.text()).replace(/^﻿/, ""));
    setFile({ name: f.name, rows: all, map: mapColumns(all[0] || []) });
  }
  async function importFile() {
    setBusy("lot"); setMsg(null);
    try {
      const data = file.rows.slice(1).map((r) => Object.fromEntries(Object.entries(file.map).map(([k, i]) => [k, r[i] ?? ""])));
      let id = lotId, last = null;
      const acc = { nouveaux: 0, dejaEnBase: 0, ignores: 0, stop: 0, clients: 0, enCampagne: 0 };
      for (let i = 0; i < data.length; i += 500) {
        const r = await fetch("/api/lots/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lotId: id, rows: data.slice(i, i + 500), profession: c.audience.profession, source: file.name.replace(/\.[^.]+$/, "").slice(0, 60) }) });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        id = j.lotId; last = j;
        for (const k in acc) acc[k] += j[k] || 0;
      }
      attach({ ...last, ...acc });
    } catch (e) { setMsg({ err: e.message }); } finally { setBusy(""); }
  }
  async function searchLi(more = false) {
    setBusy("lot"); setMsg(null);
    try {
      const body = sourceKey === "url"
        ? { mode: "url", url }
        : { mode: "recherche", criteria: { keywords: crit.keywords, title: crit.title, company: crit.company, location: crit.locations.map((l) => l.id), network_distance: crit.degrees } };
      const r = await fetch("/api/lots/linkedin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, lotId, cursor: more ? cursor : undefined, pages, profession: c.audience.profession }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setCursor(j.nextCursor || null);
      attach(j);
    } catch (e) { setMsg({ err: e.message }); } finally { setBusy(""); }
  }

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <h2>Cible</h2>
      {locked ? <p className="note">La liste a été figée à la validation ({c.size} contacts).</p> : null}
      <div className="choices">
        {SOURCES[c.type].map(([v, l, d]) => (
          <button key={v} type="button" className={`choice ${sourceKey === v ? "on" : ""}`} disabled={locked} onClick={() => chooseSource(v)}><b>{l}</b>{d}</button>
        ))}
      </div>

      {sourceKey === "base" ? (
        <div className="form-row">
          <div><label className="lbl" htmlFor="v">Villes (vide = toutes)</label><input id="v" className="field" disabled={locked} value={c.audience.villes} onChange={(e) => set("audience.villes", e.target.value)} placeholder="Paris, Lyon, Bordeaux" /></div>
          <div><label className="lbl" htmlFor="k">Mots-clés du titre ou du cabinet</label><input id="k" className="field" disabled={locked} value={c.audience.motsCles} onChange={(e) => set("audience.motsCles", e.target.value)} placeholder="associé, fondateur" /></div>
          <div><label className="lbl" htmlFor="x">Exclure les contactés depuis moins de (jours)</label><input id="x" className="field" type="number" min="0" disabled={locked} value={c.audience.excludeContactedDays} onChange={(e) => set("audience.excludeContactedDays", Number(e.target.value))} /></div>
        </div>
      ) : null}

      {sourceKey === "fichier" && !locked ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="file" accept=".csv,text/csv" onChange={onFile} className="field" />
          {file ? (
            <>
              <p className="note" style={{ margin: 0 }}>{file.name} · {file.rows.length - 1} lignes · colonnes reconnues : {Object.keys(file.map).map((k) => FIELDS[k] || k).join(", ") || "aucune"}.{file.map.email === undefined ? " Pas de colonne email : ce fichier ne servira pas aux mails." : ""}</p>
              <div><button className="btn pri" type="button" disabled={!!busy || (file.map.email === undefined && file.map.linkedin === undefined)} onClick={importFile}>{busy === "lot" ? "Import et comparaison…" : "Importer et comparer à la base"}</button></div>
            </>
          ) : <p className="note" style={{ margin: 0 }}>Fichier CSV (séparateur ; ou ,). Les contacts sont ajoutés à la base sans doublon (même email ou même profil LinkedIn), puis comparés aux exclusions.</p>}
        </div>
      ) : null}

      {sourceKey === "url" && !locked ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label className="lbl" htmlFor="u">URL d’une recherche de personnes LinkedIn</label>
          <input id="u" className="field" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/search/results/people/?keywords=avocat%20associ%C3%A9&geoUrn=…" />
          <p className="note" style={{ margin: 0 }}>Faites la recherche sur LinkedIn avec ses filtres (lieu, relations de 2e niveau, entreprise…), puis copiez l’adresse de la page.</p>
        </div>
      ) : null}

      {sourceKey === "recherche" && !locked ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div className="form-row">
            <div><label className="lbl">Mots-clés</label><input className="field" value={crit.keywords} onChange={(e) => setCrit({ ...crit, keywords: e.target.value })} placeholder="avocat associé droit des affaires" /></div>
            <div><label className="lbl">Titre du poste</label><input className="field" value={crit.title} onChange={(e) => setCrit({ ...crit, title: e.target.value })} placeholder="associé OR fondateur" /></div>
            <div><label className="lbl">Entreprise</label><input className="field" value={crit.company} onChange={(e) => setCrit({ ...crit, company: e.target.value })} placeholder="(facultatif)" /></div>
          </div>
          <div className="form-row">
            <div style={{ position: "relative" }}>
              <label className="lbl">Localisation</label>
              <input className="field" value={locQ} onChange={(e) => setLocQ(e.target.value)} placeholder="Tapez une ville ou une région" />
              {locRes.length ? (
                <div style={{ position: "absolute", zIndex: 5, background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 12, marginTop: 4, width: "100%", boxShadow: "0 8px 22px rgba(0,0,0,.08)" }}>
                  {locRes.map((l) => <div key={l.id} style={{ padding: "8px 14px", cursor: "pointer" }} onClick={() => { setCrit({ ...crit, locations: [...crit.locations.filter((x) => x.id !== l.id), l] }); setLocQ(""); setLocRes([]); }}>{l.name}</div>)}
                </div>
              ) : null}
              <div className="chips" style={{ marginTop: 8 }}>{crit.locations.map((l) => <span key={l.id} className="pill p-val" style={{ cursor: "pointer" }} onClick={() => setCrit({ ...crit, locations: crit.locations.filter((x) => x.id !== l.id) })}>{l.name} ×</span>)}</div>
            </div>
            <div>
              <label className="lbl">Niveau de relation</label>
              <div className="chips">{[[2, "2e niveau"], [3, "3e et +"]].map(([v, l]) => (
                <label key={v} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 14, marginRight: 12 }}><input type="checkbox" checked={crit.degrees.includes(v)} onChange={(e) => setCrit({ ...crit, degrees: e.target.checked ? [...crit.degrees, v] : crit.degrees.filter((x) => x !== v) })} />{l}</label>
              ))}</div>
            </div>
          </div>
        </div>
      ) : null}

      {(sourceKey === "url" || sourceKey === "recherche") && !locked ? (
        <div className="btns" style={{ alignItems: "center" }}>
          <select className="field" style={{ width: "auto" }} value={pages} onChange={(e) => setPages(Number(e.target.value))}>
            <option value={3}>3 pages (≈ 30 profils)</option><option value={5}>5 pages (≈ 50 profils)</option><option value={10}>10 pages (≈ 100 profils)</option>
          </select>
          <button className="btn pri" type="button" disabled={!!busy || (sourceKey === "url" ? !url : !(crit.keywords || crit.title || crit.company || crit.locations.length))} onClick={() => searchLi(false)}>{busy === "lot" ? "Recherche en cours…" : lotId ? "Relancer et ajouter" : "Lancer la recherche"}</button>
          {cursor ? <button className="btn" type="button" disabled={!!busy} onClick={() => searchLi(true)}>Charger la suite</button> : null}
          <span className="note">Chaque page compte dans le quota quotidien de recherches LinkedIn (environ 100 par jour).</span>
        </div>
      ) : null}

      {bilan ? (
        <div className="bilan">
          {"trouves" in bilan ? <div><b>{bilan.trouves}</b><span>profils trouvés{bilan.totalLinkedin ? ` sur ${bilan.totalLinkedin}` : ""}</span></div> : null}
          <div><b>{bilan.nouveaux}</b><span>nouveaux dans la base</span></div>
          <div><b>{bilan.dejaEnBase}</b><span>déjà en base (complétés)</span></div>
          <div><b>{bilan.stop + bilan.clients}</b><span>exclus (stop, clients)</span></div>
          <div><b>{bilan.enCampagne}</b><span>déjà dans une campagne</span></div>
          {bilan.ignores ? <div><b>{bilan.ignores}</b><span>lignes sans email ni LinkedIn</span></div> : null}
          <div><b>{bilan.total}</b><span>dans la liste de la campagne</span></div>
        </div>
      ) : null}

      {hasLi ? (
        <div style={{ borderTop: "1px solid #E2E8F0", paddingTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <p className="lbl" style={{ margin: 0 }}>Qualification avant invitation</p>
          <div className="form-row">
            <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" disabled={locked} checked={Boolean(c.qualify?.secondDegreeOnly)} onChange={(e) => set("qualify.secondDegreeOnly", e.target.checked)} />Relations de 2e niveau uniquement</label>
            <div><label className="lbl">Zone (vide = partout)</label><input className="field" disabled={locked} value={c.qualify?.locations || ""} onChange={(e) => set("qualify.locations", e.target.value)} placeholder="Paris, Île-de-France, Hauts-de-Seine" /></div>
          </div>
          <div className="form-row">
            <div><label className="lbl">Écarter les titres contenant</label><input className="field" disabled={locked} value={c.qualify?.titleExclude || ""} onChange={(e) => set("qualify.titleExclude", e.target.value)} /></div>
            <div><label className="lbl">Effectif maximal du cabinet, en nombre de personnes (0 = sans limite)</label><input className="field" type="number" min="0" disabled={locked} value={c.qualify?.maxHeadcount || 0} onChange={(e) => set("qualify.maxHeadcount", Number(e.target.value))} /></div>
          </div>
          <p className="note" style={{ margin: 0 }}>Vérifié par le moteur au moment d’inviter : les personnes déjà en relation sont toujours écartées. L’effectif est celui affiché sur la page LinkedIn du cabinet (salariés déclarés sur LinkedIn, associés compris), pas le chiffre d’affaires. Le vérifier demande une lecture de profil par contact (quota d’environ 100 par jour).</p>
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
        <div><label className="lbl" htmlFor="m">Nombre maximum de contacts</label><input id="m" className="field" style={{ width: 120 }} type="number" min="1" disabled={locked} value={c.audience.max} onChange={(e) => set("audience.max", Number(e.target.value))} /></div>
        <button className="btn" type="button" onClick={() => refresh()} disabled={!!busy}>{busy === "preview" ? "Calcul…" : "Recalculer la cible"}</button>
        {preview ? (<>
          <div><div className="kl">Retenus</div><b style={{ fontSize: 22 }}>{preview.retained}</b></div>
          <div><div className="kl">Avec email</div><b style={{ fontSize: 22 }}>{preview.withEmail}</b></div>
          <div><div className="kl">Avec LinkedIn</div><b style={{ fontSize: 22 }}>{preview.withLinkedin}</b></div>
          <div className="note" style={{ flex: "1 1 240px" }}>Écartés : {preview.reasons.exclus} exclus ou déjà en campagne, {preview.reasons.recemment} contactés récemment, {preview.reasons.canal} sans canal utilisable, {preview.reasons.filtres} hors filtres{preview.reasons.retires ? `, ${preview.reasons.retires} retirés à la main` : ""}.</div>
        </>) : null}
      </div>

      {preview?.list?.length ? <Liste preview={preview} c={c} setC={setC} locked={locked} refresh={refresh} /> : null}
    </div>
  );
}

const NIV = { FIRST_DEGREE: "1er", SECOND_DEGREE: "2e", THIRD_DEGREE: "3e", OUT_OF_NETWORK: "hors réseau" };

function Liste({ preview, c, setC, locked, refresh }) {
  const [q, setQ] = useState("");
  const [n, setN] = useState(50);
  const rows = preview.list.filter((x) => !q || `${x.nom} ${x.titre} ${x.cabinet} ${x.ville}`.toLowerCase().includes(q.toLowerCase()));
  const removed = c.audience.removed || [];
  function remove(id) {
    const next = { ...c, audience: { ...c.audience, removed: [...new Set([...removed, id])] } };
    setC(next);
    refresh(next);
  }
  function restoreAll() {
    const next = { ...c, audience: { ...c.audience, removed: [] } };
    setC(next);
    refresh(next);
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Personnes retenues ({preview.retained})</h3>
        <input className="field" style={{ maxWidth: 280 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer par nom, titre, cabinet, ville" />
        {removed.length && !locked ? <button className="btn" type="button" onClick={restoreAll}>Remettre les {removed.length} retirés</button> : null}
      </div>
      <div className="scroll" style={{ maxHeight: 460, overflow: "auto" }}>
        <table className="tbl">
          <thead><tr><th>Nom</th><th>Titre</th><th>Cabinet</th><th>Ville</th><th>Canaux</th>{c.type !== "email" ? <th>Niveau</th> : null}{!locked ? <th /> : null}</tr></thead>
          <tbody>
            {rows.slice(0, n).map((x) => (
              <tr key={x.id}>
                <td><b>{x.linkedin ? <a href={x.linkedin} target="_blank" rel="noreferrer" style={{ color: "#1E293B" }}>{x.nom || "—"}</a> : x.nom || "—"}</b></td>
                <td className="sm">{x.titre.slice(0, 80)}</td>
                <td className="sm">{x.cabinet}</td>
                <td className="sm">{x.ville}</td>
                <td className="sm">{[x.email && "mail", x.linkedin && "LinkedIn"].filter(Boolean).join(" + ")}</td>
                {c.type !== "email" ? <td className="sm">{NIV[x.niveau] || "—"}</td> : null}
                {!locked ? <td><button className="btn" type="button" style={{ minHeight: 32, padding: "0 12px", fontSize: 13 }} onClick={() => remove(x.id)}>Retirer</button></td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > n ? <div><button className="btn" type="button" onClick={() => setN(n + 100)}>Afficher 100 de plus ({rows.length - n} restants)</button></div> : null}
      <p className="note" style={{ margin: 0 }}>Liste avant qualification : au moment d’inviter, le moteur écarte encore ceux qui ne passent pas les règles ci-dessus. « Retirer » sort la personne de cette campagne seulement, elle reste dans la base.</p>
    </div>
  );
}
