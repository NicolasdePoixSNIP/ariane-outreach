import Link from "next/link";
import Icon from "@/components/Icon";
import { SetupNeeded, fmt } from "@/components/ui";
import { redisConfigured } from "@/lib/redis";
import { contactCounts, listContacts, PROFESSIONS, professionLabel } from "@/lib/store";

export const dynamic = "force-dynamic";

const STATUT = { nouveau: ["Nouveau", "p-draft"], en_campagne: ["En séquence", "p-val"], stop: ["Stop", "p-risk"], client: ["Client", "p-on"] };

export default async function Contacts({ searchParams }) {
  const sp = await searchParams;
  const profession = sp?.profession || "";
  const q = sp?.q || "";
  const page = Math.max(1, Number(sp?.page || 1));
  const [counts, list] = await Promise.all([contactCounts(), listContacts({ profession, q, page })]);
  const pages = Math.max(1, Math.ceil(list.total / 50));
  const qs = (p) => `/contacts?${new URLSearchParams({ ...(profession && { profession }), ...(q && { q }), page: String(p) })}`;

  return (
    <>
      <div className="top">
        <div>
          <p className="eye">Contacts et audiences</p>
          <h1>{fmt(counts?.total)} contacts</h1>
          <p className="lead">Une seule base pour toutes les professions, dédoublonnée par email et profil LinkedIn.</p>
        </div>
        <div className="btns"><Link className="btn pri" href="/contacts/import"><Icon name="upload" />Importer des contacts</Link></div>
      </div>
      {!redisConfigured ? <SetupNeeded /> : null}
      <div className="cols">
        <div className="card" style={{ flex: "1 1 260px", maxWidth: 320, padding: 20 }}>
          <h2 style={{ marginBottom: 12 }}>Métiers</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Link href="/contacts" style={{ display: "flex", justifyContent: "space-between", padding: 12, borderRadius: 12, color: "#1E293B", background: profession ? "" : "#EEF1FD" }}>
              <b style={{ fontSize: 14 }}>Tous</b><b>{fmt(counts?.total)}</b>
            </Link>
            {PROFESSIONS.map((p) => (
              <Link key={p.id} href={`/contacts?profession=${p.id}`} style={{ display: "flex", justifyContent: "space-between", padding: 12, borderRadius: 12, color: "#1E293B", background: profession === p.id ? "#EEF1FD" : "" }}>
                <b style={{ fontSize: 14 }}>{p.label}</b><b>{fmt(counts?.byProf?.[p.id])}</b>
              </Link>
            ))}
          </div>
          <div className="note" style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #E2E8F0" }}>
            Exclusions globales : {fmt(counts?.stop)} « stop », {fmt(counts?.client)} clients et prospects.
          </div>
        </div>
        <div className="card" style={{ flex: "3 1 560px" }}>
          <form method="get" action="/contacts" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
            {profession ? <input type="hidden" name="profession" value={profession} /> : null}
            <input className="field" style={{ flex: "1 1 260px" }} name="q" defaultValue={q} placeholder="Rechercher un nom, un cabinet, une ville, un email" aria-label="Rechercher" />
            <button className="btn" type="submit"><Icon name="search" />Rechercher</button>
          </form>
          {list.items.length ? (
            <div className="scroll">
              <table className="tbl">
                <thead><tr><th>Contact</th><th>Cabinet</th><th>Ville</th><th>Métier</th><th>Canaux</th><th>Statut</th></tr></thead>
                <tbody>
                  {list.items.map((c) => {
                    const st = STATUT[c.statut] || STATUT.nouveau;
                    const initials = `${(c.prenom || "")[0] || ""}${(c.nom || "")[0] || ""}`.toUpperCase() || "?";
                    return (
                      <tr key={c.id}>
                        <td><div style={{ display: "flex", gap: 12, alignItems: "center" }}><div className="av">{initials}</div><div><b>{[c.prenom, c.nom].filter(Boolean).join(" ") || c.email}</b><div className="note">{c.titre || c.email}</div></div></div></td>
                        <td>{c.cabinet || "—"}</td>
                        <td>{c.ville || "—"}</td>
                        <td className="sm">{professionLabel(c.profession)}</td>
                        <td><span className="ch">{c.linkedin ? <a href={c.linkedin} target="_blank" rel="noreferrer" aria-label="Profil LinkedIn"><Icon name="li" /></a> : null}{c.email ? <span title={c.email}><Icon name="mail" /></span> : null}</span></td>
                        <td><span className={`pill ${st[1]}`}>{st[0]}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty"><b>Aucun contact</b>Importez une liste pour commencer.</div>
          )}
          <div className="pager">
            <span>{fmt(list.total)} résultat{list.total > 1 ? "s" : ""} · page {page} / {pages}</span>
            {page > 1 ? <Link className="btn" href={qs(page - 1)}>Précédent</Link> : null}
            {page < pages ? <Link className="btn" href={qs(page + 1)}>Suivant</Link> : null}
          </div>
        </div>
      </div>
    </>
  );
}
