import Link from "next/link";
import { notFound } from "next/navigation";
import StatusButtons from "@/components/StatusButtons";
import { StatusPill, fmt, pct, n } from "@/components/ui";
import { getCampaign, campaignMembers, STEP_TYPES } from "@/lib/campaigns";
import { professionLabel } from "@/lib/store";
import { redis } from "@/lib/redis";

export const dynamic = "force-dynamic";

const ST = { queued: ["En attente", "p-draft"], running: ["En séquence", "p-val"], replied: ["A répondu", "p-on"], stopped: ["Stop", "p-risk"], bounced: ["Adresse en échec", "p-risk"], done: ["Terminé", "p-draft"] };

export default async function Campagne({ params }) {
  const { id } = await params;
  const c = await getCampaign(id);
  if (!c) notFound();
  const s = c.stats;
  const [members, events] = await Promise.all([campaignMembers(id, { limit: 80 }), redis.lrange(`ev:camp:${id}`, 0, 14)]);
  const contacted = n(s.contacted);
  return (
    <>
      <div className="top">
        <div>
          <p className="eye">Campagne · {professionLabel(c.profession)}</p>
          <h1>{c.name}</h1>
          <p className="lead">{c.validatedAt ? `Validée le ${new Date(c.validatedAt).toLocaleDateString("fr-FR")}` : "Pas encore validée"} · début le {new Date(`${c.startDate}T12:00:00`).toLocaleDateString("fr-FR")}{c.pauseReason ? ` · en pause : ${c.pauseReason}` : ""}{c.executor === "taches" ? " · envois réalisés par les tâches programmées (suivi repris du fichier Prospection_LinkedIn.csv)" : ""}</p>
        </div>
        <div className="btns" style={{ alignItems: "center" }}>
          <StatusPill status={c.status} />
          <StatusButtons id={id} status={c.status} />
          <Link className="btn" href={`/nouvelle?id=${id}`}>{c.status === "to_validate" || c.status === "draft" ? "Modifier et valider" : "Modifier"}</Link>
        </div>
      </div>
      <div className="grid4">
        <div className="card"><div className="kl">Avancement</div><div className="kv">{fmt(contacted)} / {fmt(c.size)}</div><div className="bar" style={{ marginTop: 8 }}><span style={{ width: `${n(c.size) ? Math.round((contacted * 100) / n(c.size)) : 0}%` }} /></div></div>
        <div className="card"><div className="kl">Invitations acceptées</div><div className="kv">{pct(s.accepted, s.invites)}</div><div className="ks">{fmt(s.accepted)} sur {fmt(s.invites)} invitations · {fmt(s.withdrawn)} retirées</div></div>
        <div className="card"><div className="kl">Réponses</div><div className="kv">{fmt(s.replies)}</div><div className="ks">{pct(s.replies, contacted)} des contactés · {fmt(s.stops)} « stop »</div></div>
        <div className="card"><div className="kl">Mails</div><div className="kv">{fmt(s.emails)}</div><div className="ks">{fmt(s.bounces)} en échec ({pct(s.bounces, s.emails)})</div></div>
      </div>
      <div className="cols">
        <div className="card" style={{ flex: "2 1 560px" }}>
          <h2 style={{ marginBottom: 8 }}>Séquence</h2>
          <table className="tbl"><thead><tr><th>Étape</th><th>Délai</th><th>Type</th><th>Objet ou début du texte</th></tr></thead>
            <tbody>{c.steps.map((st, i) => (
              <tr key={st.id}><td className="day">{i + 1}</td><td className="sm">{i === 0 ? "départ" : `+${st.delay} j. ouvrés`}</td><td className="sm">{STEP_TYPES[st.type]}</td><td className="sm muted">{st.subject || String(st.text || "(sans note)").slice(0, 90)}</td></tr>
            ))}</tbody></table>
        </div>
        <div className="card" style={{ flex: "1 1 340px" }}>
          <h2 style={{ marginBottom: 8 }}>Activité récente</h2>
          {events.length ? events.map((e, i) => (
            <div className="li" key={i}><div><div className="note">{new Date(e.ts).toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</div><div style={{ fontSize: 14 }}>{e.contactName ? <b>{e.contactName} · </b> : null}{e.text}</div></div></div>
          )) : <p className="note">Aucune activité pour l’instant.</p>}
        </div>
      </div>
      <div className="card">
        <h2 style={{ marginBottom: 8 }}>Contacts de la campagne</h2>
        {members.length ? (
          <div className="scroll"><table className="tbl"><thead><tr><th>Contact</th><th>Cabinet</th><th>Statut</th><th>Étape suivante</th><th>Échéance</th></tr></thead>
            <tbody>{members.map(({ contact: ct, state }) => {
              const stt = ST[state.status] || ST.queued;
              const next = c.steps[Number(state.step || 0)];
              return (
                <tr key={ct.id}><td><b>{[ct.prenom, ct.nom].filter(Boolean).join(" ") || ct.email}</b><div className="note">{ct.email}</div></td><td className="sm">{ct.cabinet}</td>
                  <td><span className={`pill ${stt[1]}`}>{stt[0]}</span></td><td className="sm">{next && !["replied", "stopped", "bounced", "done"].includes(state.status) ? STEP_TYPES[next.type] : "—"}</td><td className="sm muted">{state.due || "—"}</td></tr>
              );
            })}</tbody></table></div>
        ) : <p className="note">La liste sera figée à la validation.</p>}
      </div>
    </>
  );
}
