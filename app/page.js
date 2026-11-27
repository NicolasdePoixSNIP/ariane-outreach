import Link from "next/link";
import Icon from "@/components/Icon";
import { StatusPill, SetupNeeded, fmt, pct, n } from "@/components/ui";
import { redisConfigured } from "@/lib/redis";
import { contactCounts, listCampaigns, recentEvents, PROFESSIONS, professionLabel } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [counts, campaigns, replies] = await Promise.all([contactCounts(), listCampaigns(), recentEvents("reply", 6)]);
  const today = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(new Date());
  const active = campaigns.filter((c) => c.status === "active");
  const paused = campaigns.filter((c) => c.status === "paused");
  const toValidate = campaigns.filter((c) => c.status === "to_validate");
  const sum = (k) => campaigns.reduce((a, c) => a + n(c.stats?.[k]), 0);
  const contacted = sum("contacted"), reached = sum("accepted") + sum("delivered"), rep = sum("replies"), pos = sum("positives"), rdv = sum("meetings");
  const funnel = [["Contactés", contacted], ["Acceptés ou délivrés", reached], ["Réponses", rep], ["Réponses positives", pos], ["RDV obtenus", rdv]];
  const toHandle = replies.filter((r) => !r.handled);
  const points = [];
  if (toHandle.length) points.push(`${toHandle.length} réponse${toHandle.length > 1 ? "s" : ""} à traiter.`);
  paused.forEach((c) => points.push(`La campagne « ${c.name} » est en pause${c.pauseReason ? ` : ${c.pauseReason}` : ""}.`));
  toValidate.forEach((c) => points.push(`La campagne « ${c.name} » attend votre validation.`));

  return (
    <>
      <div className="top">
        <div>
          <p className="eye">Tour de contrôle</p>
          <h1>Bonjour Nicolas</h1>
          <p className="lead" style={{ textTransform: "none" }}>
            {today.charAt(0).toUpperCase() + today.slice(1)} · {active.length} campagne{active.length > 1 ? "s" : ""} active{active.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="btns">
          <Link className="btn" href="/contacts/import"><Icon name="upload" />Importer des contacts</Link>
          <Link className="btn pri" href="/nouvelle"><Icon name="plus" />Nouvelle campagne</Link>
        </div>
      </div>

      {!redisConfigured ? <SetupNeeded /> : null}

      {points.length ? (
        <div className="alert">
          <span className="ai"><Icon name="alert" /></span>
          <div><b>{points.length} point{points.length > 1 ? "s" : ""} à traiter.</b> {points.join(" ")}</div>
        </div>
      ) : null}

      <div className="grid4">
        <div className="card"><div className="kl">Contacts dans la base</div><div className="kv">{fmt(counts?.total)}</div><div className="ks">{fmt(counts?.stop)} exclus « stop » · {fmt(counts?.client)} clients</div></div>
        <div className="card"><div className="kl">Campagnes actives</div><div className="kv">{active.length}</div><div className="ks">{paused.length} en pause · {toValidate.length} à valider</div></div>
        <div className="card"><div className="kl">Taux de réponse</div><div className="kv">{pct(rep, contacted)}</div><div className="ks">{fmt(rep)} réponses sur {fmt(contacted)} contactés</div></div>
        <div className="card"><div className="kl">RDV obtenus</div><div className="kv">{fmt(rdv)}</div><div className="ks">{fmt(pos)} réponses positives</div></div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Campagnes</h2>
        {campaigns.length ? (
          <div className="scroll">
            <table className="tbl">
              <thead><tr><th>Campagne</th><th>Canal</th><th>Métier</th><th>Avancement</th><th>Réponses</th><th>RDV</th><th>Statut</th></tr></thead>
              <tbody>
                {campaigns.map((c) => {
                  const total = n(c.size), done = n(c.stats?.contacted);
                  return (
                    <tr key={c.id}>
                      <td><Link href={`/campagnes/${c.id}`} style={{ fontWeight: 700, color: "#1E293B" }}>{c.name}</Link></td>
                      <td className="sm">{(c.channels || []).join(" + ") || "—"}</td>
                      <td>{professionLabel(c.profession)}</td>
                      <td><div className="bar"><span style={{ width: `${total ? Math.round((done * 100) / total) : 0}%` }} /></div><div className="note" style={{ marginTop: 6 }}>{fmt(done)} / {fmt(total)}</div></td>
                      <td><b>{fmt(c.stats?.replies)}</b></td>
                      <td><b>{fmt(c.stats?.meetings)}</b></td>
                      <td><StatusPill status={c.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty"><b>Aucune campagne pour l’instant</b>Le concepteur de campagne arrive à l’étape suivante du développement.</div>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginBottom: 6 }}>Entonnoir global</h2>
          <p className="note" style={{ margin: "0 0 18px" }}>Toutes campagnes et tous canaux.</p>
          <div className="fun">
            {funnel.map(([label, v]) => (
              <div className="fr" key={label}>
                <span>{label}</span>
                <div className="fb" style={{ width: `${contacted ? Math.max(2, Math.round((v * 100) / contacted)) : 2}%` }} />
                <b style={{ textAlign: "right" }}>{fmt(v)}</b>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2 style={{ marginBottom: 8 }}>Base par métier</h2>
          <table className="tbl">
            <tbody>
              {PROFESSIONS.map((p) => (
                <tr key={p.id}>
                  <td><Link href={`/contacts?profession=${p.id}`} style={{ color: "#1E293B", fontWeight: 600 }}>{p.label}</Link></td>
                  <td style={{ textAlign: "right" }}><b>{fmt(counts?.byProf?.[p.id])}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          {toHandle.length ? (
            <>
              <h2 style={{ margin: "20px 0 4px" }}>Réponses à traiter</h2>
              {toHandle.map((r, i) => (
                <div className="li" key={i}>
                  <div className="av">{(r.contactName || "?").slice(0, 2).toUpperCase()}</div>
                  <div><b>{r.contactName}</b><div className="note">{r.campaignName} · {r.channel}</div><div style={{ marginTop: 4 }}>« {r.text} »</div></div>
                </div>
              ))}
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
