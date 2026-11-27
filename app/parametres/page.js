import { redisConfigured } from "@/lib/redis";
import { unipile, unipileConfigured } from "@/lib/unipile";
import { redis } from "@/lib/redis";
import EngineRun from "@/components/EngineRun";

export const dynamic = "force-dynamic";

const Row = ({ label, ok, detail }) => (
  <tr>
    <td><b>{label}</b></td>
    <td><span className={`pill ${ok ? "p-on" : "p-risk"}`}>{ok ? "Connecté" : "À configurer"}</span></td>
    <td className="sm muted">{detail}</td>
  </tr>
);

export default async function Parametres(props) {
  const searchParams = await props.searchParams;
  let accounts = [], unipileError = "";
  if (unipileConfigured) {
    try {
      const r = await unipile("/accounts");
      accounts = r.data || r.items || [];
    } catch (e) {
      unipileError = e.message;
    }
  }
  const mode = redisConfigured ? (await redis.get("cfg:engine")) || "simulation" : "simulation";
  const last = redisConfigured ? await redis.get("engine:last") : null;
  const webhookId = redisConfigured ? await redis.get("cfg:webhookId") : null;
  const wh = searchParams?.webhook;
  const MODES = [["off", "Arrêté", "Rien n’est envoyé ni synchronisé."], ["simulation", "Simulation", "Le moteur calcule ce qu’il enverrait, sans rien envoyer."], ["on", "En marche", "Envois réels chaque jour ouvré à 8 h 35."]];
  return (
    <>
      <div className="top">
        <div><p className="eye">Paramètres</p><h1>Connexions et limites</h1><p className="lead">Les clés se saisissent dans Vercel (Settings, Environment Variables), jamais dans l’application.</p></div>
      </div>
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <h2>Moteur d’envoi</h2>
        <form action="/api/engine/mode" method="post" style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {MODES.map(([v, l, d]) => (
            <button key={v} name="mode" value={v} type="submit" className={`btn ${mode === v ? "pri" : ""}`} title={d}>{l}</button>
          ))}
        </form>
        <p className="note" style={{ margin: 0 }}>Mode actuel : <b style={{ color: "#1E293B" }}>{MODES.find((m) => m[0] === mode)?.[1]}</b>. {MODES.find((m) => m[0] === mode)?.[2]}</p>
        <EngineRun />
        {last ? (
          <div>
            <p className="lbl">Dernière exécution : {new Date(last.at).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} ({last.trigger}, mode {last.mode})</p>
            <pre style={{ background: "#F1F5F9", borderRadius: 12, padding: 14, fontSize: 13, whiteSpace: "pre-wrap", margin: 0, maxHeight: 320, overflow: "auto" }}>{(last.log || []).join("\n") || "Rien à faire."}</pre>
          </div>
        ) : null}
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Connexions</h2>
        <table className="tbl"><tbody>
          <Row label="Base de données Upstash" ok={redisConfigured} detail={redisConfigured ? "Contacts, campagnes et événements" : "Ajouter Upstash Redis dans Vercel, onglet Storage"} />
          <Row label="Tâche quotidienne (Vercel Cron)" ok={Boolean(process.env.CRON_SECRET)} detail={process.env.CRON_SECRET ? "Chaque jour ouvré à 8 h 35 (heure de Paris en hiver)" : "Variable CRON_SECRET manquante"} />
          <Row label="API Unipile" ok={unipileConfigured && !unipileError} detail={unipileError || (unipileConfigured ? `${accounts.length} compte(s) visibles` : "Variable UNIPILE_API_KEY manquante")} />
          <Row label="Suivi des ouvertures de mails" ok={Boolean(webhookId)} detail={webhookId ? "Unipile signale chaque ouverture ; les robots sont écartés du taux d’accroche" : "Pas encore activé"} />
        </tbody></table>
        {!webhookId ? (
          <form action="/api/webhooks/setup" method="post" style={{ marginTop: 14 }}>
            <button className="btn pri" type="submit">Activer le suivi des ouvertures</button>
            <p className="note" style={{ marginTop: 8 }}>Déclare chez Unipile l’adresse qui reçoit les ouvertures de vos mails. À faire une seule fois.</p>
          </form>
        ) : null}
        {wh && wh !== "ok" && wh !== "deja" ? <p className="note" style={{ color: "#B91C1C" }}>Activation impossible : {wh}</p> : null}
      </div>
      {accounts.length ? (
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Comptes Unipile</h2>
          <table className="tbl">
            <thead><tr><th>Compte</th><th>Type</th><th>Identifiant</th><th>Statut</th></tr></thead>
            <tbody>{accounts.map((a) => (
              <tr key={a.id}><td><b>{a.name}</b></td><td>{a.provider || a.type}</td><td className="sm muted">{a.id}</td><td><span className={`pill ${a.status === "running" || a.status === "OK" ? "p-on" : "p-pause"}`}>{a.status}</span></td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Garde-fous par défaut</h2>
        <table className="tbl"><tbody>
          <tr><td>Invitations LinkedIn</td><td><b>20 par jour, 100 par semaine</b></td></tr>
          <tr><td>Mails depuis arianebusiness.fr</td><td><b>15 par jour au départ, +5 par semaine</b></td></tr>
          <tr><td>Pause automatique</td><td><b>Taux de refus mail au-dessus de 5 %</b></td></tr>
          <tr><td>Invitations sans réponse</td><td><b>Retirées après 21 jours</b></td></tr>
          <tr><td>Plage d’envoi</td><td><b>Jours ouvrés, 8 h 30 à 18 h</b></td></tr>
        </tbody></table>
      </div>
    </>
  );
}
