"use client";

import Link from "next/link";
import { Monitor } from "lucide-react";
import { translate, viewLabel } from "@/lib/i18n/dictionary";
import { buildContextualHref, type WorkspaceNavigationContext } from "@/lib/workspace-url-state";
import type { Language, ViewId } from "@/types/recruitment";

export function DesktopRequiredNotice({ view, language, navigationContext }: {
  view: ViewId; language: Language; navigationContext: WorkspaceNavigationContext;
}) {
  return <section className="ats-card grid min-w-0 gap-3 p-4" data-desktop-required aria-labelledby="desktop-required-title">
    <Monitor size={24} className="text-primary" aria-hidden="true" />
    <h3 id="desktop-required-title" className="text-lg font-semibold text-navy">{translate(language, "desktopRequiredTitle", { page: viewLabel(language, view) })}</h3>
    <p className="text-sm text-slate">{translate(language, "desktopRequiredMessage")}</p>
    <div className="flex flex-wrap gap-2">{(["home", "workspace"] as const).map(destination => <Link key={destination} className="ats-dropdown-trigger inline-flex min-h-11 items-center justify-center rounded-lg px-4 text-sm font-semibold text-navy focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" href={buildContextualHref(`/${destination}`, navigationContext)}>{viewLabel(language, destination)}</Link>)}</div>
  </section>;
}
