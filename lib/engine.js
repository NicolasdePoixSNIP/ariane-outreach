import { redis } from "./redis";
import { unipile, unipileConfigured } from "./unipile";
import { getContacts, normEmail } from "./store";
import { logEvent } from "./campaigns";
import { render, salutation } from "./templates";

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
async function linkedinWeekCount(today) {
  let own = 0;
  for (let i = 0; i < 7; i++) own += await counter("li", parisDate(new Date(dayTs(today) - i * 864e5 + 12 * 36e5)));
  let pending = 0;
  try {
    const since = Date.now() - 7 * 864e5;
    let cursor;
    for (let page = 0; page < 3; page++) {
      const r = await unipile(`/${LI()}/users/me/relation-requests`, { query: { type: "sent", limit: 100, cursor } });
      const items = r.data || [];
      const recent = items.filter((x) => new Date(x.created_at).getTime() >= since);
      pending += recent.length;
      if (recent.length < items.length || !r.next_cursor) break;
      cursor = r.next_cursor;
    }
  } catch {
    /* compte LinkedIn non joignable : on se fie à nos compteurs */
  }
  return Math.max(own, pending);
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

async function liProfile(contact) {
  const id = contact.li_id || publicId(contact.linkedin);
  if (!id) return null;
  const p = await unipile(`/${LI()}/users/${encodeURIComponent(id)}`);
  return { userId: p.id, distance: p.specifics?.network_distance || p.network_distance || "" };
}

async function liInvite(userId, message) {
  const body = { user_id: userId };
  if (message) body.message = message.slice(0, 300);
  return unipile(`/${LI()}/users/me/relation-requests`, { method: "POST", body });
}

async function liWithdraw(userId) {
  const r = await unipile(`/${LI()}/users/me/relation-requests`, { query: { type: "sent", limit: 100 } });
  const req = (r.data || []).find((x) => x.user?.id === userId);
  if (req) await unipile(`/${LI()}/users/me/relation-requests/${encodeURIComponent(req.id)}`, { method: "DELETE" });
  return Boolean(req);
}

async function liMessage(userId, text) {
  return unipile(`/${LI()}/chats`, { method: "POST", body: { attendees_ids: [userId], text } });
}

async function sendMail(contact, subject, text, replyToId) {
  const name = [contact.prenom, contact.nom].filter(Boolean).join(" ");
  const body = {
    from: { email: FROM_EMAIL(), display_name: FROM_NAME() },
    to: [{ email: contact.email, ...(name ? { display_name: name } : {}) }],
    subject,
    plain_text: text,
  };
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
  await redis.hincrby(`campstats:${cid}`, "replies", 1);
  if (isStop) {
    await redis.hincrby(`campstats:${cid}`, "stops", 1);
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
  await redis.hincrby(`campstats:${cid}`, "bounces", 1);
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

async function runStep(c, contact, st, today, budget, log) {
  const k = Number(st.step || 0);
  const step = c.steps[k];
  if (!step) return advance(c, contact.id, st, today);
  const name = `${salutation(contact) || contact.email}`;
  const first = !st.contactedAt;
  const markContacted = async () => {
    if (first) await redis.hincrby(`campstats:${c.id}`, "contacted", 1);
    await redis.hset(`c:${contact.id}`, { dernier_contact: today });
  };

  if (step.type === "li_invite") {
    if (!contact.linkedin) return advance(c, contact.id, st, today);
    if (budget.li <= 0) return "budget";
    const prof = await liProfile(contact);
    if (!prof?.userId) return advance(c, contact.id, st, today);
    await redis.set(`idx:liid:${prof.userId}`, contact.id);
    if (prof.distance === "FIRST_DEGREE") {
      return advance(c, contact.id, st, today, { liUserId: prof.userId, acceptedAt: Date.now() });
    }
    await liInvite(prof.userId, render(step.text, contact, c.id));
    budget.li--; await bump("li", today);
    await redis.hincrby(`campstats:${c.id}`, "invites", 1);
    await markContacted();
    log.push(`Invitation : ${name}`);
    return advance(c, contact.id, st, today, { liUserId: prof.userId, inviteAt: Date.now(), contactedAt: st.contactedAt || Date.now() });
  }

  if (step.type === "li_message") {
    if (!st.liUserId) return advance(c, contact.id, st, today);
    if (!st.acceptedAt) {
      const prof = await liProfile(contact);
      if (prof?.distance === "FIRST_DEGREE") {
        st.acceptedAt = Date.now();
        await redis.hset(`cm:${c.id}:${contact.id}`, { acceptedAt: st.acceptedAt });
        await redis.hincrby(`campstats:${c.id}`, "accepted", 1);
      } else if (st.inviteAt && Date.now() - Number(st.inviteAt) > c.limits.withdrawAfterDays * 864e5) {
        await liWithdraw(st.liUserId).catch(() => false);
        await redis.hincrby(`campstats:${c.id}`, "withdrawn", 1);
        log.push(`Invitation retirée : ${name}`);
        await redis.hset(`cm:${c.id}:${contact.id}`, { status: "done", note: "invitation retirée" });
        await redis.zrem(`camp:${c.id}:due`, contact.id);
        await redis.sadd(`camp:${c.id}:done`, contact.id);
        await redis.srem("s:incampaign", contact.id);
        return;
      } else {
        const due = addBusinessDays(today, 1);
        await redis.zadd(`camp:${c.id}:due`, { score: dayTs(due), member: contact.id });
        await redis.hset(`cm:${c.id}:${contact.id}`, { due });
        return;
      }
    }
    await liMessage(st.liUserId, render(step.text, contact, c.id));
    await redis.hincrby(`campstats:${c.id}`, "messages", 1);
    await markContacted();
    log.push(`Message LinkedIn : ${name}`);
    return advance(c, contact.id, st, today);
  }

  if (step.type === "email") {
    if (!contact.email || contact.email_statut === "refus") return advance(c, contact.id, st, today);
    if (budget.mail <= 0) return "budget";
    const subject = render(step.subject, contact, c.id) || "(sans objet)";
    const res = await sendMail(contact, st.firstEmailId ? (subject.startsWith("Re:") ? subject : `Re: ${subject}`) : subject, render(step.text, contact, c.id), st.firstEmailId);
    budget.mail--; await bump("mail", today);
    if (!(await redis.get("cfg:mailFirstDate"))) await redis.set("cfg:mailFirstDate", today);
    await redis.hincrby(`campstats:${c.id}`, "emails", 1);
    await markContacted();
    log.push(`Mail : ${contact.email}`);
    return advance(c, contact.id, st, today, { firstEmailId: st.firstEmailId || res.id || "", contactedAt: st.contactedAt || Date.now() });
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

  const liWeek = await linkedinWeekCount(today);
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
    const fresh = await redis.zrange(`camp:${c.id}:queued`, 0, Math.max(0, (c.limits.newPerDay || 20) - 1));
    const queue = [...due.map((id) => ({ id, fresh: false })), ...fresh.map((id) => ({ id, fresh: true }))];
    const contacts = Object.fromEntries((await getContacts(queue.map((q) => q.id))).map((x) => [x.id, x]));
    let sent = 0;
    for (const q of queue) {
      const contact = contacts[q.id];
      if (!contact) continue;
      const st = (await redis.hgetall(`cm:${c.id}:${q.id}`)) || { step: 0 };
      if (["replied", "stopped", "bounced", "done"].includes(st.status)) { await redis.zrem(`camp:${c.id}:due`, q.id); continue; }
      if (mode === "simulation") {
        const step = c.steps[Number(st.step || 0)];
        log.push(`[simulation] ${c.name} · ${step ? step.type : "fin"} · ${salutation(contact) || contact.email}`);
        continue;
      }
      try {
        if (q.fresh) await redis.zrem(`camp:${c.id}:queued`, q.id);
        const r = await runStep(c, contact, st, today, budget, log);
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
