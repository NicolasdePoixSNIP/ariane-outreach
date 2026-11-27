import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
import { logEvent } from "@/lib/campaigns";

export const dynamic = "force-dynamic";

// Règles reprises de la tâche « Séquence LinkedIn Avocats Paris » (sans le jugement au cas par cas).
const PRESETS = {
  "li-avocats": {
    qualify: {
      secondDegreeOnly: true,
      locationRx: "paris|[iî]le-de-france|hauts-de-seine|yvelines|essonne|val-de-marne|val-d.oise|seine-saint-denis|seine-et-marne|neuilly|boulogne|levallois|versailles|saint-cloud|nanterre|courbevoie|puteaux",
      titleExcludeRx: "collaborat|counsel|juriste|stagiaire|[ée]l[èe]ve.avocat|paralegal|assistant|retrait|honoraire",
      maxHeadcount: 10,
    },
    limits: { invitesPerDay: 10, withdrawAfterDays: 21 },
  },
};

export async function POST(req, { params }) {
  const { id } = await params;
  const form = await req.formData();
  const action = form.get("action");
  const c = await redis.get(`camp:${id}`);
  if (!c) return NextResponse.json({ error: "Campagne introuvable" }, { status: 404 });
  if (action === "simuler") {
    const p = PRESETS[id] || {};
    Object.assign(c, { executor: "app", dryRun: true, qualify: c.qualify || p.qualify || null, limits: { ...c.limits, ...(p.limits || {}) }, startDate: c.startDate });
  } else if (action === "reel") {
    c.dryRun = false;
  } else if (action === "taches") {
    c.executor = "taches";
    c.dryRun = false;
  }
  c.updatedAt = Date.now();
  await redis.set(`camp:${id}`, c);
  await logEvent({ type: "info", campaignId: id, campaignName: c.name, text: `Bascule : ${action}` });
  return NextResponse.redirect(new URL(`/campagnes/${id}`, req.url), 303);
}
