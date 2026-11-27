import { NextResponse } from "next/server";
import { upsertContacts, PROFESSIONS } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req) {
  try {
    const body = await req.json();
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : [];
    const profession = PROFESSIONS.some((p) => p.id === body.profession) ? body.profession : "autre";
    const mode = body.mode === "exclusion" ? "exclusion" : "contacts";
    const exclusion = body.exclusion === "client" ? "client" : "stop";
    const source = String(body.source || "import").slice(0, 60);
    const res = await upsertContacts(rows, { profession, source, mode, exclusion });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
