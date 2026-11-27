// Analyse CSV simple (séparateur ; ou , détecté), guillemets gérés.
export function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || "";
  const sep = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

const ALIASES = {
  email: ["email", "e-mail", "mail", "adresse email", "courriel"],
  prenom: ["prenom", "prénom", "first name", "firstname"],
  nom: ["nom", "last name", "lastname", "nom de famille"],
  cabinet: ["cabinet", "societe", "société", "entreprise", "company", "raison sociale"],
  ville: ["ville", "city", "commune"],
  titre: ["titre", "poste", "fonction", "headline", "title"],
  linkedin: ["linkedin", "url linkedin", "profil linkedin", "linkedin url", "profile url"],
  profession: ["profession", "métier", "metier"],
};

export function mapColumns(header) {
  const norm = header.map((h) => h.trim().toLowerCase());
  const map = {};
  for (const [field, names] of Object.entries(ALIASES)) {
    const idx = norm.findIndex((h) => names.includes(h));
    if (idx >= 0) map[field] = idx;
  }
  return map;
}
