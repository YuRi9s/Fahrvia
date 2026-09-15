"use client";
import Link from "next/link";
import { AuditPanel } from "./audit-panel";
import { AssignmentBoard } from "./assignment-board";
import { AccountsPanel } from "./accounts-panel";
import { InvitationsPanel } from "./invitations-panel";
import { MessagesPanel } from "./messages-panel";
import { allowed } from "@/server/policy";
import { useState, useSyncExternalStore } from "react";
import {
  IconLayoutDashboard,
  IconUsers,
  IconTruck,
  IconKey,
  IconCalendar,
  IconClock,
  IconBox,
  IconChartBar,
  IconFiles,
  IconMessage,
  IconBell,
  IconUser,
  IconPhoto,
  IconRoute,
  IconArrowsExchange,
  IconMoon,
  IconMenu2,
  IconLogout,
} from "@tabler/icons-react";
import type { Principal } from "@/server/policy";
import { de } from "@/messages/de";
import { authClient } from "@/lib/auth-client";
import { Dashboard } from "./dashboard";
import { ModuleTable } from "./module-table";
const icons = {
  dashboard: IconLayoutDashboard,
  drivers: IconUsers,
  vehicles: IconTruck,
  assignments: IconArrowsExchange,
  keys: IconKey,
  photos: IconPhoto,
  planning: IconCalendar,
  waves: IconRoute,
  "work-times": IconClock,
  inventory: IconBox,
  score: IconChartBar,
  documents: IconFiles,
  reports: IconChartBar,
  messages: IconMessage,
  notifications: IconBell,
  profile: IconUser,
  categories: IconBox,
  invitations: IconUsers,
  accounts: IconUsers,
  audit: IconFiles,
};
function readTheme() {
  return localStorage.getItem("fahriva-theme") === "dark";
}
function subscribeTheme(callback: () => void) {
  const sync = () => {
    document.documentElement.dataset.theme = readTheme() ? "dark" : "light";
    callback();
  };
  sync();
  window.addEventListener("storage", sync);
  window.addEventListener("fahriva-theme", sync);
  return () => {
    window.removeEventListener("storage", sync);
    window.removeEventListener("fahriva-theme", sync);
  };
}
export function Workspace({
  principal,
  module,
  initialData,
  initialQuery = "",
}: {
  principal: Principal;
  module: string;
  initialData?: unknown;
  initialQuery?: string;
}) {
  const [menu, setMenu] = useState(false);
  const dark = useSyncExternalStore(subscribeTheme, readTheme, () => false);
  const [error, setError] = useState("");
  const isDriver = principal.role === "DRIVER";
  function theme() {
    const next = !dark;
    localStorage.setItem("fahriva-theme", next ? "dark" : "light");
    document.documentElement.dataset.theme = next ? "dark" : "light";
    window.dispatchEvent(new Event("fahriva-theme"));
  }
  async function logout() {
    try {
      await authClient.signOut();
      window.location.assign("/login");
    } catch {
      setError(de.error);
    }
  }
  const modules = isDriver
    ? [
        "dashboard",
        "vehicles",
        "assignments",
        "score",
        "documents",
        "photos",
        "work-times",
        "messages",
        "profile",
      ]
    : Object.keys(de.modules).filter(
        (key) => key !== "profile" && allowed(principal, key, "read"),
      );
  return (
    <div className={`app-shell ${menu ? "menu-open" : ""}`}>
      <Link className="skip-link" href="#main">
        {de.modules.dashboard}
      </Link>
      <aside className="sidebar">
        <Link className="brand" href="/dashboard">
          <span className="logo-mark" aria-hidden="true">
            F
          </span>
          {de.brand}
          <span className="brand-dot" />
        </Link>
        <div className="org-label">{principal.organizationName}</div>
        <nav aria-label={de.operations}>
          {modules.map((key, index) => {
            const Icon = icons[key as keyof typeof icons] || IconBox;
            return (
              <div key={key}>
                {index === 0 && <p className="nav-label">{de.operations}</p>}
                {!isDriver && key === "reports" && (
                  <p className="nav-label">{de.administration}</p>
                )}
                <Link
                  href={`/${key}`}
                  className={module === key ? "nav-item active" : "nav-item"}
                  aria-current={module === key ? "page" : undefined}
                >
                  <Icon size={20} stroke={1.7} />
                  <span>{de.modules[key as keyof typeof de.modules]}</span>
                </Link>
              </div>
            );
          })}
        </nav>
        <Link className="account" href="/profile">
          <span className="avatar">
            {principal.name.slice(0, 2).toUpperCase()}
          </span>
          <span>
            <strong>{principal.name}</strong>
            <small>{de.values[principal.role]}</small>
          </span>
          <span>↗</span>
        </Link>
      </aside>
      {menu && (
        <button
          className="menu-backdrop"
          onClick={() => setMenu(false)}
          aria-label={de.close}
        />
      )}
      <div className="main-column">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMenu(!menu)}
            aria-label={de.menu}
          >
            <IconMenu2 size={22} />
          </button>
          <span className="breadcrumb">
            {de.operations}
            <span>/</span>
            <strong>
              {de.modules[module as keyof typeof de.modules] || module}
            </strong>
          </span>
          <div className="topbar-actions">
            <button
              className="icon-button"
              onClick={theme}
              aria-label={de.theme}
            >
              <IconMoon size={20} />
            </button>
            <Link
              className="icon-button"
              href="/notifications"
              aria-label={de.modules.notifications}
            >
              <IconBell size={20} />
            </Link>
            <details className="account-menu">
              <summary className="avatar small" aria-label={de.profile}>
                {principal.name.slice(0, 2).toUpperCase()}
              </summary>
              <div className="account-popover">
                <strong>{principal.name}</strong>
                <p>{principal.email}</p>
                <small>{de.values[principal.role]}</small>
                <Link className="button" href="/profile">
                  {de.profile}
                </Link>
                <button onClick={theme}>{de.theme}</button>
                <button onClick={logout}>{de.logout}</button>
              </div>
            </details>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <p className="eyebrow">{principal.organizationName}</p>
              <h1>{de.modules[module as keyof typeof de.modules] || module}</h1>
            </div>
            <span className="workspace-status">
              <span className="dot" />
              {de.private}
            </span>
          </div>
          {error && (
            <p role="alert" className="alert error">
              {error}
            </p>
          )}
          {module === "dashboard" ? (
            <Dashboard initialData={initialData} />
          ) : module === "profile" ? (
            <section className="panel profile-panel">
              <div className="avatar large">
                {principal.name.slice(0, 2).toUpperCase()}
              </div>
              <h2>{principal.name}</h2>
              <p>{principal.email}</p>
              <dl className="detail-list">
                <div>
                  <dt>{de.organization}</dt>
                  <dd>{principal.organizationName}</dd>
                </div>
                <div>
                  <dt>{de.role}</dt>
                  <dd>{de.values[principal.role]}</dd>
                </div>
              </dl>
              <div className="profile-links">
                {["score", "assignments", "documents"].map((key) => (
                  <Link className="button" key={key} href={`/${key}`}>
                    {de.modules[key as keyof typeof de.modules]} ↗
                  </Link>
                ))}
                <Link className="button" href="/security">
                  {de.security}
                </Link>
                <button onClick={theme}>{de.theme}</button>
                <button onClick={logout}>
                  <IconLogout size={16} />
                  {de.logout}
                </button>
              </div>
            </section>
          ) : module === "assignments" && !isDriver ? (
            <AssignmentBoard
              initialData={initialData}
              initialQuery={initialQuery}
            />
          ) : module === "audit" ? (
            <AuditPanel
              key={initialQuery}
              initialData={initialData}
              initialQuery={initialQuery}
            />
          ) : module === "accounts" ? (
            <AccountsPanel
              initialData={initialData}
              currentUserId={principal.userId}
              isSuperAdmin={principal.role === "SUPER_ADMIN"}
            />
          ) : module === "invitations" ? (
            <InvitationsPanel
              initialData={initialData}
              isSuperAdmin={principal.role === "SUPER_ADMIN"}
            />
          ) : module === "messages" ? (
            <MessagesPanel currentUserId={principal.userId} />
          ) : (
            <ModuleTable
              ownDriverId={
                isDriver ? (principal.driverId ?? undefined) : undefined
              }
              initialQuery={initialQuery}
              key={`${module}:${initialQuery}`}
              module={module}
              initialData={initialData}
              isDriver={isDriver}
              isAdmin={["ADMIN", "SUPER_ADMIN"].includes(principal.role)}
            />
          )}
        </main>
        <footer className="app-footer">
          {de.brand} <span>{de.tagline}</span>
        </footer>
      </div>
      {isDriver && (
        <nav className="bottom-nav">
          {(["dashboard", "vehicles", "profile"] as const).map((key) => {
            const Icon = icons[key];
            return (
              <Link
                href={`/${key}`}
                key={key}
                className={module === key ? "active" : ""}
              >
                <Icon size={22} />
                {de.modules[key]}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
