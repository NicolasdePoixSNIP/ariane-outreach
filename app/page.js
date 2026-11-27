import Link from "next/link";
import Icon from "@/components/Icon";
import { StatusPill, SetupNeeded, fmt, pct, n } from "@/components/ui";
import { redisConfigured } from "@/lib/redis";
import { contactCounts, listCampaigns, recentEvents, PROFESSIONS, professionLabel } from "@/lib/store";
import { PERIODS, periodRange, statsFor, seriesFor, sumStats, hook } from "@/lib/metrics";

export const dynamic = "force-dynamic";

const frDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const frMonth = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

export default async function Dashboard(props) {
  const sp = (await props.searchParams) || {};
  const periode = PERIODS.some((p) => p.id === sp.periode) ? sp.periode : "tout";
  const vue = sp.vue === "mois" ? "mois" : "semaine";
  const [counts, campaigns, replies] = await Promise.all([contactCounts(), listCampaigns(), recentEvents("reply", 6)]);
  const ids = campaigns.map((c) => c.id);
  const [byCamp, series] = await Promise.all([statsFor(ids, periodRange(periode)), seriesFor(ids, vue, vue === "mois" ? 6 : 8)]);
  const S = sumStats(byCamp);
  const H = hook(S);
  const q = (o) => `/?${new URLSearchParams({ periode, vue, ...o })}`;
  const today = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" }).format(new Date());
  const active = campaigns.filter((c) => c.status === "active");
  const paused = campaigns.filter((c) => c.status === "paused");
  const toValidate = campaigns.filter((c) => c.status === "to_validate");
  const contacted = S.contacted, rep = S.replies, pos = S.positives, rdv = S.meetings;
  const funnel = [["Contactés", contacted], ["Accrochés (acceptations + ouvertures)", H.num], ["Réponses", rep], ["Réponses positives", pos], ["RDV obtenus", rdv]];
  const periodLabel = PERIODS.find((p) => p.id === periode)?.label;
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

      <div className="btns" style={{ marginBottom: 16, flexWrap: "wrap" }}>
        {PERIODS.map((p) => (
          <Link key={p.id} href={q({ periode: p.id })} className={`btn ${periode === p.id ? "pri" : ""}`}>{p.label}</Link>
        ))}
      </div>

      <div className="grid4">
        <div className="card"><div className="kl">Contactés · {periodLabel}</div><div className="kv">{fmt(contacted)}</div><div className="ks">{fmt(counts?.total)} contacts en base · {fmt(counts?.stop)} « stop »</div></div>
        <div className="card"><div className="kl">Taux d’accroche</div><div className="kv">{H.rate == null ? "—" : pct(H.num, H.den)}</div><div className="ks">{fmt(S.accepted)} acceptations sur {fmt(S.invites)} invitations · {fmt(S.opens)} ouvertures sur {fmt(S.mailed)} mails</div></div>
        <div className="card"><div className="kl">Taux de réponse</div><div className="kv">{pct(rep, contacted)}</div><div className="ks">{fmt(rep)} réponses sur {fmt(contacted)} contactés</div></div>
        <div className="card"><div className="kl">RDV obtenus</div><div className="kv">{fmt(rdv)}</div><div className="ks">{fmt(pos)} réponses positives</div></div>
      </div>

      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Campagnes</h2>
        {campaigns.length ? (
          <div className="scroll">
            <table className="tbl">
              <thead><tr><th>Campagne</th><th>Canal</th><th>Métier</th><th>Avancement</th><th>Accroche</th><th>Réponses</th><th>RDV</th><th>Statut</th></tr></thead>
              <tbody>
                {campaigns.map((c) => {
                  const total = n(c.size), done = n(c.stats?.contacted);
                  return (
                    <tr key={c.id}>
                      <td><Link href={`/campagnes/${c.id}`} style={{ fontWeight: 700, color: "#1E293B" }}>{c.name}</Link></td>
                      <td className="sm">{(c.channels || []).join(" + ") || "—"}</td>
                      <td>{professionLabel(c.profession)}</td>
                      <td><div className="bar"><span style={{ width: `${total ? Math.round((done * 100) / total) : 0}%` }} /></div><div className="note" style={{ marginTop: 6 }}>{fmt(done)} / {fmt(total)}</div></td>
                      <td><b>{(() => { const h = hook(byCamp[c.id] || {}); return h.rate == null ? "—" : pct(h.num, h.den); })()}</b></td>
                      <td><b>{fmt(byCamp[c.id]?.replies)}</b></td>
                      <td><b>{fmt(byCamp[c.id]?.meetings)}</b></td>
                      <td><StatusPill status={c.status} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty"><b>Aucune campagne pour l’instant</b><Link href="/nouvelle">Créer la première campagne</Link></div>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <h2 style={{ marginBottom: 6 }}>Entonnoir global</h2>
          <p className="note" style={{ margin: "0 0 18px" }}>Toutes campagnes et tous canaux · {periodLabel}.</p>
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

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
          <h2>Évolution {vue === "mois" ? "par mois" : "par semaine"}</h2>
          <div className="btns">
            <Link href={q({ vue: "semaine" })} className={`btn ${vue === "semaine" ? "pri" : ""}`}>Semaines</Link>
            <Link href={q({ vue: "mois" })} className={`btn ${vue === "mois" ? "pri" : ""}`}>Mois</Link>
          </div>
        </div>
        <div className="scroll">
          <table className="tbl">
            <thead><tr><th>{vue === "mois" ? "Mois" : "Semaine du"}</th><th>Contactés</th><th>Invitations</th><th>Acceptations</th><th>1ers mails</th><th>Ouvertures</th><th>Taux d’accroche</th><th>Réponses</th><th>RDV</th></tr></thead>
            <tbody>
              {series.slice().reverse().map((b) => {
                const h = hook(b.s);
                return (
                  <tr key={b.key}>
                    <td><b>{vue === "mois" ? frMonth(b.key) : frDay(b.key)}</b></td>
                    <td>{fmt(b.s.contacted)}</td><td>{fmt(b.s.invites)}</td><td>{fmt(b.s.accepted)}</td>
                    <td>{fmt(b.s.mailed)}</td><td>{fmt(b.s.opens)}</td>
                    <td><b>{h.rate == null ? "—" : pct(h.num, h.den)}</b></td>
                    <td>{fmt(b.s.replies)}</td><td>{fmt(b.s.meetings)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="note" style={{ marginTop: 8 }}>Les acceptations sont comptées le jour où elles sont constatées. Les ouvertures excluent les robots antispam ; une ouverture par contact au plus.</p>
      </div>
    </>
  );
}
