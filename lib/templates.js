// Rendu des modèles : {Prénom} {Nom} {Cabinet} {Ville} {Civilité} {LienVideo} {LienArticle}
const SITE = "https://www.ariane-pro.fr";

export function civilite(contact) {
  return ["avocat", "notaire"].includes(contact.profession) ? "Maître" : "";
}

export function salutation(contact) {
  const civ = civilite(contact);
  const nom = titleCase(contact.nom);
  if (civ) return nom ? `${civ} ${nom}` : civ;
  const prenom = titleCase(contact.prenom);
  return prenom || "";
}

export function titleCase(s) {
  const v = String(s || "").trim();
  if (!v) return "";
  if (v !== v.toUpperCase() && v !== v.toLowerCase()) return v;
  return v.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
}

export function trackedLink(path, campaignId, contactId) {
  const u = new URL(path, SITE);
  u.searchParams.set("utm_source", "arianebusiness");
  u.searchParams.set("utm_medium", "outreach");
  u.searchParams.set("utm_campaign", campaignId);
  u.searchParams.set("utm_content", contactId);
  return u.toString();
}

export function render(text, contact, campaignId = "apercu") {
  const vars = {
    "Prénom": titleCase(contact.prenom),
    Prenom: titleCase(contact.prenom),
    Nom: titleCase(contact.nom),
    Cabinet: contact.cabinet || "",
    Ville: titleCase(contact.ville),
    "Civilité": civilite(contact),
    Salutation: salutation(contact),
    LienVideo: trackedLink("/video", campaignId, contact.id || "apercu"),
    LienArticle: trackedLink("/ressources/reseau-inexploite-premier-levier-de-croissance", campaignId, contact.id || "apercu"),
  };
  return String(text || "")
    .replace(/\{([^{}]+)\}/g, (m, k) => (k in vars ? vars[k] : m))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/ {2,}/g, " ")
    .replace(/ +([,.])/g, "$1")
    .trim();
}

export const VARIABLES = ["{Salutation}", "{Prénom}", "{Nom}", "{Cabinet}", "{Ville}", "{LienVideo}", "{LienArticle}"];
