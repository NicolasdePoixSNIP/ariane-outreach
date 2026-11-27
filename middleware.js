import { NextResponse } from "next/server";
import { COOKIE, sessionToken } from "./lib/auth";

const PUBLIC = ["/login", "/api/login", "/api/cron", "/api/webhooks/unipile"];

export async function middleware(req) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname.startsWith(p))) return NextResponse.next();
  if (!process.env.APP_PASSWORD) {
    return new NextResponse("APP_PASSWORD n'est pas configuré dans Vercel.", { status: 503 });
  }
  const ok = req.cookies.get(COOKIE)?.value === (await sessionToken());
  if (ok) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Non connecté" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/((?!_next/|favicon.svg|logo.svg).*)"] };
