"use client";

import {
  BarChart3,
  BriefcaseBusiness,
  ClipboardList,
  FileClock,
  HandCoins,
  LayoutDashboard,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Settings,
  UserRound,
  UsersRound
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { ROLE_LABELS, VIEWS } from "@/lib/constants";
import { translate, viewLabel } from "@/lib/i18n/dictionary";
import type { Language, Profile, ViewId } from "@/types/recruitment";

const icons: Record<ViewId, ReactNode> = {
  dashboard: <LayoutDashboard size={18} />,
  requisitions: <ClipboardList size={18} />,
  candidates: <UsersRound size={18} />,
  pipeline: <BarChart3 size={18} />,
  offers: <HandCoins size={18} />,
  sourcing: <Settings size={18} />,
  admin: <ShieldCheck size={18} />,
  audit: <FileClock size={18} />
};

const paths: Record<ViewId, string> = {
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
  dashboard: "Work Queue",
  requisitions: "Hiring Demand",
  candidates: "Talent Records",
  pipeline: "Process Board",
  offers: "Hiring Outcome",
  sourcing: "Jobsite Sourcing",
  admin: "System Control",
  audit: "History"
};

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

  return (
    <main className="grid min-h-screen grid-cols-1 bg-offwhite lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="bg-navy px-4 py-4 text-white lg:sticky lg:top-0 lg:h-screen lg:py-5">
        <div className="mb-4 px-2 lg:mb-7">
          <p className="mb-1 text-xs font-extrabold uppercase tracking-normal text-cool">Internal Recruitment</p>
          <h1 className="text-2xl font-extrabold tracking-normal">Recruitment</h1>
        </div>

        <nav aria-label="Main navigation" className="grid grid-flow-col gap-1.5 overflow-x-auto pb-1 lg:grid-flow-row lg:overflow-visible lg:pb-0">
          {visibleViews.map((view) => {
            const active = pathname === paths[view] || activeView === view;
            return (
              <Link
                key={view}
                href={paths[view]}
                className={`flex min-h-11 min-w-max items-center gap-3 rounded-md px-3 text-sm font-bold transition lg:min-w-0 ${
                  active ? "bg-primary text-white" : "text-lightgray hover:bg-white/10"
                }`}
              >
                {icons[view]}
                {viewLabel(language, view)}
              </Link>
            );
          })}
        </nav>
      </aside>

      <section className="min-w-0 px-4 py-5 sm:px-6 lg:px-7">
        <header className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="mb-1 text-xs font-extrabold uppercase tracking-normal text-slate">{kicker[activeView]}</p>
            <h2 className="text-3xl font-extrabold tracking-normal text-navy">{viewLabel(language, activeView)}</h2>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-bold text-slate">
              <UserRound size={16} />
              <span>{translate(language, "signedInAs")} {accountName}</span>
              <span className="rounded-full bg-lightgray px-2 py-1 text-xs uppercase">{profile ? ROLE_LABELS[profile.role] : "Viewer"}</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" icon={<RefreshCw size={16} />} onClick={onRefresh}>
              {translate(language, "refresh")}
            </Button>
            <Button type="button" variant="secondary" onClick={onLanguageChange}>
              {translate(language, "language")}
            </Button>
            <Button type="button" variant="ghost" icon={<LogOut size={16} />} onClick={onSignOut}>
              {translate(language, "logout")}
            </Button>
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
