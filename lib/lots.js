import crypto from "node:crypto";
import { redis } from "./redis";
import { upsertContacts } from "./store";
import { unipile } from "./unipile";

// Un « lot » est la liste de contacts propre à une campagne, venue d'un fichier importé
// ou d'une recherche LinkedIn. Les contacts sont d'abord fusionnés dans la base (sans doublon),
// puis rattachés au lot.

const LI = () => process.env.UNIPILE_LINKEDIN_ACCOUNT_ID || "acc_01m876t0xxfahtc4pwnqsfty88";
export const newLotId = () => "lot_" + crypto.randomBytes(5).toString("hex");

/** Fusionne des lignes dans la base, les rattache au lot et renvoie le bilan de comparaison. */
export async function addToLot(lotId, rows, { profession = "autre", source = "import" } = {}) {
  const before = await redis.scard(`lot:${lotId}`);
  const res = await upsertContacts(rows, { profession, source });
  const ids = res.ids.filter(Boolean);
  if (ids.length) await redis.sadd(`lot:${lotId}`, ...ids);
  const [stop, client, busy] = await Promise.all([redis.smembers("s:excl:stop"), redis.smembers("s:excl:client"), redis.smembers("s:incampaign")]);
  const S = new Set(stop), C = new Set(client), B = new Set(busy);
  const cmp = { nouveaux: res.created, dejaEnBase: res.completed, ignores: res.skipped, stop: 0, clients: 0, enCampagne: 0 };
  for (const id of new Set(ids)) {
    if (S.has(id)) cmp.stop++;
    else if (C.has(id)) cmp.clients++;
    else if (B.has(id)) cmp.enCampagne++;
  }
  const total = await redis.scard(`lot:${lotId}`);
  await redis.hset(`lotmeta:${lotId}`, { source, updated: Date.now(), total });
  return { lotId, ...cmp, ajoutes: total - before, total };
}

export async function lotSummary(lotId) {
  if (!lotId) return null;
  const [meta, total] = await Promise.all([redis.hgetall(`lotmeta:${lotId}`), redis.scard(`lot:${lotId}`)]);
  return { ...(meta || {}), total };
}

// ---------- recherche LinkedIn (Unipile) ----------

function toRow(p) {
  const name = String(p.display_name || p.name || `${p.first_name || ""} ${p.last_name || ""}`).trim();
  const [prenom, ...rest] = name.split(/\s+/);
  return {
    prenom: p.first_name || prenom || "",
    nom: p.last_name || rest.join(" "),
    titre: p.headline || p.description || "",
    ville: p.location || "",
    linkedin: p.profile_url || (p.public_identifier ? `https://www.linkedin.com/in/${p.public_identifier}` : ""),
    li_id: p.id || "",
    li_niveau: p.network_distance || "",
    li_photo: p.public_picture_url_large || p.public_picture_url || p.profile_picture_url || p.picture_url || "",
  };
}

/**
 * Lance quelques pages de recherche LinkedIn (par URL ou par critères) et ajoute les résultats au lot.
 * Chaque page compte dans le quota Unipile de la route de recherche : on s'arrête à `pages` pages.
 */
export async function linkedinSearchToLot({ lotId, url, criteria, cursor, pages = 5, profession = "autre", log = [] }) {
  const rows = [];
  let next = cursor || null;
  let total = null;
  for (let i = 0; i < pages; i++) {
    const path = url ? `/${LI()}/linkedin/search` : `/${LI()}/linkedin/search/people`;
    const body = url ? { url } : criteria;
    const r = await unipile(path, { method: "POST", body, query: next ? { cursor: next } : undefined });
    for (const p of r.data || r.items || []) {
      if (p.type && p.type !== "PEOPLE" && p.object && !/user|people|profile/i.test(p.object)) continue;
      const row = toRow(p);
      if (row.linkedin || row.li_id) rows.push(row);
    }
    total = r.total_count ?? r.paging?.total_count ?? total;
    next = r.next_cursor || r.cursor || null;
    if (!next) break;
    await new Promise((res) => setTimeout(res, 4500)); // 10 requêtes / 40 s au plus
  }
  // les résultats sans URL publique gardent l'identifiant LinkedIn : on fabrique une URL /in/{id}
  rows.forEach((r) => { if (!r.linkedin && r.li_id) r.linkedin = `https://www.linkedin.com/in/${r.li_id}`; });
  const res = await addToLot(lotId, rows, { profession, source: url ? "recherche LinkedIn (URL)" : "recherche LinkedIn" });
  return { ...res, trouves: rows.length, nextCursor: next, totalLinkedin: total };
}

export async function linkedinLocations(q) {
  const r = await unipile(`/${LI()}/linkedin/search/parameters`, { query: { type: "LOCATION", keywords: q, limit: 8 } });
  return (r.data || []).map((x) => ({ id: x.id, name: x.name }));
}
