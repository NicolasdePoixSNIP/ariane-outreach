import { NextResponse } from "next/server";
import { runEngine } from "@/lib/engine";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST() {
  try {
    return NextResponse.json(await runEngine({ trigger: "manuel" }));
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
