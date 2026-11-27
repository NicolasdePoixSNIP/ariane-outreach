import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";
export const runtime = "nodejs";
export async function POST(req) {
  const form = await req.formData();
  const mode = String(form.get("mode"));
  if (!["off", "simulation", "on"].includes(mode)) return NextResponse.json({ error: "Mode invalide" }, { status: 400 });
  await redis.set("cfg:engine", mode);
  return NextResponse.redirect(new URL("/parametres", req.url), 303);
}
