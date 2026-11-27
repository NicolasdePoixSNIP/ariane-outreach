export const STATUS = {
  draft: { label: "Brouillon", cls: "p-draft" },
  to_validate: { label: "À valider", cls: "p-val" },
  active: { label: "Active", cls: "p-on" },
  paused: { label: "En pause", cls: "p-pause" },
  done: { label: "Terminée", cls: "p-draft" },
};

export function StatusPill({ status }) {
  const s = STATUS[status] || STATUS.draft;
  return <span className={`pill ${s.cls}`}>{s.label}</span>;
}

export const n = (v) => Number(v || 0);
export const fmt = (v) => n(v).toLocaleString("fr-FR");
export const pct = (a, b) => (n(b) ? `${(Math.round((n(a) * 1000) / n(b)) / 10).toLocaleString("fr-FR")} %` : "—");

export function SetupNeeded() {
  return (
    <div className="alert">
      <div>
        <b>Base de données non connectée.</b> Ajoutez la base Upstash Redis au projet dans Vercel
        (Storage, puis Upstash), puis redéployez. Les écrans se rempliront ensuite.
      </div>
    </div>
  );
}
