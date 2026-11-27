import crypto from "node:crypto";
import { redis, redisConfigured } from "./redis";

export const PROFESSIONS = [
  { id: "avocat", label: "Avocats" },
  { id: "expert-comptable", label: "Experts-comptables" },
  { id: "notaire", label: "Notaires" },
  { id: "cgp", label: "CGP" },
  { id: "banquier-prive", label: "Banquiers privés" },
  { id: "conseil-ma", label: "Conseil M&A" },
  { id: "autre", label: "Autres" },
];

export const professionLabel = (id) => PROFESSIONS.find((p) => p.id === id)?.label || "Autres";

// ---------- normalisation ----------

export function normEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : "";
}

export function normLinkedin(v) {
  const s = String(v || "").trim();
  const m = s.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  return m ? decodeURIComponent(m[1]).toLowerCase() : "";
}

function contactId(email, li, fallback) {
  const key = email ? `e:${email}` : li ? `l:${li}` : `x:${fallback}`;
  return "c_" + crypto.createHash("sha1").update(key).digest("hex").slice(0, 14);
}

export function normProfession(v, fallback = "autre") {
  const s = String(v || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!s) return fallback;
  if (s.startsWith("avocat")) return "avocat";
  if (s.includes("comptable") || s === "ec" || s === "exco") return "expert-comptable";
  if (s.startsWith("notaire")) return "notaire";
  if (s.includes("cgp") || s.includes("gestion de patrimoine")) return "cgp";
  if (s.includes("banqu")) return "banquier-prive";
  if (s.includes("m&a") || s === "ma" || s.includes("fusion")) return "conseil-ma";
  return PROFESSIONS.some((p) => p.id === s) ? s : fallback;
}

function clean(v) {
  return String(v ?? "").trim();
}

// ---------- contacts ----------

/**
 * Ajoute ou complète des contacts. Un contact existant n'est jamais écrasé :
 * seuls les champs vides sont complétés, et la source est ajoutée.
 * mode "exclusion" : les contacts sont enregistrés comme exclus (stop ou client).
 */
export async function upsertContacts(rows, { profession = "autre", source = "import", mode = "contacts", exclusion = "stop" } = {}) {
  if (!redisConfigured) throw new Error("Base de données non configurée");
  const now = Date.now();
  const res = { created: 0, completed: 0, skipped: 0, excluded: 0, ids: [] };

  // 1. résoudre les identifiants existants (par email puis LinkedIn)
  const prepared = rows.map((r) => {
    const email = normEmail(r.email);
    const li = normLinkedin(r.linkedin);
    return { r, email, li };
  });
  const look = redis.pipeline();
  prepared.forEach(({ email, li }) => {
    look.get(email ? `idx:email:${email}` : "idx:none");
    look.get(li ? `idx:li:${li}` : "idx:none");
  });
  const found = prepared.length ? await look.exec() : [];

  const existingIds = prepared.map((_, i) => found[2 * i] || found[2 * i + 1] || null);
  const read = redis.pipeline();
  existingIds.forEach((id) => read.hgetall(id ? `c:${id}` : "c:none"));
  const existing = prepared.length ? await read.exec() : [];

  const write = redis.pipeline();
  prepared.forEach(({ r, email, li }, i) => {
    const dc = /^\d{4}-\d{2}-\d{2}/.test(String(r.dernier_contact || "")) ? String(r.dernier_contact).slice(0, 10) : "";
    if (!email && !li) {
      res.skipped++;
      res.ids.push(null);
      return;
    }
    const prev = existing[i];
    const id = existingIds[i] || contactId(email, li, `${r.prenom}|${r.nom}|${r.cabinet}`);
    const data = {
      id,
      prenom: clean(r.prenom),
      nom: clean(r.nom),
      email,
      linkedin: li ? `https://www.linkedin.com/in/${li}` : "",
      titre: clean(r.titre),
      cabinet: clean(r.cabinet),
      ville: clean(r.ville),
      profession: normProfession(r.profession, profession),
      li_id: clean(r.li_id),
      li_niveau: clean(r.li_niveau),
    };
    if (prev && prev.id) {
      const patch = {};
      for (const [k, v] of Object.entries(data)) if (v && !prev[k]) patch[k] = v;
      const sources = new Set(String(prev.sources || "").split("|").filter(Boolean));
      sources.add(source);
      patch.sources = [...sources].join("|");
      if (dc && (!prev.dernier_contact || dc > prev.dernier_contact)) patch.dernier_contact = dc;
      patch.updated = now;
      write.hset(`c:${id}`, patch);
      res.completed++;
    } else {
      write.hset(`c:${id}`, { ...data, sources: source, created: now, updated: now, statut: "nouveau", ...(dc ? { dernier_contact: dc } : {}) });
      write.zadd("z:contacts", { score: now, member: id });
      write.zadd(`z:prof:${data.profession}`, { score: now, member: id });
      res.created++;
    }
    if (email) write.set(`idx:email:${email}`, id);
    if (li) write.set(`idx:li:${li}`, id);
    if (data.li_id) write.set(`idx:liid:${data.li_id}`, id);
    res.ids.push(id);
    if (mode === "exclusion") {
      write.sadd(`s:excl:${exclusion}`, id);
      write.hset(`c:${id}`, { statut: exclusion });
      res.excluded++;
    }
  });
  await write.exec();
  return res;
}

export async function contactCounts() {
  if (!redisConfigured) return null;
  const p = redis.pipeline();
  p.zcard("z:contacts");
  PROFESSIONS.forEach((pr) => p.zcard(`z:prof:${pr.id}`));
  p.scard("s:excl:stop");
  p.scard("s:excl:client");
  const r = await p.exec();
  const byProf = {};
  PROFESSIONS.forEach((pr, i) => (byProf[pr.id] = r[i + 1]));
  return { total: r[0], byProf, stop: r[PROFESSIONS.length + 1], client: r[PROFESSIONS.length + 2] };
}

export async function listContacts({ profession = "", q = "", page = 1, size = 50 } = {}) {
  if (!redisConfigured) return { items: [], total: 0 };
  const key = profession ? `z:prof:${profession}` : "z:contacts";
  const needle = q.trim().toLowerCase();
  if (!needle) {
    const total = await redis.zcard(key);
    const ids = await redis.zrange(key, (page - 1) * size, page * size - 1, { rev: true });
    return { items: await getContacts(ids), total };
  }
  // recherche : on parcourt jusqu'à 5 000 contacts du segment
  const ids = await redis.zrange(key, 0, 4999, { rev: true });
  const all = await getContacts(ids);
  const hits = all.filter((c) =>
    [c.prenom, c.nom, c.cabinet, c.ville, c.email].some((v) => String(v || "").toLowerCase().includes(needle))
  );
  return { items: hits.slice((page - 1) * size, page * size), total: hits.length };
}

export async function getContacts(ids) {
  if (!ids.length) return [];
  const p = redis.pipeline();
  ids.forEach((id) => p.hgetall(`c:${id}`));
  const rows = await p.exec();
  return rows.filter(Boolean);
}

// ---------- campagnes et événements ----------

export async function listCampaigns() {
  if (!redisConfigured) return [];
  const ids = await redis.zrange("z:campaigns", 0, -1, { rev: true });
  if (!ids.length) return [];
  const p = redis.pipeline();
  ids.forEach((id) => {
    p.get(`camp:${id}`);
    p.hgetall(`campstats:${id}`);
  });
  const r = await p.exec();
  return ids.map((id, i) => ({ ...(r[2 * i] || { id }), stats: r[2 * i + 1] || {} }));
}

export async function recentEvents(type = "", limit = 20) {
  if (!redisConfigured) return [];
  const raw = await redis.lrange("ev:global", 0, 499);
  return raw.filter((e) => !type || e.type === type).slice(0, limit);
}
