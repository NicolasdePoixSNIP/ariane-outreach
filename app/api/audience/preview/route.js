import { NextResponse } from "next/server";
import { resolveAudience, DEFAULT_AUDIENCE } from "@/lib/campaigns";
import { render } from "@/lib/templates";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(req) {
  try {
    const c = await req.json();
    c.audience = { ...DEFAULT_AUDIENCE, ...(c.audience || {}) };
    c.steps = c.steps || [];
    const { contacts, reasons, total } = await resolveAudience(c);
    const sample = contacts[0] || { prenom: "Anne", nom: "DURAND", cabinet: "Cabinet Durand", ville: "PARIS", profession: c.audience.profession, id: "apercu" };
    return NextResponse.json({
      count: contacts.length,
      retained: Math.min(contacts.length, Number(c.audience.max) || 300),
      withEmail: contacts.filter((x) => x.email).length,
      withLinkedin: contacts.filter((x) => x.linkedin).length,
      reasons, total,
      sample: { name: [sample.prenom, sample.nom].filter(Boolean).join(" "), cabinet: sample.cabinet },
      list: contacts.slice(0, Math.min(Number(c.audience.max) || 300, 500)).map((x) => ({
        id: x.id, nom: [x.prenom, x.nom].filter(Boolean).join(" "), titre: x.titre || "", cabinet: x.cabinet || "", ville: x.ville || "",
        email: Boolean(x.email), linkedin: x.linkedin || "", niveau: x.li_niveau || "",
      })),
      removed: (c.audience.removed || []).length,
      previews: c.steps.map((s) => ({ subject: render(s.subject, sample), text: render(s.text, sample) })),
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}
