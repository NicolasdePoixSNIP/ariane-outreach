import Link from "next/link";
import Icon from "@/components/Icon";
import { StatusPill, fmt } from "@/components/ui";
import { listCampaigns, professionLabel } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Campagnes() {
  const campaigns = await listCampaigns();
  return (
    <>
      <div className="top">
        <div><p className="eye">Campagnes</p><h1>{campaigns.length} campagne{campaigns.length > 1 ? "s" : ""}</h1></div>
        <div className="btns"><Link className="btn pri" href="/nouvelle"><Icon name="plus" />Nouvelle campagne</Link></div>
      </div>
      <div className="card">
        {campaigns.length ? (
          <table className="tbl">
            <thead><tr><th>Campagne</th><th>Métier</th><th>Contacts</th><th>Statut</th></tr></thead>
            <tbody>{campaigns.map((c) => (
              <tr key={c.id}><td><Link href={`/campagnes/${c.id}`} style={{ fontWeight: 700, color: "#1E293B" }}>{c.name}</Link></td><td>{professionLabel(c.profession)}</td><td>{fmt(c.size)}</td><td><StatusPill status={c.status} /></td></tr>
            ))}</tbody>
          </table>
        ) : <div className="empty"><b>Aucune campagne</b>Créez la première avec « Nouvelle campagne ».</div>}
      </div>
    </>
  );
}
