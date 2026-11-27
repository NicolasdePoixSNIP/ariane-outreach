import { NextResponse } from "next/server";
import { validateCampaign } from "@/lib/campaigns";
export const runtime = "nodejs";
export const maxDuration = 120;
export async function POST(req, { params }) {
  const { id } = await params;
  try {
    return NextResponse.json(await validateCampaign(id));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
