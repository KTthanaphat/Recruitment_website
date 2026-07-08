"use client";

import {
  BriefcaseBusiness,
  ClipboardList,
  FileClock,
  HandCoins,
  LayoutDashboard,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ShieldCheck,
  Settings,
  Home,
  UsersRound
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { ROLE_LABELS, VIEWS } from "@/lib/constants";
import { translate, viewLabel } from "@/lib/i18n/dictionary";
import type { Language, Profile, ViewId } from "@/types/recruitment";

const icons: Record<ViewId, ReactNode> = {
  home: <Home size={18} />,
  dashboard: <LayoutDashboard size={18} />,
  requisitions: <ClipboardList size={18} />,
  candidates: <UsersRound size={18} />,
  pipeline: <PipelineStagesIcon />,
  offers: <HandCoins size={18} />,
  sourcing: <Settings size={18} />,
  admin: <ShieldCheck size={18} />,
  audit: <FileClock size={18} />
};

const paths: Record<ViewId, string> = {
  home: "/home",
  dashboard: "/dashboard",
  requisitions: "/requisitions",
  candidates: "/candidates",
  pipeline: "/pipeline",
  offers: "/offers",
  sourcing: "/sourcing",
  admin: "/admin",
  audit: "/audit"
};

const kicker: Record<ViewId, string> = {
  home: "Work Queue",
  dashboard: "Vacancy Analytics",
  requisitions: "Hiring Demand",
  candidates: "Talent Records",
  pipeline: "Process Board",
  offers: "Hiring Outcome",
  sourcing: "Jobsite Sourcing",
  admin: "System Control",
  audit: "History"
};

function PipelineStagesIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true" focusable="false">
      <path d="M4 5h10M4 9h10M4 13h10" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="4" cy="5" r="2" fill="currentColor" />
      <circle cx="14" cy="9" r="2" fill="currentColor" />
      <circle cx="4" cy="13" r="2" fill="currentColor" />
    </svg>
  );
}

export function AppShell({
  children,
  language,
  onLanguageChange,
  onRefresh,
  onSignOut,
  profile,
  activeView
}: {
  children: ReactNode;
  language: Language;
  onLanguageChange: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  profile: Profile | null;
  activeView: ViewId;
}) {
  const pathname = usePathname();
  const accountName = profile?.nickname ?? profile?.full_name ?? profile?.email ?? "Unknown";
  const visibleViews = VIEWS.filter((view) => view !== "admin" || profile?.role === "system_admin");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarPreferenceLoaded, setSidebarPreferenceLoaded] = useState(false);

  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem("recruitment_sidebar_collapsed") === "true");
    setSidebarPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (!sidebarPreferenceLoaded) return;
    localStorage.setItem("recruitment_sidebar_collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed, sidebarPreferenceLoaded]);

  return (
    <main className={`grid min-h-screen grid-cols-1 bg-offwhite ${sidebarCollapsed ? "lg:grid-cols-[72px_minmax(0,1fr)]" : "lg:grid-cols-[248px_minmax(0,1fr)]"}`}>
      <aside className={`bg-navy px-4 py-4 text-white lg:sticky lg:top-0 lg:h-screen lg:py-5 ${sidebarCollapsed ? "lg:px-3" : ""}`}>
        <div className={`mb-4 flex items-start gap-3 px-2 lg:mb-7 ${sidebarCollapsed ? "lg:justify-center lg:px-0" : "lg:block"}`}>
          <div className={sidebarCollapsed ? "lg:hidden" : ""}>
            <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-cool">Internal Recruitment</p>
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-normal text-white">Recruitment</h1>
              <button
                type="button"
                className="hidden size-9 shrink-0 place-items-center rounded-md text-lightgray transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/70 lg:grid"
                aria-label="Collapse sidebar"
                title="Collapse sidebar"
                onClick={() => setSidebarCollapsed(true)}
              >
                <PanelLeftClose size={18} />
              </button>
            </div>
          </div>
          {sidebarCollapsed ? (
            <button
              type="button"
              className="hidden size-9 shrink-0 place-items-center rounded-md text-lightgray transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/70 lg:grid"
              aria-label="Expand sidebar"
              title="Expand sidebar"
              onClick={() => setSidebarCollapsed(false)}
            >
              <PanelLeftOpen size={18} />
            </button>
          ) : null}
        </div>

        <nav aria-label="Main navigation" className="grid grid-flow-col gap-1.5 overflow-x-auto pb-1 lg:grid-flow-row lg:overflow-visible lg:pb-0">
          {visibleViews.map((view) => {
            const active = pathname === paths[view] || activeView === view;
            return (
              <Link
                key={view}
                href={paths[view]}
                aria-label={viewLabel(language, view)}
                title={viewLabel(language, view)}
                className={`flex min-h-11 min-w-max items-center gap-3 rounded-md px-3 text-sm transition lg:min-w-0 ${
                  sidebarCollapsed ? "lg:justify-center lg:px-0" : ""
                } ${
                  active ? "bg-primary font-semibold text-white shadow-sm" : "font-medium text-lightgray hover:bg-white/10"
                }`}
              >
                {icons[view]}
                <span className={sidebarCollapsed ? "lg:sr-only" : ""}>{viewLabel(language, view)}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <section className="min-w-0 px-4 py-5 sm:px-6 lg:px-7">
        <header className="mb-4 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1">
          <p className="col-start-1 row-start-1 min-w-0 text-xs font-semibold uppercase tracking-normal text-slate">
            {kicker[activeView]}
          </p>
          <div className="col-start-2 row-span-2 row-start-1 flex min-w-0 max-w-[58vw] flex-wrap items-start justify-end gap-2">
            <Button type="button" size="sm" variant="secondary" className="min-w-9 px-3" onClick={onLanguageChange}>
              {translate(language, "language")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="min-w-9 px-2.5"
              icon={<RefreshCw size={16} />}
              aria-label={translate(language, "refresh")}
              title={translate(language, "refresh")}
              onClick={onRefresh}
            >
              <span className="sr-only">{translate(language, "refresh")}</span>
            </Button>
            <details className="group relative min-w-0">
              <summary
                className="flex min-h-9 max-w-[220px] cursor-pointer list-none items-center rounded-md border border-[#D7DEE8] bg-white px-3 text-sm font-semibold text-navy shadow-sm transition hover:bg-[#F8FAFD] focus:outline-none focus:ring-2 focus:ring-primary/25 [&::-webkit-details-marker]:hidden"
                aria-label="Open account menu"
                title={accountName}
              >
                <span className="truncate">{accountName}</span>
              </summary>
              <div className="absolute right-0 z-40 mt-2 w-64 rounded-md border border-[#D7DEE8] bg-white p-3 text-sm text-slate shadow-lg">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-slate">Role</span>
                  <span className="rounded-md bg-lightgray px-2 py-1 text-xs font-semibold uppercase text-slate">{profile ? ROLE_LABELS[profile.role] : "Viewer"}</span>
                </div>
                <div className="mb-3 rounded-md bg-[#F8FAFD] px-3 py-2">
                  <p className="truncate font-semibold text-navy">{accountName}</p>
                  {profile?.email ? <p className="mt-0.5 truncate text-xs text-slate">{profile.email}</p> : null}
                </div>
                <button
                  type="button"
                  className="flex min-h-9 w-full items-center justify-center gap-2 rounded-md text-sm font-semibold text-scarlet transition hover:bg-[#FDEBEA] focus:outline-none focus:ring-2 focus:ring-scarlet/25"
                  onClick={onSignOut}
                >
                  <LogOut size={16} />
                  {translate(language, "logout")}
                </button>
              </div>
            </details>
          </div>
          <h2 className="col-start-1 row-start-2 min-w-0 text-3xl font-semibold tracking-normal text-navy">
            {viewLabel(language, activeView)}
          </h2>
        </header>

        {children}
      </section>
    </main>
  );
}

export function FeatureIcon({ view }: { view: ViewId }) {
  if (view === "requisitions") return <BriefcaseBusiness size={18} />;
  return icons[view];
}
