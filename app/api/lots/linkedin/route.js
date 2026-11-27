import { NextResponse } from "next/server";
import { linkedinSearchToLot, newLotId } from "@/lib/lots";
import { PROFESSIONS } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 120;

// Recherche LinkedIn (URL collée ou critères saisis) → contacts ajoutés à la base et au lot de la campagne.
export async function POST(req) {
  try {
    const b = await req.json();
    const lotId = /^lot_[a-f0-9]{10}$/.test(b.lotId || "") ? b.lotId : newLotId();
    const profession = PROFESSIONS.some((p) => p.id === b.profession) ? b.profession : "autre";
    let url = "", criteria = null;
    if (b.mode === "url") {
      url = String(b.url || "").trim();
      if (!/^https:\/\/www\.linkedin\.com\/search\/results\/people/.test(url)) throw new Error("L’URL doit être une recherche de personnes LinkedIn (https://www.linkedin.com/search/results/people/…)");
    } else {
      const k = b.criteria || {};
      criteria = {};
      if (k.keywords) criteria.keywords = String(k.keywords).slice(0, 200);
      if (Array.isArray(k.location) && k.location.length) criteria.location = k.location.slice(0, 10);
      if (Array.isArray(k.network_distance) && k.network_distance.length) criteria.network_distance = k.network_distance;
      const adv = {};
      if (k.title) adv.title = String(k.title).slice(0, 120);
      if (k.company) adv.company = String(k.company).slice(0, 120);
      if (Object.keys(adv).length) criteria.advanced_keywords = adv;
      if (!Object.keys(criteria).length) throw new Error("Indiquez au moins un critère de recherche");
    }
    const pages = Math.min(10, Math.max(1, Number(b.pages) || 5));
    const res = await linkedinSearchToLot({ lotId, url, criteria, cursor: b.cursor, pages, profession });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
