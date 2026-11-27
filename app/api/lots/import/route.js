import { NextResponse } from "next/server";
import { addToLot, newLotId } from "@/lib/lots";
import { PROFESSIONS } from "@/lib/store";

export const runtime = "nodejs";

// Import d'un fichier pour une campagne : fusion dans la base + rattachement au lot de la campagne.
export async function POST(req) {
  try {
    const b = await req.json();
    const lotId = /^lot_[a-f0-9]{10}$/.test(b.lotId || "") ? b.lotId : newLotId();
    const profession = PROFESSIONS.some((p) => p.id === b.profession) ? b.profession : "autre";
    const rows = Array.isArray(b.rows) ? b.rows.slice(0, 1000) : [];
    const res = await addToLot(lotId, rows, { profession, source: String(b.source || "fichier campagne").slice(0, 60) });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
