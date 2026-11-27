"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import Icon from "./Icon";

const ITEMS = [
  { href: "/", icon: "home", label: "Tour de contrôle" },
  { href: "/campagnes", icon: "camp", label: "Campagnes" },
  { href: "/nouvelle", icon: "plus", label: "Nouvelle campagne" },
  { href: "/contacts", icon: "users", label: "Contacts et audiences" },
  { href: "/parametres", icon: "gear", label: "Paramètres" },
];

export default function Sidebar() {
  const path = usePathname();
  if (path === "/login") return null;
  const active = (href) => (href === "/" ? path === "/" : path.startsWith(href));
  return (
    <aside className="side">
      <div className="brand">
        <img src="/logo.svg" width="34" height="34" alt="" />
        <div>
          <div className="wm">Ariane</div>
          <div className="bl">Outreach</div>
        </div>
      </div>
      <nav className="nav" aria-label="Navigation principale">
        {ITEMS.map((it) => (
          <Link key={it.href} href={it.href} className={active(it.href) ? "on" : ""}>
            <Icon name={it.icon} />
            <span>{it.label}</span>
          </Link>
        ))}
      </nav>
      <div className="sys">
        <b>Ariane Outreach</b>
        <span>Prospection LinkedIn et mail des cabinets.</span>
        <form action="/api/logout" method="post">
          <button className="logout" type="submit">Se déconnecter</button>
        </form>
      </div>
    </aside>
  );
}
