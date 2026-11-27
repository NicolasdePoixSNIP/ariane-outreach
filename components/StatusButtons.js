"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function StatusButtons({ id, status }) {
  const router = useRouter();
  const [err, setErr] = useState("");
  async function go(next) {
    setErr("");
    const r = await fetch(`/api/campaigns/${id}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: next }) });
    const j = await r.json();
    if (!r.ok) setErr(j.error); else router.refresh();
  }
  return (
    <>
      {status === "active" ? <button className="btn" type="button" onClick={() => go("paused")}>Mettre en pause</button> : null}
      {status === "paused" ? <button className="btn pri" type="button" onClick={() => go("active")}>Reprendre</button> : null}
      {err ? <span className="err" style={{ padding: "8px 12px" }}>{err}</span> : null}
    </>
  );
}
