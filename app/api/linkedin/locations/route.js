import { NextResponse } from "next/server";
import { linkedinLocations } from "@/lib/lots";

export const runtime = "nodejs";

export async function GET(req) {
  const q = new URL(req.url).searchParams.get("q") || "";
  if (q.trim().length < 2) return NextResponse.json({ data: [] });
  try {
    return NextResponse.json({ data: await linkedinLocations(q.trim()) });
  } catch (e) {
    return NextResponse.json({ error: e.message, data: [] }, { status: 400 });
  }
}
