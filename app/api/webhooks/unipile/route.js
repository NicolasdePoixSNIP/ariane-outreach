import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { track, parisDay } from "@/lib/metrics";
import { webhookToken, looksLikeBot } from "@/lib/webhook";

export const dynamic = "force-dynamic";

// Reçoit les événements Unipile (tracking.open). Protégé par le jeton dans l'URL.
export async function POST(req) {
  const k = new URL(req.url).searchParams.get("k");
  if (!webhookToken() || k !== webhookToken()) return NextResponse.json({ error: "Jeton invalide" }, { status: 401 });
  const ev = await req.json().catch(() => null);
  if (ev?.type !== "tracking.open") return NextResponse.json({ ok: true, ignored: ev?.type || null });
  const p = ev.payload || {};
  const [campId, contactId] = String(p.label || "").split("|");
  if (!campId || !contactId) return NextResponse.json({ ok: true, ignored: "label" });
  const st = (await redis.hgetall(`cm:${campId}:${contactId}`)) || {};
  if (looksLikeBot(p, st.lastMailAt)) {
    await redis.hincrby(`campstats:${campId}`, "botOpens", 1);
    return NextResponse.json({ ok: true, bot: true });
  }
  const first = await redis.sadd(`camp:${campId}:opened`, contactId);
  if (first) {
    await track(campId, "opens", 1, parisDay(new Date(p.date || Date.now())));
    await redis.hset(`cm:${campId}:${contactId}`, { openedAt: Date.now() });
  }
  return NextResponse.json({ ok: true, first: Boolean(first) });
}
