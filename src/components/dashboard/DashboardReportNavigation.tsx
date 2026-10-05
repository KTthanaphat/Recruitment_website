"use client";

import { CommandSelector } from "@/components/ui/CommandSelector";
import { dashboardNavigationKind, type DashboardReportIdentity } from "@/lib/dashboard-report-registry";
import type { Language } from "@/types/recruitment";

export function DashboardReportNavigation({ reports, selectedId, language, onSelect }: {
  reports: readonly DashboardReportIdentity[]; selectedId: string; language: Language; onSelect: (id: string) => void;
}) {
  const label = language === "th" ? "รายงาน" : "Report";
  if (dashboardNavigationKind(reports) === "selector") return <CommandSelector typography="normal" ariaLabel={label} emptyLabel={label} value={selectedId} options={reports.map(report => ({ value: report.id, label: report.label[language] }))} onValueChange={onSelect} />;
  return <div role="tablist" aria-label={label} className="flex min-w-0 gap-1 overflow-x-auto border-b border-[#D7DEE8]" onKeyDown={event => {
    const index = reports.findIndex(report => report.id === selectedId);
    const next = event.key === "Home" ? 0 : event.key === "End" ? reports.length - 1 : event.key === "ArrowRight" ? (index + 1) % reports.length : event.key === "ArrowLeft" ? (index + reports.length - 1) % reports.length : null;
    if (next !== null) { event.preventDefault(); onSelect(reports[next].id); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); }
  }}>{reports.map(report => <button key={report.id} type="button" role="tab" id={`dashboard-tab-${report.id}`} aria-controls={`dashboard-panel-${report.id}`} aria-selected={selectedId === report.id} tabIndex={selectedId === report.id ? 0 : -1} className={`dashboard-compact-tab shrink-0 border-b-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#0A3CDC] ${selectedId === report.id ? "border-primary text-primary" : "border-transparent text-slate hover:text-navy"}`} onClick={() => onSelect(report.id)}>{report.label[language]}</button>)}</div>;
}
