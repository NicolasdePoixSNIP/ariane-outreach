import { redisConfigured } from "@/lib/redis";
import { unipile, unipileConfigured } from "@/lib/unipile";

export const dynamic = "force-dynamic";

const Row = ({ label, ok, detail }) => (
  <tr>
    <td><b>{label}</b></td>
    <td><span className={`pill ${ok ? "p-on" : "p-risk"}`}>{ok ? "Connecté" : "À configurer"}</span></td>
    <td className="sm muted">{detail}</td>
  </tr>
);

export default async function Parametres() {
  let accounts = [], unipileError = "";
  if (unipileConfigured) {
    try {
      const r = await unipile("/accounts");
      accounts = r.data || r.items || [];
    } catch (e) {
      unipileError = e.message;
    }
  }
  return (
    <>
      <div className="top">
        <div><p className="eye">Paramètres</p><h1>Connexions et limites</h1><p className="lead">Les clés se saisissent dans Vercel (Settings, Environment Variables), jamais dans l’application.</p></div>
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Connexions</h2>
        <table className="tbl"><tbody>
          <Row label="Base de données Upstash" ok={redisConfigured} detail={redisConfigured ? "Contacts, campagnes et événements" : "Ajouter Upstash Redis dans Vercel, onglet Storage"} />
          <Row label="API Unipile" ok={unipileConfigured && !unipileError} detail={unipileError || (unipileConfigured ? `${accounts.length} compte(s) visibles` : "Variable UNIPILE_API_KEY manquante")} />
        </tbody></table>
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
