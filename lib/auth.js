// Jeton de session : empreinte SHA-256 du mot de passe d'accès.
// Changer APP_PASSWORD dans Vercel déconnecte toutes les sessions.
export const COOKIE = "ao_session";

export async function sessionToken(password = (process.env.APP_PASSWORD || "").trim()) {
  const data = new TextEncoder().encode(`ariane-outreach:${password}`);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
