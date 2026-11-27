import crypto from "node:crypto";
import { redis } from "./redis";
import { getContacts } from "./store";

export const STEP_TYPES = {
  li_invite: "Invitation LinkedIn",
  li_message: "Message LinkedIn (si invitation acceptée)",
  email: "Mail",
};

export const DEFAULT_LIMITS = {
  liPerDay: 20,
  liPerWeek: 100,
  mailPerDay: 15,
  mailRampPerWeek: 5,
  mailMax: 50,
  withdrawAfterDays: 21,
  bouncePause: 5,
  newPerDay: 20,
};

export const CAMPAIGN_TYPES = { linkedin: "LinkedIn", email: "Mail", hybride: "Hybride (LinkedIn + mail)" };
export const ALLOWED_STEPS = { linkedin: ["li_invite", "li_message"], email: ["email"], hybride: ["li_invite", "li_message", "email"] };

export const DEFAULT_AUDIENCE = {
  source: "base", // base | fichier | linkedin
  lotId: "",
  profession: "avocat",
  villes: "",
  motsCles: "",
  excludeContactedDays: 90,
  max: 300,
};

export function newId() {
  return "cp_" + crypto.randomBytes(5).toString("hex");
}

export async function getCampaign(id) {
  const [c, stats] = await Promise.all([redis.get(`camp:${id}`), redis.hgetall(`campstats:${id}`)]);
  return c ? { ...c, stats: stats || {} } : null;
}

export async function saveCampaign(input) {
  const now = Date.now();
  const id = input.id || newId();
  const prev = input.id ? await redis.get(`camp:${id}`) : null;
  const type = CAMPAIGN_TYPES[input.type] ? input.type : inferType(input.steps || []);
  const q = input.qualify;
  const c = {
    id,
    type,
    name: String(input.name || "Campagne sans nom").slice(0, 120),
    qualify: type !== "email" && q && (q.secondDegreeOnly || q.locations || q.titleExclude || q.maxHeadcount)
      ? { secondDegreeOnly: Boolean(q.secondDegreeOnly), locations: String(q.locations || "").slice(0, 300), titleExclude: String(q.titleExclude || "").slice(0, 300), maxHeadcount: Math.max(0, Number(q.maxHeadcount) || 0), ...(prev?.qualify?.locationRx && !q.locations ? { locationRx: prev.qualify.locationRx, titleExcludeRx: prev.qualify.titleExcludeRx } : {}) }
      : null,
    executor: prev?.executor || "app",
    dryRun: prev?.dryRun || false,
    profession: input.audience?.profession || input.profession || "avocat",
    audience: { ...DEFAULT_AUDIENCE, ...(input.audience || {}), removed: (Array.isArray(input.audience?.removed) ? input.audience.removed : []).slice(0, 3000) },
    steps: (input.steps || []).filter((s) => STEP_TYPES[s.type] && ALLOWED_STEPS[type].includes(s.type)).map((s, i) => ({
      id: s.id || `s${i + 1}`,
      type: s.type,
      delay: Math.max(0, Number(s.delay || 0)),
      subject: String(s.subject || "").slice(0, 200),
      text: String(s.text || "").slice(0, 5000),
    })),
    limits: { ...DEFAULT_LIMITS, ...(input.limits || {}) },
    startDate: input.startDate || new Date().toISOString().slice(0, 10),
    createdAt: prev?.createdAt || now,
    updatedAt: now,
    status: prev?.status || "draft",
    size: prev?.size || 0,
    validatedAt: prev?.validatedAt || null,
    frozenHash: prev?.frozenHash || null,
  };
  c.channels = [...new Set(c.steps.map((s) => (s.type === "email" ? "Mail" : "LinkedIn")))];
  // toute modification d'une campagne validée la repasse « à valider »
  if (prev && ["active", "paused"].includes(prev.status) && hashOf(c) !== prev.frozenHash) c.status = "to_validate";
  await redis.set(`camp:${id}`, c);
  await redis.zadd("z:campaigns", { score: c.createdAt, member: id });
  return c;
}

export function inferType(steps) {
  const li = steps.some((s) => s.type !== "email"), em = steps.some((s) => s.type === "email");
  return li && em ? "hybride" : li ? "linkedin" : "email";
}

export function hashOf(c) {
  const payload = JSON.stringify({ a: c.audience, s: c.steps, l: c.limits, d: c.startDate, q: c.qualify || null });
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function needs(c) {
  return {
    email: c.steps.some((s) => s.type === "email"),
    linkedin: c.steps.some((s) => s.type !== "email"),
  };
}

/** Sélectionne les contacts correspondant à l'audience, exclusions appliquées. */
export async function resolveAudience(c, { limit } = {}) {
  const a = c.audience;
  const fromLot = a.source && a.source !== "base";
  if (fromLot && !a.lotId) return { contacts: [], reasons: { exclus: 0, recemment: 0, canal: 0, filtres: 0 }, total: 0 };
  const ids = fromLot ? await redis.smembers(`lot:${a.lotId}`) : await redis.zrange(`z:prof:${a.profession}`, 0, -1);
  const [stop, client, busy] = await Promise.all([
    redis.smembers("s:excl:stop"),
    redis.smembers("s:excl:client"),
    redis.smembers("s:incampaign"),
  ]);
  const excluded = new Set([...stop, ...client, ...busy]);
  const removed = new Set(Array.isArray(a.removed) ? a.removed : []);
  const villes = (fromLot ? "" : a.villes || "").split(/[,;\n]/).map((v) => v.trim().toLowerCase()).filter(Boolean);
  const mots = (fromLot ? "" : a.motsCles || "").split(/[,;\n]/).map((v) => v.trim().toLowerCase()).filter(Boolean);
  const cutoff = a.excludeContactedDays ? new Date(Date.now() - a.excludeContactedDays * 864e5).toISOString().slice(0, 10) : "";
  const need = needs(c);
  const out = [];
  const reasons = { exclus: 0, recemment: 0, canal: 0, filtres: 0 };
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500).filter((id) => {
      if (excluded.has(id)) { reasons.exclus++; return false; }
      return true;
    });
    const rows = await getContacts(chunk);
    for (const ct of rows) {
      if (removed.has(ct.id)) { reasons.retires = (reasons.retires || 0) + 1; continue; }
      if (cutoff && ct.dernier_contact && ct.dernier_contact >= cutoff) { reasons.recemment++; continue; }
      const hasChannel = (need.email && ct.email) || (need.linkedin && (ct.linkedin || ct.li_id));
      if (!hasChannel) { reasons.canal++; continue; }
      if (villes.length && !villes.some((v) => String(ct.ville || "").toLowerCase().includes(v))) { reasons.filtres++; continue; }
      if (mots.length && !mots.some((m) => `${ct.titre || ""} ${ct.cabinet || ""}`.toLowerCase().includes(m))) { reasons.filtres++; continue; }
      out.push(ct);
    }
    if (limit && out.length >= limit) break;
  }
  return { contacts: limit ? out.slice(0, limit) : out, reasons, total: ids.length };
}

/** Validation unique : fige la liste, les textes et le rythme. */
export async function validateCampaign(id) {
  const c = await redis.get(`camp:${id}`);
  if (!c) throw new Error("Campagne introuvable");
  if (!c.steps.length) throw new Error("La séquence est vide");
  const firstValidation = !c.validatedAt;
  if (firstValidation) {
    const { contacts } = await resolveAudience(c, { limit: Number(c.audience.max) || 300 });
    if (!contacts.length) throw new Error("Aucun contact ne correspond à l'audience");
    const p = redis.pipeline();
    contacts.forEach((ct, i) => {
      p.zadd(`camp:${id}:queued`, { score: i, member: ct.id });
      p.hset(`cm:${id}:${ct.id}`, { status: "queued", step: 0 });
      p.sadd("s:incampaign", ct.id);
      p.hset(`c:${ct.id}`, { statut: "en_campagne", campagne: id });
    });
    await p.exec();
    c.size = contacts.length;
  }
  c.status = "active";
  c.validatedAt = Date.now();
  c.frozenHash = hashOf(c);
  await redis.set(`camp:${id}`, c);
  await logEvent({ type: "validated", campaignId: id, campaignName: c.name, text: `Campagne validée (${c.size} contacts)` });
  return c;
}

export async function setStatus(id, status, reason = "") {
  const c = await redis.get(`camp:${id}`);
  if (!c) throw new Error("Campagne introuvable");
  if (status === "active" && c.frozenHash !== hashOf(c)) throw new Error("La campagne a été modifiée : validez-la à nouveau");
  c.status = status;
  c.pauseReason = status === "paused" ? reason : "";
  await redis.set(`camp:${id}`, c);
  await logEvent({ type: status === "paused" ? "paused" : "resumed", campaignId: id, campaignName: c.name, text: reason || status });
  return c;
}

export async function logEvent(ev) {
  const e = { ts: Date.now(), ...ev };
  await redis.lpush("ev:global", e);
  await redis.ltrim("ev:global", 0, 999);
  if (ev.campaignId) {
    await redis.lpush(`ev:camp:${ev.campaignId}`, e);
    await redis.ltrim(`ev:camp:${ev.campaignId}`, 0, 999);
  }
  return e;
}

export async function campaignMembers(id, { status = "", limit = 100 } = {}) {
  const queued = await redis.zrange(`camp:${id}:queued`, 0, -1);
  const due = await redis.zrange(`camp:${id}:due`, 0, -1);
  const done = await redis.smembers(`camp:${id}:done`);
  const ids = [...due, ...done, ...queued].slice(0, 2000);
  const p = redis.pipeline();
  ids.forEach((cid) => p.hgetall(`cm:${id}:${cid}`));
  const states = ids.length ? await p.exec() : [];
  const contacts = await getContacts(ids.slice(0, limit * 3));
  const byId = Object.fromEntries(contacts.map((c) => [c.id, c]));
  return ids
    .map((cid, i) => ({ contact: byId[cid], state: states[i] || {} }))
    .filter((m) => m.contact && (!status || m.state.status === status))
    .slice(0, limit);
}
