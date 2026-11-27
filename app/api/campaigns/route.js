import { NextResponse } from "next/server";
import { saveCampaign } from "@/lib/campaigns";
export const runtime = "nodejs";
export async function POST(req) {
  try {
    const c = await saveCampaign(await req.json());
    return NextResponse.json(c);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
