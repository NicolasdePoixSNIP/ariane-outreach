import crypto from "node:crypto";

// Jeton du webhook Unipile, dérivé de CRON_SECRET (aucune variable de plus à créer dans Vercel).
export function webhookToken() {
  const base = process.env.CRON_SECRET || process.env.APP_PASSWORD || "";
  return base ? crypto.createHash("sha256").update(`unipile-webhook:${base}`).digest("hex").slice(0, 32) : "";
}

const BOT_UA = /(bot|crawl|spider|scanner|preview|proofpoint|mimecast|barracuda|symantec|messagelabs|trendmicro|forcepoint|python|curl|wget|headless)/i;

/** Vrai si l'ouverture ressemble à un robot (antispam, aperçu de sécurité) plutôt qu'à une lecture. */
export function looksLikeBot(payload, sentAt) {
  if (payload?.potentially_bot === true) return true;
  if (BOT_UA.test(payload?.user_agent || "")) return true;
  const t = new Date(payload?.date || Date.now()).getTime();
  return Boolean(sentAt && t - Number(sentAt) < 20_000); // ouverture moins de 20 s après l'envoi : scanner
}
