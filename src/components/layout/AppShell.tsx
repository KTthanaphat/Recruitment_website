"use client";

import {
  BriefcaseBusiness,
  ChevronDown,
  ClipboardList,
  FileClock,
  HandCoins,
  LayoutDashboard,
  LampDesk,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  RefreshCw,
  ShieldCheck,
  Settings,
  Home,
  UsersRound
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { roleLabel, translate, viewLabel } from "@/lib/i18n/dictionary";
import { siteAccentStyle } from "@/lib/site-theme";
import { buildContextualHref, type WorkspaceNavigationContext } from "@/lib/workspace-url-state";
import type { Language, Profile, ViewId } from "@/types/recruitment";

const icons: Record<ViewId, ReactNode> = {
  home: <Home size={18} />,
  dashboard: <LayoutDashboard size={18} />,
  workspace: <LampDesk size={18} />,
  requisitions: <ClipboardList size={18} />,
  candidates: <UsersRound size={18} />,
  pipeline: <PipelineStagesIcon />,
  offers: <HandCoins size={18} />,
  sourcing: <Settings size={18} />,
  admin: <ShieldCheck size={18} />,
  audit: <FileClock size={18} />
};

const primaryViews: ViewId[] = ["home", "workspace", "dashboard", "audit"];
const recordsViews: ViewId[] = ["requisitions", "sourcing", "candidates", "pipeline", "offers"];

const paths: Record<ViewId, string> = {
  home: "/home",
  dashboard: "/dashboard",
  workspace: "/workspace",
  requisitions: "/requisitions",
  candidates: "/candidates",
  pipeline: "/pipeline",
  offers: "/offers",
  sourcing: "/sourcing",
  admin: "/admin",
  audit: "/audit"
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
  headerControls,
  language,
  navigationContext,
  onLanguageChange,
  onRefresh,
  onSignOut,
  profile,
  activeView
}: {
  children: ReactNode;
  headerControls?: ReactNode;
  language: Language;
  navigationContext?: WorkspaceNavigationContext;
  onLanguageChange: () => void;
  onRefresh: () => void;
  onSignOut: () => void;
  profile: Profile | null;
  activeView: ViewId;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const accountName = profile?.nickname ?? profile?.full_name ?? profile?.email ?? translate(language, "unknown");
  const contextualNavigation: WorkspaceNavigationContext = {
    language: navigationContext?.language ?? searchParams.get("lang"),
    site: navigationContext?.site ?? searchParams.get("site"),
    owner: navigationContext?.owner ?? searchParams.get("pic"),
    sourcingWeek: navigationContext?.sourcingWeek ?? searchParams.get("sourcingWeek")
  };
  const isRecordsActive = recordsViews.some((view) => pathname === paths[view] || activeView === view);
  const [recordsOpen, setRecordsOpen] = useState(isRecordsActive);
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

  useEffect(() => {
    if (isRecordsActive) {
      setRecordsOpen(true);
    }
  }, [isRecordsActive]);

  const renderNavLink = (view: ViewId, options?: { child?: boolean }) => {
    const active = pathname === paths[view] || activeView === view;
    const child = options?.child;
    const childMutedClasses = child && !active ? "lg:opacity-65 lg:group-hover:opacity-100" : "";
    return (
      <Link
        key={view}
        href={buildContextualHref(paths[view], contextualNavigation)}
        aria-label={viewLabel(language, view)}
        title={viewLabel(language, view)}
        data-records-child={child ? view : undefined}
        className={`group flex min-h-10 min-w-max items-center gap-2 rounded-xl px-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-white/70 sm:min-h-11 sm:gap-3 sm:px-3 lg:min-w-0 lg:w-full ${
          sidebarCollapsed ? "lg:justify-center lg:px-0" : ""
        } ${
          child
            ? sidebarCollapsed
              ? "lg:size-9 lg:min-h-0 lg:justify-center lg:rounded-lg lg:px-0"
              : "lg:min-h-9 lg:rounded-lg lg:pl-4"
            : ""
        } ${
          active
            ? child
              ? "bg-white/12 font-medium text-white"
              : "bg-white font-semibold text-navy shadow-[0_8px_24px_rgba(0,0,0,0.12)] [&>span:first-child]:text-primary"
            : child
              ? "font-normal text-cool hover:bg-white/10 hover:text-white"
              : "font-medium text-lightgray hover:bg-white/10 hover:text-white"
        }`}
      >
        <span className={`shrink-0 ${childMutedClasses}`} aria-hidden="true">{icons[view]}</span>
        <span
          data-nav-label={view}
          className={`${sidebarCollapsed ? "lg:sr-only" : ""} ${childMutedClasses}`}
        >
          {viewLabel(language, view)}
        </span>
      </Link>
    );
  };

  return (
    <main
      className={`grid min-h-screen grid-cols-1 bg-offwhite ${sidebarCollapsed ? "lg:grid-cols-[72px_minmax(0,1fr)]" : "lg:grid-cols-[248px_minmax(0,1fr)]"}`}
      style={siteAccentStyle(profile?.site)}
    >
      <aside className={`min-w-0 overflow-hidden bg-[linear-gradient(180deg,#071B61_0%,#0A3CDC_100%)] px-3 py-4 text-white sm:px-4 lg:sticky lg:top-0 lg:h-screen lg:py-5 ${sidebarCollapsed ? "lg:px-3" : ""}`}>
        <div className={`mb-4 flex items-start gap-3 px-2 lg:mb-7 ${sidebarCollapsed ? "lg:justify-center lg:px-0" : "lg:block"}`}>
          <div className={sidebarCollapsed ? "lg:hidden" : ""}>
                <p className="mb-1 text-xs font-medium uppercase tracking-normal text-blue-100/80">{translate(language, "internalRecruitment")}</p>
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-semibold tracking-normal text-white">{translate(language, "recruitment")}</h1>
              <button
                type="button"
                className="hidden size-9 shrink-0 place-items-center rounded-lg text-blue-100 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/70 lg:grid"
                aria-label={translate(language, "collapseSidebar")}
                title={translate(language, "collapseSidebar")}
                onClick={() => setSidebarCollapsed(true)}
              >
                <PanelLeftClose size={18} />
              </button>
            </div>
          </div>
          {sidebarCollapsed ? (
            <button
              type="button"
              className="hidden size-9 shrink-0 place-items-center rounded-lg text-blue-100 transition hover:bg-white/10 hover:text-white focus:outline-none focus:ring-2 focus:ring-white/70 lg:grid"
              aria-label={translate(language, "expandSidebar")}
              title={translate(language, "expandSidebar")}
              onClick={() => setSidebarCollapsed(false)}
            >
              <PanelLeftOpen size={18} />
            </button>
          ) : null}
        </div>

        <nav
          aria-label={translate(language, "mainNavigation")}
          className="flex flex-col gap-3 overflow-visible pb-1"
        >
          <div className="flex gap-1 overflow-x-auto pb-1 sm:gap-1.5 lg:flex-col lg:overflow-visible lg:pb-0">
            {primaryViews.slice(0, 2).map((view) => renderNavLink(view))}
            <div className={`relative shrink-0 ${sidebarCollapsed ? "lg:w-full" : "lg:min-w-0 lg:w-full"}`}>
              <button
                type="button"
                data-records-toggle
                aria-expanded={recordsOpen}
                aria-controls="records-nav-group"
                aria-current={isRecordsActive ? "page" : undefined}
                aria-label={translate(language, "navRecords")}
                title={translate(language, "navRecords")}
                className={`flex min-h-10 min-w-max items-center gap-2 rounded-xl px-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-white/70 sm:min-h-11 sm:gap-3 sm:px-3 lg:min-w-0 lg:w-full ${
                  sidebarCollapsed ? "lg:justify-center lg:px-0" : ""
                } ${
                  isRecordsActive ? "bg-white font-semibold text-navy shadow-[0_8px_24px_rgba(0,0,0,0.12)] [&>svg]:text-primary" : "font-medium text-blue-100 hover:bg-white/10 hover:text-white"
                }`}
                onClick={() => setRecordsOpen((current) => !current)}
              >
                <Pencil size={18} aria-hidden="true" />
                <span className={`flex-1 text-left ${sidebarCollapsed ? "lg:sr-only" : ""}`}>{translate(language, "navRecords")}</span>
                <ChevronDown
                  size={16}
                  className={`transition ${recordsOpen ? "rotate-180" : ""} ${sidebarCollapsed ? "lg:sr-only" : ""}`}
                />
              </button>

              {recordsOpen ? (
                <>
                  <div
                    id="records-nav-group"
                    data-records-subnav
                    className={`mt-1.5 hidden min-w-max gap-1.5 rounded-xl border border-white/10 bg-white/[0.05] p-1.5 lg:flex lg:min-w-0 lg:flex-col ${
                      sidebarCollapsed
                        ? "lg:mt-2 lg:w-full lg:min-w-0 lg:items-center lg:gap-1 lg:border-0 lg:bg-transparent lg:p-0"
                        : "lg:mt-2 lg:w-full lg:gap-0.5 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:pl-4"
                    }`}
                  >
                    {recordsViews.map((view) => renderNavLink(view, { child: true }))}
                  </div>
                </>
              ) : null}
            </div>
            {primaryViews.slice(2).map((view) => renderNavLink(view))}
            {profile?.role === "system_admin" ? renderNavLink("admin") : null}
          </div>
        </nav>
      </aside>

      <section className="min-w-0 px-4 py-4 sm:px-6 lg:px-7">
        <header className="mb-5 flex min-w-0 flex-col gap-3 border-b border-[#E4E9F2] pb-4 lg:flex-row lg:items-start lg:justify-between">
          <h2 className="min-w-0 text-[28px] font-semibold leading-9 tracking-normal text-navy">
            {viewLabel(language, activeView)}
          </h2>
          <div className="flex min-w-0 flex-wrap items-center gap-2 lg:max-w-[min(76vw,72rem)] lg:justify-end" data-app-header-actions>
            {headerControls ? (
              <div className="contents" data-app-header-filters>
                {headerControls}
              </div>
            ) : null}
            <Button type="button" size="sm" variant="secondary" className="min-w-9 px-3" onClick={onLanguageChange}>
              {translate(language, "language")}
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="secondary"
              icon={<RefreshCw size={16} />}
              aria-label={translate(language, "refresh")}
              title={translate(language, "refresh")}
              onClick={onRefresh}
            >
              <span className="sr-only">{translate(language, "refresh")}</span>
            </Button>
            <details className="group relative min-w-0">
              <summary
                className="flex min-h-9 max-w-[220px] cursor-pointer list-none items-center rounded-lg border border-[#E4E9F2] bg-white px-3 text-sm font-semibold text-navy transition hover:bg-[#F8FAFD] focus:outline-none focus:ring-2 focus:ring-primary/25 [&::-webkit-details-marker]:hidden"
                aria-label={translate(language, "openAccountMenu")}
                title={accountName}
              >
                <span className="truncate">{accountName}</span>
              </summary>
              <div className="absolute right-0 z-40 mt-2 w-64 rounded-2xl border border-[#E4E9F2] bg-white p-3 text-sm text-slate shadow-[0_8px_24px_rgba(11,19,43,0.08)]">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-slate">{translate(language, "role")}</span>
                  <span className="rounded-md bg-lightgray px-2 py-1 text-xs font-semibold uppercase text-slate">{profile ? roleLabel(language, profile.role) : translate(language, "viewer")}</span>
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
