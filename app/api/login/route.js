import { NextResponse } from "next/server";
import { COOKIE, sessionToken } from "@/lib/auth";

export async function POST(req) {
  const form = await req.formData();
  const password = String(form.get("password") || "");
  const expected = process.env.APP_PASSWORD || "";
  const url = new URL("/", req.url);
  if (!expected || password !== expected) {
    return NextResponse.redirect(new URL("/login?erreur=1", req.url), 303);
  }
  const res = NextResponse.redirect(url, 303);
  res.cookies.set(COOKIE, await sessionToken(expected), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
