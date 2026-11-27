import { NextResponse } from "next/server";
import { getCampaign } from "@/lib/campaigns";
export const runtime = "nodejs";
export async function GET(req, { params }) {
  const { id } = await params;
  const c = await getCampaign(id);
  return c ? NextResponse.json(c) : NextResponse.json({ error: "Introuvable" }, { status: 404 });
}
