"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useState } from "react";

const NAV = [
  {
    id: "dashboard", label: "Dashboard", href: "/",
    icon: <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>,
  },
  {
    id: "agents", label: "Agents", href: "/agents",
    icon: <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M12 2a4 4 0 0 1 4 4v1h1a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-1v1a4 4 0 0 1-8 0v-1H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1V6a4 4 0 0 1 4-4z"/><path d="M9 14h6"/><circle cx="9.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="14.5" cy="10.5" r=".5" fill="currentColor"/></svg>,
  },
  {
    id: "recommendations", label: "Recommendations", href: "/recommendations",
    icon: <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>,
  },
  {
    id: "team", label: "Team", href: "/team",
    icon: <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>,
  },
  {
    id: "evals", label: "Evals", href: "/evals",
    icon: <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  },
  {
    id: "setup", label: "Setup", href: "/setup",
    icon: <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>,
  },
  {
    id: "settings", label: "Settings", href: "/settings",
    icon: <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  },
];

function isActive(pathname: string, id: string) {
  if (id === "dashboard") return pathname === "/";
  if (id === "agents") return pathname.startsWith("/agents");
  return pathname.startsWith("/" + id);
}

export default function Sidebar() {
  const pathname = usePathname() ?? "";
  const { data: session } = useSession();
  const [collapsed, setCollapsed] = useState(false);

  const name  = session?.user?.name  ?? "User";
  const email = session?.user?.email ?? "";
  const initials = name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase();

  const toggle = () => {
    setCollapsed((c) => !c);
    const shell = document.getElementById("tr-shell");
    if (shell) shell.classList.toggle("collapsed");
  };

  return (
    <aside className={`tr-sidebar${collapsed ? " collapsed" : ""}`}>
      {/* Brand */}
      <div className="tr-brand">
        <button
          className="tr-brand-logo"
          onClick={collapsed ? toggle : undefined}
          style={{ cursor: collapsed ? "pointer" : "default" }}
          aria-label={collapsed ? "Expand sidebar" : undefined}
        >
          {collapsed ? (
            <img src="/traeco-icon.png" alt="Traeco" style={{ height: 28, width: "auto", objectFit: "contain" }} />
          ) : (
            <img src="/traeco-logo.png" alt="Traeco" style={{ height: 30, width: "auto", objectFit: "contain", maxWidth: 160 }} />
          )}
        </button>
        {!collapsed && (
          <button className="tr-collapse-btn" onClick={toggle} aria-label="Collapse sidebar">
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/>
            </svg>
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="tr-nav">
        {NAV.map((item) => {
          const active = isActive(pathname, item.id);
          return (
            <Link
              key={item.id}
              href={item.href}
              className={`tr-nav-item${active ? " active" : ""}`}
              title={collapsed ? item.label : undefined}
            >
              <span className="tr-nav-icon">{item.icon}</span>
              {!collapsed && item.label}
            </Link>
          );
        })}
      </nav>

      {/* User */}
      <div className="tr-user">
        <div
          className="tr-avatar"
          style={{ background: "linear-gradient(135deg,#1BA86F,#2DD4BF)" }}
        >
          {initials}
        </div>
        {!collapsed && (
          <div className="tr-user-text">
            <div className="tr-user-name">{name}</div>
            <div className="tr-user-email">{email}</div>
          </div>
        )}
        {!collapsed && (
          <button
            className="tr-icon-btn"
            onClick={() => signOut({ callbackUrl: "/signin" })}
            title="Sign out"
            style={{ marginLeft: "auto", fontSize: 14 }}
          >
            <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        )}
      </div>
    </aside>
  );
}
