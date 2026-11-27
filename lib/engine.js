import { redis } from "./redis";
import { unipile, unipileConfigured } from "./unipile";
import { getContacts, normEmail } from "./store";
import { logEvent } from "./campaigns";
import { render, salutation } from "./templates";
import { track } from "./metrics";

const LI = () => process.env.UNIPILE_LINKEDIN_ACCOUNT_ID || "acc_01m876t0xxfahtc4pwnqsfty88";
const MAIL = () => process.env.UNIPILE_MAIL_ACCOUNT_ID || "acc_01m8eky509fzt9kcqmemvkznxm";
const FROM_EMAIL = () => process.env.MAIL_FROM || "nicolas@arianebusiness.fr";
const FROM_NAME = () => process.env.MAIL_FROM_NAME || "Nicolas de Poix";

// ---------- dates (Europe/Paris), jours ouvrés, fêtes ----------

export function parisDate(d = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris" }).format(d); // AAAA-MM-JJ
}
function isHoliday(iso) {
  const md = iso.slice(5);
  return md >= "12-24" || md <= "01-01" || ["05-01", "05-08", "07-14", "08-15", "11-01", "11-11"].includes(md);
}
export function isBusinessDay(iso) {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6 && !isHoliday(iso);
}
export function addBusinessDays(iso, n) {
  let d = new Date(`${iso}T12:00:00Z`);
  let left = Math.max(0, n);
  if (left === 0) return iso;
  while (left > 0) {
    d = new Date(d.getTime() + 864e5);
    if (isBusinessDay(d.toISOString().slice(0, 10))) left--;
  }
  return d.toISOString().slice(0, 10);
}
const dayTs = (iso) => new Date(`${iso}T00:00:00Z`).getTime();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- configuration ----------

export async function engineMode() {
  return (await redis.get("cfg:engine")) || "simulation"; // off | simulation | on
}

async function counter(kind, date) {
  return Number((await redis.get(`cnt:${kind}:${date}`)) || 0);
}
async function bump(kind, date) {
  await redis.incr(`cnt:${kind}:${date}`);
  await redis.expire(`cnt:${kind}:${date}`, 60 * 60 * 24 * 40);
}

/** Invitations LinkedIn des 7 derniers jours : nos envois, ou les invitations en attente du compte si plus élevé. */
async function linkedinWeekCount(today, ctx) {
  let own = 0;
  for (let i = 0; i < 7; i++) own += await counter("li", parisDate(new Date(dayTs(today) - i * 864e5 + 12 * 36e5)));
  const since = Date.now() - 7 * 864e5;
  const recent = [...ctx.pending.values()].filter((x) => new Date(x.created_at).getTime() >= since).length;
  return Math.max(own, recent);
}

/**
 * Lecture LinkedIn faite UNE fois par exécution (économise le quota Unipile de ~100 profils/jour) :
 * invitations en attente et relations récentes.
 */
async function loadLinkedinContext(log) {
  const ctx = { pending: new Map(), relations: new Set(), ok: false, profileBudget: 50 };
  try {
    let cursor;
    for (let page = 0; page < 5; page++) {
      const r = await unipile(`/${LI()}/users/me/relation-requests`, { query: { type: "sent", limit: 100, cursor } });
      for (const x of r.data || []) if (x.user?.id) ctx.pending.set(x.user.id, x);
      cursor = r.cursor || r.next_cursor;
      if (!cursor || !(r.data || []).length) break;
    }
    const rel = await unipile(`/${LI()}/users/me/relations`, { query: { limit: 100 } });
    for (const x of rel.data || []) { const id = x.id || x.user_id || x.member_id; if (id) ctx.relations.add(id); }
    ctx.ok = true;
  } catch (e) {
    log.push(`Lecture LinkedIn impossible (${e.message}) : aucune action LinkedIn aujourd'hui.`);
  }
  return ctx;
}

async function mailDailyCap(limits, today) {
  let first = await redis.get("cfg:mailFirstDate");
  if (!first) return limits.mailPerDay;
  const weeks = Math.floor((dayTs(today) - dayTs(first)) / (7 * 864e5));
  return Math.min(limits.mailMax, limits.mailPerDay + weeks * limits.mailRampPerWeek);
}

// ---------- appels Unipile ----------

function publicId(url) {
  const m = String(url || "").match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m ? m[1] : "";
}

async function liProfile(contact, ctx, withExperience = false) {
  const id = contact.li_id || publicId(contact.linkedin);
  if (!id) return null;
  if (ctx && ctx.profileBudget <= 0) throw new Error("quota de profils du jour atteint");
  if (ctx) ctx.profileBudget--;
  const p = await unipile(`/${LI()}/users/${encodeURIComponent(id)}`, withExperience ? { query: { with_sections: "linkedin_experience_preview" } } : {});
  const exp = p.work_experience || p.experience || p.experiences || p.linkedin_experience || [];
  const cur = (Array.isArray(exp) ? exp : []).find((e) => !e.end && !e.end_date) || (Array.isArray(exp) ? exp[0] : null);
  return {
    userId: p.id, distance: p.specifics?.network_distance || p.network_distance || "",
    location: p.location || "", headline: p.description || p.headline || "",
    companyId: cur?.company_id || cur?.company?.id || "", companyName: cur?.company || cur?.company_name || cur?.company?.name || "",
  };
}

async function companyHeadcount(companyId) {
  if (!companyId) return null;
  try {
    const c = await unipile(`/${LI()}/linkedin/company/${encodeURIComponent(companyId)}`);
    const h = c.insights?.headcount ?? c.insights?.headcount_range?.from ?? c.employee_count ?? null;
    return h == null ? null : Number(h);
  } catch {
    return null;
  }
}

/** Règles de qualification d'une campagne (avant invitation). Renvoie un motif d'exclusion, ou "". */
async function qualify(c, contact, prof, notes) {
  const q = c.qualify;
  if (!q) return "";
  const rxOf = (list) => {
    const parts = String(list || "").split(/[,;\n]/).map((x) => x.trim()).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return parts.length ? parts.join("|") : "";
  };
  const locationRx = q.locationRx || rxOf(q.locations);
  const titleExcludeRx = q.titleExcludeRx || rxOf(q.titleExclude);
  if (prof.distance === "FIRST_DEGREE" && !q.allowFirstDegree) return "déjà en relation";
  if (q.secondDegreeOnly && prof.distance && !["SECOND_DEGREE", ...(q.allowFirstDegree ? ["FIRST_DEGREE"] : [])].includes(prof.distance)) return "hors 2e niveau";
  if (locationRx && prof.location && !new RegExp(locationRx, "i").test(prof.location)) return `localisation hors zone (${prof.location})`;
  const title = prof.headline || contact.titre || "";
  if (titleExcludeRx && new RegExp(titleExcludeRx, "i").test(title)) return `poste exclu (${title.slice(0, 60)})`;
  if (q.titleRx && title && !new RegExp(q.titleRx, "i").test(title)) return `poste hors cible (${title.slice(0, 60)})`;
  if (q.maxHeadcount) {
    const h = await companyHeadcount(prof.companyId);
    if (h == null) notes.push("taille non vérifiable");
    else if (h > q.maxHeadcount) return `cabinet de ${h} personnes`;
  }
  return "";
}

async function liInvite(userId, message) {
  const body = { user_id: userId };
  if (message) body.message = message.slice(0, 300);
  return unipile(`/${LI()}/users/me/relation-requests`, { method: "POST", body });
}

async function liWithdraw(userId) {
  // Parcourt les invitations envoyées (paginées) pour retrouver celle du contact,
  // puis l'annule par la même route que la tâche « Retrait des invitations ».
  let cursor;
  for (let page = 0; page < 10; page++) {
    const r = await unipile(`/${LI()}/users/me/relation-requests`, { query: { type: "sent", limit: 100, cursor } });
    const req = (r.data || []).find((x) => x.user?.id === userId);
    if (req) {
      await unipile(`/${LI()}/users/me/relation-requests/${encodeURIComponent(req.id)}/cancel`, { method: "POST" });
      return true;
    }
    cursor = r.cursor || r.next_cursor;
    if (!cursor || !(r.data || []).length) break;
  }
  return false;
}

// Démarre une conversation 1-à-1 depuis la boîte LinkedIn classique
// (POST /{acc}/inboxes/CLASSIC_PRIMARY/chats/send — doc Unipile v2 « Start a Chat from Inbox »).
async function liMessage(userId, text) {
  return unipile(`/${LI()}/inboxes/CLASSIC_PRIMARY/chats/send`, { method: "POST", body: { users_ids: userId, text } });
}

const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Version HTML sobre (texte + liens cliquables), nécessaire au pixel d'ouverture Unipile.
const toHtml = (t) => `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#222">${esc(t)
  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
  .replace(/\n/g, "<br>")}</div>`;

async function sendMail(contact, subject, text, replyToId, tracking) {
  const name = [contact.prenom, contact.nom].filter(Boolean).join(" ");
  const body = {
    from: { email: FROM_EMAIL(), display_name: FROM_NAME() },
    to: [{ email: contact.email, ...(name ? { display_name: name } : {}) }],
    subject,
    plain_text: text,
  };
  if (tracking) {
    body.html = toHtml(text);
    body.tracking_options = { opens: true, clicks: false, label: tracking };
  }
  if (replyToId) body.reply_to_provider_id = replyToId;
  return unipile(`/${MAIL()}/emails/send`, { method: "POST", body });
}

// ---------- synchronisation des réponses ----------

const BOUNCE_RX = /(mailer-daemon|postmaster|delivery status notification|undeliver|non remis|échec de (la )?remise|delivery failure|returned mail)/i;

async function markReply(contactId, channel, text) {
  const [contact] = await getContacts([contactId]);
  if (!contact?.campagne) return null;
  const cid = contact.campagne;
  const st = await redis.hgetall(`cm:${cid}:${contactId}`);
  if (!st || ["replied", "stopped", "bounced"].includes(st.status)) return null;
  const isStop = /^\s*(stop|non merci|désinscri|ne plus)/i.test(text || "");
  const camp = await redis.get(`camp:${cid}`);
  await redis.hset(`cm:${cid}:${contactId}`, { status: isStop ? "stopped" : "replied", repliedAt: Date.now() });
  await redis.zrem(`camp:${cid}:due`, contactId);
  await redis.sadd(`camp:${cid}:done`, contactId);
  await track(cid, "replies");
  if (isStop) {
    await track(cid, "stops");
    await redis.sadd("s:excl:stop", contactId);
    await redis.hset(`c:${contactId}`, { statut: "stop" });
  } else {
    await redis.hset(`c:${contactId}`, { statut: "repondu" });
  }
  return logEvent({
    type: "reply", campaignId: cid, campaignName: camp?.name, contactId, channel,
    contactName: [contact.prenom, contact.nom].filter(Boolean).join(" ") || contact.email,
    text: String(text || "").split("\n").find((l) => l.trim() && !l.startsWith(">"))?.slice(0, 280) || "",
    stop: isStop, handled: false,
  });
}

async function markBounce(contactId, reason) {
  const [contact] = await getContacts([contactId]);
  if (!contact?.campagne) return;
  const cid = contact.campagne;
  await redis.hset(`cm:${cid}:${contactId}`, { status: "bounced" });
  await redis.zrem(`camp:${cid}:due`, contactId);
  await redis.sadd(`camp:${cid}:done`, contactId);
  await track(cid, "bounces");
  await redis.hset(`c:${contactId}`, { email_statut: "refus" });
  await logEvent({ type: "bounce", campaignId: cid, contactId, channel: "Mail", text: reason });
}

export async function syncReplies(log) {
  if (!unipileConfigured) return;
  const now = new Date().toISOString();
  // mails
  try {
    const since = (await redis.get("cfg:lastMailSync")) || new Date(Date.now() - 2 * 864e5).toISOString();
    const r = await unipile(`/${MAIL()}/emails`, { query: { after: since, limit: 100 } });
    for (const m of r.data || []) {
      const from = normEmail(m.from?.[0]?.email || m.from_attendee?.identifier);
      if (!from || from === FROM_EMAIL()) continue;
      const body = m.body_plain || m.snippet || "";
      if (BOUNCE_RX.test(`${from} ${m.subject}`)) {
        const addrs = [...new Set((body.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) || []).map(normEmail))].filter((a) => a && a !== FROM_EMAIL());
        for (const a of addrs) {
          const cid = await redis.get(`idx:email:${a}`);
          if (cid) { await markBounce(cid, m.subject); log.push(`Refus : ${a}`); }
        }
        continue;
      }
      const cid = await redis.get(`idx:email:${from}`);
      if (cid && (await markReply(cid, "Mail", body))) log.push(`Réponse mail : ${from}`);
    }
    await redis.set("cfg:lastMailSync", now);
  } catch (e) {
    log.push(`Synchro mail impossible : ${e.message}`);
  }
  // LinkedIn
  try {
    const since = new Date((await redis.get("cfg:lastLiSync")) || Date.now() - 2 * 864e5).getTime();
    const r = await unipile(`/${LI()}/inboxes/CLASSIC_PRIMARY/chats`, { query: { limit: 25 } });
    for (const chat of r.data || []) {
      const lm = chat.last_message;
      if (!lm || lm.is_sender || new Date(lm.timestamp).getTime() <= since) continue;
      const cid = await redis.get(`idx:liid:${chat.user_id || chat.user?.id}`);
      if (cid && (await markReply(cid, "LinkedIn", lm.text))) log.push(`Réponse LinkedIn : ${chat.user?.name}`);
    }
    await redis.set("cfg:lastLiSync", now);
  } catch (e) {
    log.push(`Synchro LinkedIn impossible : ${e.message}`);
  }
}

// ---------- exécution d'une étape ----------

async function advance(c, contactId, st, today, patch = {}) {
  const next = Number(st.step || 0) + 1;
  if (next >= c.steps.length) {
    await redis.hset(`cm:${c.id}:${contactId}`, { ...patch, step: next, status: "done" });
    await redis.zrem(`camp:${c.id}:due`, contactId);
    await redis.sadd(`camp:${c.id}:done`, contactId);
    await redis.srem("s:incampaign", contactId);
    return;
  }
  const due = addBusinessDays(today, c.steps[next].delay || 1);
  await redis.hset(`cm:${c.id}:${contactId}`, { ...patch, step: next, status: "running", due });
  await redis.zadd(`camp:${c.id}:due`, { score: dayTs(due), member: contactId });
}

async function exclude(c, contactId, why, log, name) {
  await redis.hset(`cm:${c.id}:${contactId}`, { status: "done", note: why });
  await redis.zrem(`camp:${c.id}:due`, contactId);
  await redis.sadd(`camp:${c.id}:done`, contactId);
  await redis.srem("s:incampaign", contactId);
  if (log) log.push(`Exclu : ${name} (${why})`);
}

async function runStep(c, contact, st, today, budget, log, ctx) {
  const k = Number(st.step || 0);
  const step = c.steps[k];
  if (!step) return advance(c, contact.id, st, today);
  const name = `${salutation(contact) || contact.email}`;
  const first = !st.contactedAt;
  const markContacted = async () => {
    if (first) await track(c.id, "contacted");
    await redis.hset(`c:${contact.id}`, { dernier_contact: today });
  };

  if (step.type === "li_invite") {
    if (!contact.linkedin && !contact.li_id) return advance(c, contact.id, st, today);
    if (!ctx.ok || budget.li <= 0 || ctx.campInvites[c.id] >= (c.limits.invitesPerDay || Infinity)) return "budget";
    let userId = contact.li_id || st.liUserId || "";
    const notes = [];
    // Profil lu seulement s'il faut qualifier ou si l'identifiant LinkedIn est inconnu.
    if (c.qualify || !userId) {
      // contact issu d'une recherche LinkedIn récente : niveau, lieu et titre sont déjà connus, pas de lecture de profil
      const known = c.qualify && contact.li_id && contact.li_niveau && !c.qualify.maxHeadcount;
      const prof = known
        ? { userId: contact.li_id, distance: contact.li_niveau, location: contact.ville || "", headline: contact.titre || "" }
        : await liProfile(contact, ctx, Boolean(c.qualify?.maxHeadcount));
      if (!prof?.userId) return advance(c, contact.id, st, today);
      userId = prof.userId;
      await redis.set(`idx:liid:${userId}`, contact.id);
      const why = await qualify(c, contact, prof, notes);
      if (why) return exclude(c, contact.id, why, log, name);
      if ((!c.qualify || c.qualify.allowFirstDegree) && prof.distance === "FIRST_DEGREE") return advance(c, contact.id, st, today, { liUserId: userId, acceptedAt: Date.now() });
    } else if (ctx.relations.has(userId)) {
      return c.qualify && !c.qualify.allowFirstDegree ? exclude(c, contact.id, "déjà en relation", log, name) : advance(c, contact.id, st, today, { liUserId: userId, acceptedAt: Date.now() });
    }
    if (!ctx.pending.has(userId)) {
      try {
        await liInvite(userId, render(step.text, contact, c.id));
      } catch (e) {
        if (/already|déjà|connected|relation/i.test(e.message)) return exclude(c, contact.id, "déjà en relation", log, name);
        throw e;
      }
      budget.li--; await bump("li", today);
      ctx.campInvites[c.id] = (ctx.campInvites[c.id] || 0) + 1;
      ctx.pending.set(userId, { created_at: new Date().toISOString() });
      await track(c.id, "invites");
      await markContacted();
      log.push(`Invitation : ${name}${notes.length ? ` (${notes.join(", ")})` : ""}`);
    }
    return advance(c, contact.id, st, today, { liUserId: userId, inviteAt: st.inviteAt || Date.now(), contactedAt: st.contactedAt || Date.now(), ...(notes.length ? { note: notes.join(", ") } : {}) });
  }

  if (step.type === "li_message") {
    if (!st.liUserId) return advance(c, contact.id, st, today);
    if (!ctx.ok) return "budget";
    if (!st.acceptedAt) {
      if (ctx.relations.has(st.liUserId)) {
        st.acceptedAt = Date.now();
        await redis.hset(`cm:${c.id}:${contact.id}`, { acceptedAt: st.acceptedAt });
        await track(c.id, "accepted");
        log.push(`Acceptation : ${name}`);
        // message au prochain passage (environ un jour ouvré après l'acceptation)
        const due = addBusinessDays(today, 1);
        await redis.zadd(`camp:${c.id}:due`, { score: dayTs(due), member: contact.id });
        await redis.hset(`cm:${c.id}:${contact.id}`, { due });
        return;
      }
      const inv = ctx.pending.get(st.liUserId);
      const age = inv ? Date.now() - new Date(inv.created_at).getTime() : st.inviteAt ? Date.now() - Number(new Date(isNaN(st.inviteAt) ? st.inviteAt : Number(st.inviteAt))) : 0;
      if (inv && age > c.limits.withdrawAfterDays * 864e5) {
        await liWithdraw(st.liUserId).catch(() => false);
        await track(c.id, "withdrawn");
        log.push(`Invitation retirée : ${name}`);
        return exclude(c, contact.id, "invitation retirée sans réponse", null, name);
      }
      if (!inv && ctx.relations.size) {
        // ni en attente ni dans les 100 dernières relations : acceptée plus tôt ou refusée ; on vérifie le profil (quota)
        const prof = await liProfile(contact, ctx).catch(() => null);
        if (prof?.distance === "FIRST_DEGREE") {
          st.acceptedAt = Date.now();
          await redis.hset(`cm:${c.id}:${contact.id}`, { acceptedAt: st.acceptedAt });
          await track(c.id, "accepted");
        } else if (prof) {
          return exclude(c, contact.id, "invitation refusée ou retirée", null, name);
        }
      }
      if (!st.acceptedAt) {
        const due = addBusinessDays(today, 1);
        await redis.zadd(`camp:${c.id}:due`, { score: dayTs(due), member: contact.id });
        await redis.hset(`cm:${c.id}:${contact.id}`, { due });
        return;
      }
    }
    // anti-doublon : une conversation existe déjà avec un message
    try {
      const chat = await unipile(`/${LI()}/users/${encodeURIComponent(st.liUserId)}/chat`);
      if (chat && (chat.id || chat.chat_id) && (chat.last_message || chat.messages_count > 0)) {
        return exclude(c, contact.id, "déjà en conversation", log, name);
      }
    } catch { /* pas de conversation */ }
    await liMessage(st.liUserId, render(step.text, contact, c.id));
    await track(c.id, "messages");
    await markContacted();
    await redis.hset(`cm:${c.id}:${contact.id}`, { messageAt: today });
    log.push(`Message LinkedIn : ${name}`);
    return advance(c, contact.id, st, today);
  }

  if (step.type === "email") {
    if (!contact.email || contact.email_statut === "refus") return advance(c, contact.id, st, today);
    if (budget.mail <= 0) return "budget";
    const subject = render(step.subject, contact, c.id) || "(sans objet)";
    const res = await sendMail(contact, st.firstEmailId ? (subject.startsWith("Re:") ? subject : `Re: ${subject}`) : subject, render(step.text, contact, c.id), st.firstEmailId,
      c.trackOpens === false ? null : `${c.id}|${contact.id}`);
    budget.mail--; await bump("mail", today);
    if (!(await redis.get("cfg:mailFirstDate"))) await redis.set("cfg:mailFirstDate", today);
    await track(c.id, "emails");
    if (!st.firstEmailId) await track(c.id, "mailed");
    await markContacted();
    log.push(`Mail : ${contact.email}`);
    return advance(c, contact.id, st, today, { firstEmailId: st.firstEmailId || res.id || "", lastMailAt: Date.now(), contactedAt: st.contactedAt || Date.now() });
  }
}

// ---------- boucle principale ----------

export async function runEngine({ trigger = "cron" } = {}) {
  const today = parisDate();
  const mode = await engineMode();
  const log = [];
  const report = { at: Date.now(), today, mode, trigger, campaigns: [], log };
  if (mode === "off") { log.push("Moteur arrêté."); return saveReport(report); }
  if (!isBusinessDay(today)) { log.push("Jour non ouvré : aucun envoi."); return saveReport(report); }
  if (!unipileConfigured) { log.push("Clé Unipile absente."); return saveReport(report); }

  await syncReplies(log);

  const ids = await redis.zrange("z:campaigns", 0, -1);
  const campaigns = (await Promise.all(ids.map((id) => redis.get(`camp:${id}`)))).filter((c) => c?.status === "active" && c.startDate <= today && c.executor !== "taches");

  const usesLi = campaigns.some((c) => c.steps.some((x) => x.type.startsWith("li_")));
  const ctx = usesLi ? await loadLinkedinContext(log) : { ok: false, pending: new Map(), relations: new Set(), profileBudget: 0 };
  ctx.campInvites = {};
  const liWeek = await linkedinWeekCount(today, ctx);
  const liToday = await counter("li", today);
  const mailToday = await counter("mail", today);
  const limits = campaigns[0]?.limits || { liPerDay: 20, liPerWeek: 100, mailPerDay: 15, mailRampPerWeek: 5, mailMax: 50 };
  const budget = {
    li: Math.max(0, Math.min(limits.liPerDay - liToday, limits.liPerWeek - liWeek)),
    mail: Math.max(0, (await mailDailyCap(limits, today)) - mailToday),
  };
  log.push(`Budget du jour : ${budget.li} invitations LinkedIn (semaine : ${liWeek}/${limits.liPerWeek}), ${budget.mail} mails.`);

  for (const c of campaigns) {
    const before = log.length;
    // 1. étapes dues
    const due = await redis.zrange(`camp:${c.id}:due`, 0, dayTs(today), { byScore: true });
    // 2. nouveaux contacts
    // on prend un peu plus de nouveaux contacts que le quota, car certains seront exclus à la qualification
    const nFresh = c.qualify ? Math.min(30, 3 * (c.limits.invitesPerDay || 10)) : c.limits.newPerDay || 20;
    const fresh = await redis.zrange(`camp:${c.id}:queued`, 0, Math.max(0, nFresh - 1));
    const queue = [...due.map((id) => ({ id, fresh: false })), ...fresh.map((id) => ({ id, fresh: true }))];
    const contacts = Object.fromEntries((await getContacts(queue.map((q) => q.id))).map((x) => [x.id, x]));
    let sent = 0;
    for (const q of queue) {
      const contact = contacts[q.id];
      if (!contact) continue;
      const st = (await redis.hgetall(`cm:${c.id}:${q.id}`)) || { step: 0 };
      if (["replied", "stopped", "bounced", "done"].includes(st.status)) { await redis.zrem(`camp:${c.id}:due`, q.id); continue; }
      if (mode === "simulation" || c.dryRun) {
        const step = c.steps[Number(st.step || 0)];
        const who = salutation(contact) || contact.email || contact.nom;
        const uid = contact.li_id || st.liUserId;
        let what = step ? step.type : "fin";
        if (step?.type === "li_invite") what = ctx.relations.has(uid) ? "déjà en relation : exclu" : ctx.pending.has(uid) ? "invitation déjà en attente" : `invitation${c.qualify ? " (après qualification)" : ""}`;
        if (step?.type === "li_message") what = st.acceptedAt || ctx.relations.has(uid) ? "message" : ctx.pending.has(uid) ? "attente d'acceptation" : "à vérifier (ni en attente ni en relation récente)";
        log.push(`[simulation] ${c.name} · ${what} · ${who}`);
        continue;
      }
      try {
        if (q.fresh) await redis.zrem(`camp:${c.id}:queued`, q.id);
        const r = await runStep(c, contact, st, today, budget, log, ctx);
        if (r === "budget") {
          if (q.fresh) await redis.zadd(`camp:${c.id}:queued`, { score: -1, member: q.id });
          continue;
        }
        sent++;
        await sleep(1500 + Math.random() * 2500);
      } catch (e) {
        log.push(`Erreur ${c.name} · ${contact.email || contact.id} : ${e.message}`);
        if (q.fresh) await redis.zadd(`camp:${c.id}:queued`, { score: -1, member: q.id });
        if (/40[13]|restrict|limit/i.test(e.message)) { budget.li = 0; }
      }
    }
    // 3. garde-fou : taux de refus mail
    const s = (await redis.hgetall(`campstats:${c.id}`)) || {};
    const emails = Number(s.emails || 0), bounces = Number(s.bounces || 0);
    if (emails >= 20 && (bounces * 100) / emails > (c.limits.bouncePause || 5)) {
      c.status = "paused";
      c.pauseReason = `taux de refus mail de ${Math.round((bounces * 1000) / emails) / 10} %`;
      await redis.set(`camp:${c.id}`, c);
      await logEvent({ type: "paused", campaignId: c.id, campaignName: c.name, text: c.pauseReason });
      log.push(`Pause automatique : ${c.name} (${c.pauseReason})`);
    }
    report.campaigns.push({ id: c.id, name: c.name, actions: log.length - before, sent });
  }
  return saveReport(report);
}

async function saveReport(report) {
  await redis.set("engine:last", report);
  await redis.lpush("engine:runs", { at: report.at, mode: report.mode, trigger: report.trigger, n: report.log.length });
  await redis.ltrim("engine:runs", 0, 59);
  return report;
}
