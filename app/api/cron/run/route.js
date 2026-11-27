import { NextResponse } from "next/server";
import { runEngine } from "@/lib/engine";
export const runtime = "nodejs";
export const maxDuration = 300;
// Appelée chaque jour ouvré par Vercel Cron (en-tête Authorization: Bearer CRON_SECRET).
export async function GET(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }
  try {
    const r = await runEngine({ trigger: "cron" });
    return NextResponse.json({ ok: true, mode: r.mode, actions: r.log.length });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
