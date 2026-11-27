// Client minimal de l'API Unipile V2. La clé est lue dans les variables d'environnement Vercel.
const BASE = process.env.UNIPILE_BASE_URL || "https://api.unipile.com/v2";

export const unipileConfigured = Boolean(process.env.UNIPILE_API_KEY);

export async function unipile(path, { method = "GET", body, query } = {}) {
  if (!unipileConfigured) throw new Error("Clé Unipile non configurée");
  const url = new URL(BASE.replace(/\/$/, "") + path);
  if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, String(v)));
  const res = await fetch(url, {
    method,
    headers: { "X-API-KEY": process.env.UNIPILE_API_KEY, accept: "application/json", ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`Unipile ${res.status} : ${data?.title || data?.detail || text.slice(0, 200)}`);
  return data;
}
