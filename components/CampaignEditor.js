"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const PROFS = [["avocat", "Avocats"], ["expert-comptable", "Experts-comptables"], ["notaire", "Notaires"], ["cgp", "CGP"], ["banquier-prive", "Banquiers privés"], ["autre", "Autres"]];
const TYPES = [["li_invite", "Invitation LinkedIn"], ["li_message", "Message LinkedIn (après acceptation)"], ["email", "Mail"]];
const VARS = ["{Salutation}", "{Prénom}", "{Nom}", "{Cabinet}", "{Ville}", "{LienVideo}", "{LienArticle}"];
const SIG = "\n\nBien à vous,\nNicolas de Poix\nFondateur d'Ariane\nAriane · 37, rue de Buzenval, 92210 Saint-Cloud";

const DEFAULT_STEPS = [
  { type: "li_invite", delay: 0, subject: "", text: "" },
  { type: "li_message", delay: 1, subject: "", text: "Bonjour {Salutation},\nMerci d'avoir accepté ma demande de mise en relation.\nJ'accompagne les cabinets dans le développement de leur clientèle avec Ariane, une plateforme d'intelligence relationnelle : elle centralise vos contacts et vous signale le bon moment pour reprendre contact avec chacun.\nSi le sujet vous intéresse, je vous montre en 20 minutes comment cela fonctionne.\nNicolas" },
  { type: "email", delay: 3, subject: "Prendre 20 minutes pour gagner du temps et des clients ?", text: "Bonjour {Salutation},\n\nUne question simple : comme beaucoup de vos confrères, manquez-vous de temps pour développer le cabinet, sans avoir envie de jouer les commerciaux ?\n\nAriane centralise automatiquement vos contacts et vous signale le bon moment pour reprendre contact avec chacun d'eux.\n\nSi cela vous parle, répondez « oui » : 20 minutes suffisent pour vous montrer comment." + SIG + "\n\nP.-S. : si le sujet ne vous concerne pas, répondez « stop » et je ne vous écrirai plus." },
  { type: "email", delay: 3, subject: "", text: "Bonjour {Salutation},\n\nJe me permets de remonter mon message. Pour vous faire une idée en 2 minutes : {LienVideo}" + SIG },
  { type: "email", delay: 4, subject: "", text: "{Salutation},\n\nDernier message de ma part. Pourquoi 70 % du réseau d'un cabinet reste inexploité : {LienArticle}\n\nSi le sujet vous intéresse un jour, ma porte reste ouverte." + SIG },
];

const tomorrow = () => new Date(Date.now() + 864e5).toISOString().slice(0, 10);

export default function CampaignEditor({ initial }) {
  const router = useRouter();
  const [c, setC] = useState(initial || {
    name: "", audience: { profession: "avocat", villes: "", motsCles: "", excludeContactedDays: 90, max: 300 },
    steps: DEFAULT_STEPS, limits: { liPerDay: 20, liPerWeek: 100, mailPerDay: 15, mailRampPerWeek: 5, mailMax: 50, withdrawAfterDays: 21, bouncePause: 5, newPerDay: 20 },
    startDate: tomorrow(),
  });
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
  const setStep = (i, k, v) => setC((prev) => ({ ...prev, steps: prev.steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)) }));

  async function refresh() {
    setBusy("preview");
    try {
      const r = await fetch("/api/audience/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(c) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setPreview(j);
    } catch (e) { setMsg({ err: e.message }); } finally { setBusy(""); }
  }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [c.audience.profession]);

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

  return (
    <>
      <div className="top">
        <div>
          <p className="eye">{c.id ? "Modifier la campagne" : "Nouvelle campagne"}</p>
          <h1>{c.name || "Nouvelle campagne"}</h1>
          <p className="lead">Vous la validez une fois : le moteur envoie ensuite chaque jour ouvré, dans les limites fixées.</p>
        </div>
        <div className="btns"><button className="btn" type="button" onClick={save} disabled={!!busy}>{busy === "save" ? "Enregistrement…" : "Enregistrer le brouillon"}</button></div>
      </div>
      {msg?.err ? <div className="err">{msg.err}</div> : null}
      {msg?.ok ? <div className="ok">{msg.ok}</div> : null}

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2>1. Audience</h2>
        {locked ? <p className="note">La liste a été figée à la validation ({c.size} contacts). Les filtres ne s’appliquent plus.</p> : null}
        <div className="form-row">
          <div><label className="lbl" htmlFor="n">Nom de la campagne</label><input id="n" className="field" value={c.name} onChange={(e) => set("name", e.target.value)} placeholder="Ex. Avocats Île-de-France · décembre" /></div>
          <div><label className="lbl" htmlFor="p">Métier</label>
            <select id="p" className="field" value={c.audience.profession} disabled={locked} onChange={(e) => set("audience.profession", e.target.value)}>{PROFS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="lbl" htmlFor="m">Nombre maximum de contacts</label><input id="m" className="field" type="number" min="1" disabled={locked} value={c.audience.max} onChange={(e) => set("audience.max", Number(e.target.value))} /></div>
        </div>
        <div className="form-row">
          <div><label className="lbl" htmlFor="v">Villes (séparées par des virgules, vide = toutes)</label><input id="v" className="field" disabled={locked} value={c.audience.villes} onChange={(e) => set("audience.villes", e.target.value)} placeholder="Paris, Lyon, Bordeaux" /></div>
          <div><label className="lbl" htmlFor="k">Mots-clés du titre ou du cabinet</label><input id="k" className="field" disabled={locked} value={c.audience.motsCles} onChange={(e) => set("audience.motsCles", e.target.value)} placeholder="associé, fondateur" /></div>
          <div><label className="lbl" htmlFor="x">Exclure les contactés depuis moins de (jours)</label><input id="x" className="field" type="number" min="0" disabled={locked} value={c.audience.excludeContactedDays} onChange={(e) => set("audience.excludeContactedDays", Number(e.target.value))} /></div>
        </div>
        {!locked ? (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center", paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
            <button className="btn" type="button" onClick={refresh} disabled={!!busy}>{busy === "preview" ? "Calcul…" : "Recalculer l’audience"}</button>
            {preview ? (<>
              <div><div className="kl">Contacts correspondants</div><b style={{ fontSize: 22 }}>{preview.count}</b></div>
              <div><div className="kl">Retenus</div><b style={{ fontSize: 22 }}>{preview.retained}</b></div>
              <div><div className="kl">Avec email</div><b style={{ fontSize: 22 }}>{preview.withEmail}</b></div>
              <div><div className="kl">Avec LinkedIn</div><b style={{ fontSize: 22 }}>{preview.withLinkedin}</b></div>
              <div className="note" style={{ flex: "1 1 240px" }}>Écartés : {preview.reasons.exclus} exclus ou déjà en campagne, {preview.reasons.recemment} contactés récemment, {preview.reasons.canal} sans canal utilisable, {preview.reasons.filtres} hors filtres.</div>
            </>) : null}
          </div>
        ) : null}
      </div>

      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2>2 et 3. Séquence et textes</h2>
        <p className="note" style={{ margin: 0 }}>Dès qu’un contact répond, sur n’importe quel canal, il sort de la séquence. Une étape est sautée si le contact n’a pas le canal (pas d’email, pas de profil LinkedIn). Variables : {VARS.join(" ")}. {`{Salutation}`} donne « Maître Durand » pour les avocats et notaires, le prénom sinon.</p>
        {c.steps.map((s, i) => (
          <div key={i} style={{ border: "1px solid #E2E8F0", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="form-row" style={{ alignItems: "flex-end" }}>
              <div><label className="lbl">Étape {i + 1}</label>
                <select className="field" value={s.type} onChange={(e) => setStep(i, "type", e.target.value)}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
              <div><label className="lbl">{i === 0 ? "Jour de départ" : "Jours ouvrés après l’étape précédente"}</label><input className="field" type="number" min="0" value={s.delay} onChange={(e) => setStep(i, "delay", Number(e.target.value))} /></div>
              <div style={{ flex: "0 0 auto" }}><button className="btn" type="button" onClick={() => setC((p) => ({ ...p, steps: p.steps.filter((_, j) => j !== i) }))}>Supprimer</button></div>
            </div>
            {s.type === "email" ? <input className="field" value={s.subject} onChange={(e) => setStep(i, "subject", e.target.value)} placeholder="Objet (vide = réponse dans le fil du premier mail)" aria-label="Objet" /> : null}
            <textarea className="field" style={{ fontFamily: "inherit", fontSize: 14, minHeight: s.type === "li_invite" ? 70 : 150 }} value={s.text} onChange={(e) => setStep(i, "text", e.target.value)}
              placeholder={s.type === "li_invite" ? "Note d’invitation (facultative, 300 caractères maximum). Vide recommandé." : "Texte"} aria-label="Texte" />
            {preview?.previews?.[i]?.text ? (
              <details><summary className="note" style={{ cursor: "pointer" }}>Aperçu sur {preview.sample.name}</summary>
                <div style={{ background: "#F1F5F9", borderRadius: 12, padding: 14, whiteSpace: "pre-line", fontSize: 14, marginTop: 8 }}>{preview.previews[i].subject ? <b>{preview.previews[i].subject}{"\n\n"}</b> : null}{preview.previews[i].text}</div>
              </details>
            ) : null}
          </div>
        ))}
        <div className="btns">
          <button className="btn" type="button" onClick={() => setC((p) => ({ ...p, steps: [...p.steps, { type: "email", delay: 3, subject: "", text: "" }] }))}>Ajouter une étape</button>
          <button className="btn" type="button" onClick={refresh}>Actualiser les aperçus</button>
        </div>
      </div>

      <div className="cols">
        <div className="card" style={{ flex: "1 1 520px", display: "flex", flexDirection: "column", gap: 14 }}>
          <h2>4. Rythme et garde-fous</h2>
          <div className="form-row">
            <div><label className="lbl">Début</label><input className="field" type="date" value={c.startDate} onChange={(e) => set("startDate", e.target.value)} /></div>
            <div><label className="lbl">Nouveaux contacts par jour</label><input className="field" type="number" min="1" max="50" value={c.limits.newPerDay} onChange={(e) => set("limits.newPerDay", Number(e.target.value))} /></div>
          </div>
          <div className="form-row">
            <div><label className="lbl">Invitations LinkedIn / jour (tout le compte)</label><input className="field" type="number" min="0" max="25" value={c.limits.liPerDay} onChange={(e) => set("limits.liPerDay", Number(e.target.value))} /></div>
            <div><label className="lbl">Invitations / semaine</label><input className="field" type="number" min="0" max="100" value={c.limits.liPerWeek} onChange={(e) => set("limits.liPerWeek", Number(e.target.value))} /></div>
          </div>
          <div className="form-row">
            <div><label className="lbl">Mails / jour au départ</label><input className="field" type="number" min="0" value={c.limits.mailPerDay} onChange={(e) => set("limits.mailPerDay", Number(e.target.value))} /></div>
            <div><label className="lbl">+ par semaine</label><input className="field" type="number" min="0" value={c.limits.mailRampPerWeek} onChange={(e) => set("limits.mailRampPerWeek", Number(e.target.value))} /></div>
            <div><label className="lbl">Plafond mails / jour</label><input className="field" type="number" min="0" value={c.limits.mailMax} onChange={(e) => set("limits.mailMax", Number(e.target.value))} /></div>
          </div>
          <div className="form-row">
            <div><label className="lbl">Retirer les invitations sans réponse après (jours)</label><input className="field" type="number" min="7" value={c.limits.withdrawAfterDays} onChange={(e) => set("limits.withdrawAfterDays", Number(e.target.value))} /></div>
            <div><label className="lbl">Pause si refus mail au-dessus de (%)</label><input className="field" type="number" min="1" value={c.limits.bouncePause} onChange={(e) => set("limits.bouncePause", Number(e.target.value))} /></div>
          </div>
          <p className="note" style={{ margin: 0 }}>Envois les jours ouvrés uniquement, pause automatique du 24 décembre au 1er janvier.</p>
        </div>
        <div className="card" style={{ flex: "1 1 380px", border: "2px solid #3445B6", display: "flex", flexDirection: "column", gap: 12 }}>
          <h2>5. Validation</h2>
          <div className="note">Contacts : <b style={{ color: "#1E293B" }}>{locked ? c.size : preview?.retained ?? "…"}</b> · Étapes : <b style={{ color: "#1E293B" }}>{c.steps.length}</b> · Début : <b style={{ color: "#1E293B" }}>{c.startDate}</b></div>
          <div style={{ background: "#EEF1FD", borderRadius: 14, padding: 14, fontSize: 13.5 }}>À la validation, la liste, les textes et le rythme sont figés. Toute modification ultérieure repasse la campagne en « À valider » : le moteur la met en attente jusqu’à votre nouvelle validation.</div>
          <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 14 }}><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />J’ai relu la liste et les textes</label>
          <button className="btn pri" type="button" disabled={!checked || !!busy || !c.name} onClick={validate} style={{ justifyContent: "center" }}>{busy === "validate" ? "Validation…" : "Valider et lancer la campagne"}</button>
          {!c.name ? <p className="note" style={{ margin: 0 }}>Donnez un nom à la campagne pour pouvoir la valider.</p> : null}
        </div>
      </div>
    </>
  );
}
