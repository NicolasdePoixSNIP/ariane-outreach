import { redis } from "./redis";

// Compteurs datés : chaque événement incrémente le cumul de la campagne (campstats:{id})
// et son compteur du jour (cd:{id}, champ "AAAA-MM-JJ|indicateur").
// C'est ce qui permet de filtrer l'entonnoir par semaine ou par mois.

export const METRICS = ["contacted", "invites", "accepted", "messages", "emails", "mailed", "opens", "replies", "stops", "bounces", "withdrawn", "positives", "meetings"];

export function parisDay(d = new Date()) {
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** Normalise une date du fichier (AAAA-MM-JJ, JJ/MM/AAAA, ISO, timestamp) en AAAA-MM-JJ, ou "" si illisible. */
export function toDay(v) {
  if (!v || v === "oui") return "";
  if (typeof v === "number" || /^\d{12,}$/.test(String(v))) return parisDay(new Date(Number(v)));
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return isNaN(d) ? "" : parisDay(d);
}

export async function track(campId, metric, n = 1, day = parisDay()) {
  if (!campId) return;
  await Promise.all([
    redis.hincrby(`campstats:${campId}`, metric, n),
    redis.hincrby(`cd:${campId}`, `${day}|${metric}`, n),
  ]);
}

// ---------- périodes ----------

const addDays = (day, k) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
};
export const mondayOf = (day) => {
  const dow = (new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(day, -dow);
};
const monthOf = (day) => day.slice(0, 7);
const prevMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};
const endOfMonth = (ym) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export const PERIODS = [
  { id: "semaine", label: "Cette semaine" },
  { id: "semaine-1", label: "Semaine dernière" },
  { id: "mois", label: "Ce mois-ci" },
  { id: "mois-1", label: "Mois dernier" },
  { id: "tout", label: "Depuis le début" },
];

export function periodRange(id, today = parisDay()) {
  const mon = mondayOf(today);
  switch (id) {
    case "semaine": return { from: mon, to: today };
    case "semaine-1": return { from: addDays(mon, -7), to: addDays(mon, -1) };
    case "mois": return { from: `${monthOf(today)}-01`, to: today };
    case "mois-1": { const pm = prevMonth(monthOf(today)); return { from: `${pm}-01`, to: endOfMonth(pm) }; }
    default: return null; // depuis le début
  }
}

const empty = () => Object.fromEntries(METRICS.map((k) => [k, 0]));

/**
 * Compteurs par campagne sur une période (null = cumul depuis le début).
 * Renvoie { [campId]: {metric: n} }.
 */
export async function statsFor(campIds, range) {
  const out = {};
  if (!campIds.length) return out;
  const p = redis.pipeline();
  campIds.forEach((id) => p.hgetall(range ? `cd:${id}` : `campstats:${id}`));
  const rows = await p.exec();
  campIds.forEach((id, i) => {
    const s = empty();
    const h = rows[i] || {};
    for (const [k, v] of Object.entries(h)) {
      if (range) {
        const [day, metric] = k.split("|");
        if (day >= range.from && day <= range.to && metric in s) s[metric] += Number(v) || 0;
      } else if (k in s) s[k] += Number(v) || 0;
    }
    out[id] = s;
  });
  return out;
}

/** Série par semaine ou par mois (les `count` dernières), toutes campagnes confondues. */
export async function seriesFor(campIds, by = "semaine", count = 8, today = parisDay()) {
  const buckets = [];
  if (by === "mois") {
    let ym = monthOf(today);
    for (let i = 0; i < count; i++) { buckets.unshift({ key: ym, from: `${ym}-01`, to: endOfMonth(ym) }); ym = prevMonth(ym); }
  } else {
    let mon = mondayOf(today);
    for (let i = 0; i < count; i++) { buckets.unshift({ key: mon, from: mon, to: addDays(mon, 6) }); mon = addDays(mon, -7); }
  }
  const p = redis.pipeline();
  campIds.forEach((id) => p.hgetall(`cd:${id}`));
  const rows = campIds.length ? await p.exec() : [];
  for (const b of buckets) b.s = empty();
  for (const h of rows) {
    for (const [k, v] of Object.entries(h || {})) {
      const [day, metric] = k.split("|");
      const b = buckets.find((x) => day >= x.from && day <= x.to);
      if (b && metric in b.s) b.s[metric] += Number(v) || 0;
    }
  }
  return buckets;
}

export function sumStats(map) {
  const s = empty();
  for (const v of Object.values(map)) for (const k of METRICS) s[k] += v[k] || 0;
  return s;
}

/** Taux d'accroche : (acceptations LinkedIn + premières ouvertures mail) / (invitations + contacts ayant reçu un 1er mail). */
export function hook(s) {
  const num = (s.accepted || 0) + (s.opens || 0);
  const den = (s.invites || 0) + (s.mailed || 0);
  return { num, den, rate: den ? num / den : null };
}
