import { NextResponse } from "next/server";
import { importLinkedinRows, recomputeStats } from "@/lib/linkedinImport";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req) {
  try {
    const body = await req.json();
    if (body.finalize) {
      const out = {};
      for (const id of body.campaigns || []) out[id] = await recomputeStats(id);
      return NextResponse.json(out);
    }
    return NextResponse.json(await importLinkedinRows((body.rows || []).slice(0, 300)));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
