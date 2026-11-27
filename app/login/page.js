export const metadata = { title: "Connexion · Ariane Outreach" };

export default async function Login({ searchParams }) {
  const sp = await searchParams;
  return (
    <div style={{ maxWidth: 420, margin: "10vh auto 0", width: "100%" }}>
      <div className="card" style={{ padding: 32 }}>
        <div className="brand" style={{ padding: 0, marginBottom: 24 }}>
          <img src="/logo.svg" width="40" height="40" alt="" />
          <div><div className="wm">Ariane</div><div className="bl">Outreach</div></div>
        </div>
        <h1 style={{ fontSize: 26 }}>Connexion</h1>
        <p className="lead" style={{ marginBottom: 20 }}>Tour de contrôle des campagnes de prospection.</p>
        {sp?.erreur ? <p className="err" style={{ marginBottom: 16 }}>Mot de passe incorrect.</p> : null}
        <form action="/api/login" method="post" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label className="lbl" htmlFor="pw">Mot de passe</label>
          <input id="pw" className="field" type="password" name="password" autoComplete="current-password" required />
          <button className="btn pri" type="submit" style={{ justifyContent: "center", marginTop: 8 }}>Se connecter</button>
        </form>
      </div>
    </div>
  );
}
