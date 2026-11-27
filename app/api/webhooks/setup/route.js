import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { unipile } from "@/lib/unipile";
import { webhookToken } from "@/lib/webhook";

export const dynamic = "force-dynamic";

// Déclare (une seule fois) le webhook Unipile qui remonte les ouvertures de mails.
export async function POST(req) {
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const url = `https://${host}/api/webhooks/unipile?k=${webhookToken()}`;
  try {
    const existing = await redis.get("cfg:webhookId");
    if (existing) return NextResponse.redirect(new URL("/parametres?webhook=deja", req.url), 303);
    const r = await unipile(`/webhooks/endpoints/`, {
      method: "POST",
      body: { url, trigger_events: ["tracking.open"], account_ids: [process.env.UNIPILE_MAIL_ACCOUNT_ID || "acc_01m8eky509fzt9kcqmemvkznxm"], description: "Ariane Outreach — ouvertures de mails" },
    });
    await redis.set("cfg:webhookId", r.id || "ok");
    return NextResponse.redirect(new URL("/parametres?webhook=ok", req.url), 303);
  } catch (e) {
    return NextResponse.redirect(new URL(`/parametres?webhook=${encodeURIComponent(e.message.slice(0, 120))}`, req.url), 303);
  }
}
