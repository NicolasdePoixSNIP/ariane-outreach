import { NextResponse } from "next/server";
import { setStatus } from "@/lib/campaigns";
export const runtime = "nodejs";
export async function POST(req, { params }) {
  const { id } = await params;
  const { status } = await req.json();
  if (!["active", "paused"].includes(status)) return NextResponse.json({ error: "Statut invalide" }, { status: 400 });
  try {
    return NextResponse.json(await setStatus(id, status, status === "paused" ? "mise en pause manuelle" : ""));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
