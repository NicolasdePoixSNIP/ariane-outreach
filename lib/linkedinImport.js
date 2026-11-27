import crypto from "node:crypto";
import { redis } from "./redis";
import { normProfession } from "./store";
import { toDay } from "./metrics";

// Reprise du fichier de suivi Prospection_LinkedIn.csv (campagnes pilotées par les tâches programmées).
// Colonnes : campagne;nom;niveau;titre;structure;statut;user_id;profile_url;date_visite;date_invitation;date_acceptation;date_message;note

const MESSAGES = {
  Avocats: "Bonjour {Prénom},\nMerci d'avoir accepté ma demande de mise en relation.\nJ'accompagne les cabinets d'avocats dans le développement de leur clientèle, en m'appuyant sur Ariane, une plateforme d'intelligence relationnelle que j'ai développée.\nMes clients veulent développer leur cabinet sans faire de prospection commerciale. Ils rencontrent beaucoup de monde, manquent de temps, et attendent d'Ariane qu'elle les aide à mieux exploiter leur réseau (clients, confrères, prescripteurs), sans rien changer à leur façon de travailler.\nC'est votre cas ? Si oui, je vous montre en 30 minutes comment cela fonctionne pour un cabinet d'avocats : https://calendly.com/nicolas-de-poix/rdv-ariane\nNicolas\nnicolas@ariane-pro.fr\n06 18 85 04 31",
  "CGP créateurs": "Bonjour {Prénom},\nMerci d'avoir accepté ma demande de mise en relation.\nJ'ai vu que vous aviez démarré votre activité récemment, j'espère que les débuts sont bons !\nPour un CGP qui se lance, la partie commerciale pèse lourd. Avez-vous aujourd'hui une organisation qui vous convient pour suivre vos prospects, vos clients et vos prescripteurs ?\nJ'ai développé Ariane, un outil qui simplifie la prospection et le suivi commercial, sans saisie.\nJe vous propose 30 minutes pour vous le montrer : https://calendly.com/nicolas-de-poix/rdv-ariane\nNicolas\n06 18 85 04 31",
  "M&A": "(test A/B, versions A et B gérées par la tâche programmée)",
};

const PROF = { Avocats: "avocat", EC: "expert-comptable", CGP: "cgp", "CGP créateurs": "cgp", Notaires: "notaire", "M&A": "conseil-ma" };

const slug = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
export const campaignIdFor = (name) => `li-${slug(name)}`;

function stateFor(r) {
  const replied = /a répondu/i.test(r.note || "");
  switch (r.statut) {
    case "a_inviter": case "a_visiter": case "a_verifier": case "visite":
      return { status: "queued", step: 0 };
    case "invite":
      return { status: "running", step: 1, inviteAt: r.date_invitation };
    case "accepte":
      return { status: "running", step: 1, inviteAt: r.date_invitation, acceptedAt: r.date_acceptation || "oui" };
    case "message_envoye":
      return { status: replied ? "replied" : "done", step: 2, inviteAt: r.date_invitation, acceptedAt: r.date_acceptation, messageAt: r.date_message };
    default:
      return { status: "done", step: 2, note: `${r.statut}${r.note ? ` : ${r.note}` : ""}`.slice(0, 300) };
  }
}

export async function importLinkedinRows(rows) {
  const now = Date.now();
  const names = [...new Set(rows.map((r) => r.campagne).filter(Boolean))];
  // campagnes
  for (const name of names) {
    const id = campaignIdFor(name);
    const prev = await redis.get(`camp:${id}`);
    if (!prev) {
      const c = {
        id, name: `LinkedIn · ${name}`, profession: PROF[name] || normProfession(name, "autre"),
        audience: { profession: PROF[name] || "autre", villes: "", motsCles: "", excludeContactedDays: 0, max: 0 },
        steps: [
          { id: "s1", type: "li_invite", delay: 0, subject: "", text: "" },
          { id: "s2", type: "li_message", delay: 1, subject: "", text: MESSAGES[name] || "(message géré par la tâche programmée)" },
        ],
        limits: { liPerDay: 20, liPerWeek: 100, mailPerDay: 0, mailRampPerWeek: 0, mailMax: 0, withdrawAfterDays: 21, bouncePause: 5, newPerDay: 20 },
        startDate: "2026-11-11", createdAt: now, updatedAt: now, status: "active", executor: "taches",
        channels: ["LinkedIn"], size: 0, validatedAt: now, frozenHash: "import",
      };
      await redis.set(`camp:${id}`, c);
      await redis.zadd("z:campaigns", { score: now, member: id });
    }
  }
  // campagnes déjà pilotées par l'application (hors simulation) : on ne réécrit pas leurs états
  const locked = new Set();
  for (const name of names) {
    const c = await redis.get(`camp:${campaignIdFor(name)}`);
    if (c?.executor === "app" && !c.dryRun) locked.add(name);
  }
  // contacts et états
  const p = redis.pipeline();
  let n = 0;
  for (const r of rows) {
    if (!r.user_id || !r.campagne || locked.has(r.campagne)) continue;
    const cid = "c_" + crypto.createHash("sha1").update(`u:${r.user_id}`).digest("hex").slice(0, 14);
    const campId = campaignIdFor(r.campagne);
    const [prenom, ...rest] = String(r.nom || "").trim().split(/\s+/);
    const profession = PROF[r.campagne] || "autre";
    const st = stateFor(r);
    p.hset(`c:${cid}`, {
      id: cid, prenom: prenom || "", nom: rest.join(" "), titre: r.titre || "", cabinet: r.structure && r.structure !== "?" ? r.structure : "",
      linkedin: r.profile_url || "", li_id: r.user_id, li_niveau: r.niveau || "", profession, sources: "Prospection_LinkedIn.csv",
      campagne: campId, statut: st.status === "replied" ? "repondu" : ["done"].includes(st.status) ? "contacte" : "en_campagne",
      dernier_contact: r.date_message || r.date_invitation || r.date_visite || "", created: now, updated: now,
    });
    p.set(`idx:liid:${r.user_id}`, cid);
    const m = String(r.profile_url || "").match(/linkedin\.com\/in\/([^/?#\s]+)/i);
    if (m) p.set(`idx:li:${decodeURIComponent(m[1]).toLowerCase()}`, cid);
    p.zadd("z:contacts", { score: now, member: cid });
    p.zadd(`z:prof:${profession}`, { score: now, member: cid });
    p.hset(`cm:${campId}:${cid}`, { ...st, liUserId: r.user_id });
    p.zrem(`camp:${campId}:queued`, cid);
    p.zrem(`camp:${campId}:due`, cid);
    p.srem(`camp:${campId}:done`, cid);
    if (st.status === "queued") p.zadd(`camp:${campId}:queued`, { score: n, member: cid });
    else if (st.status === "running") p.zadd(`camp:${campId}:due`, { score: now, member: cid });
    else p.sadd(`camp:${campId}:done`, cid);
    if (["queued", "running"].includes(st.status)) p.sadd("s:incampaign", cid);
    n++;
  }
  if (n) await p.exec();
  return { imported: n, campaigns: names.map(campaignIdFor) };
}

/** Recalcule les compteurs d'une campagne à partir de l'état de chaque contact. */
export async function recomputeStats(campId) {
  const ids = [
    ...(await redis.zrange(`camp:${campId}:queued`, 0, -1)),
    ...(await redis.zrange(`camp:${campId}:due`, 0, -1)),
    ...(await redis.smembers(`camp:${campId}:done`)),
  ];
  const p = redis.pipeline();
  ids.forEach((id) => p.hgetall(`cm:${campId}:${id}`));
  const states = ids.length ? await p.exec() : [];
  const s = { contacted: 0, invites: 0, accepted: 0, messages: 0, replies: 0, withdrawn: 0, emails: 0, mailed: 0, opens: 0, bounces: 0, stops: 0, meetings: 0 };
  const days = {};
  const bump = (day, k) => { if (day) days[`${day}|${k}`] = (days[`${day}|${k}`] || 0) + 1; };
  for (const st of states) {
    if (!st) continue;
    const dInv = toDay(st.inviteAt), dAcc = toDay(st.acceptedAt), dMsg = toDay(st.messageAt);
    if (st.inviteAt) { s.invites++; bump(dInv, "invites"); }
    if (st.acceptedAt) { s.accepted++; bump(dAcc || dInv, "accepted"); }
    if (st.messageAt) { s.messages++; bump(dMsg, "messages"); }
    if (st.inviteAt || st.messageAt) { s.contacted++; bump(dInv || dMsg, "contacted"); }
    if (st.status === "replied") { s.replies++; bump(dMsg, "replies"); }
    if (/retir/i.test(st.note || "")) s.withdrawn++;
  }
  await redis.del(`campstats:${campId}`, `cd:${campId}`);
  await redis.hset(`campstats:${campId}`, s);
  if (Object.keys(days).length) await redis.hset(`cd:${campId}`, days);
  const c = await redis.get(`camp:${campId}`);
  if (c) { c.size = ids.length; await redis.set(`camp:${campId}`, c); }
  return s;
}
