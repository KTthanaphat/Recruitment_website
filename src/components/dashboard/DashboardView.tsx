import { BriefcaseBusiness, HandCoins, UsersRound, Workflow } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { StatCard } from "@/components/ui/StatCard";
import { Tag } from "@/components/ui/Tag";
import { formatDateTime, statusTone, toTitle } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { ChangeLog, EnrichedCandidate, EnrichedRequisition, Language } from "@/types/recruitment";

export function DashboardView({
  language,
  requisitions,
  candidates,
  changeLogs,
  onOpenRequisition,
  onOpenCandidate
}: {
  language: Language;
  requisitions: EnrichedRequisition[];
  candidates: EnrichedCandidate[];
  changeLogs: ChangeLog[];
  onOpenRequisition: (docId: string) => void;
  onOpenCandidate: (candidateId: string) => void;
}) {
  const activeRequisitions = requisitions.filter((row) => row.status === "ongoing");
  const acceptedOffers = requisitions.reduce((sum, row) => sum + row.accepted_count, 0);
  const openHeadcount = requisitions.reduce((sum, row) => sum + row.open_headcount, 0);
  const needsAction = activeRequisitions
    .filter((row) => row.open_headcount > 0)
    .sort((a, b) => b.open_headcount - a.open_headcount)
    .slice(0, 6);
  const pipelinePreview = candidates
    .filter((row) => !["Rejected", "Withdrawn"].includes(row.latest_process))
    .slice(0, 8);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={translate(language, "activeRequisitions")} value={activeRequisitions.length} icon={<BriefcaseBusiness size={22} />} />
        <StatCard label={translate(language, "candidateCount")} value={candidates.length} icon={<UsersRound size={22} />} />
        <StatCard label={translate(language, "acceptedOffers")} value={acceptedOffers} icon={<HandCoins size={22} />} />
        <StatCard label={translate(language, "openHeadcount")} value={openHeadcount} icon={<Workflow size={22} />} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <SectionTitle
            title={translate(language, "needsAction")}
            action={<Link className="text-sm font-bold text-primary hover:text-primary" href="/requisitions">{translate(language, "openList")}</Link>}
          />
          <div className="grid gap-2">
            {needsAction.length === 0 ? (
              <EmptyState message="No open headcount needs action." />
            ) : (
              needsAction.map((row) => (
                <button
                  key={row.doc_id}
                  type="button"
                  className="grid gap-1 rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:bg-[#EEF4FF] hover:shadow-panel"
                  onClick={() => onOpenRequisition(row.doc_id)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-navy">{row.doc_id} · {row.position}</strong>
                    <Tag tone="warning">{row.open_headcount} open</Tag>
                  </div>
                  <p className="text-sm font-bold text-slate">{row.department} · {row.site} · {row.person_in_charge ?? "Unassigned"}</p>
                </button>
              ))
            )}
          </div>
        </Panel>

        <Panel>
          <SectionTitle
            title={translate(language, "recentActivity")}
            action={<Link className="text-sm font-bold text-primary hover:text-primary" href="/audit">{translate(language, "audit")}</Link>}
          />
          <div className="grid gap-2">
            {changeLogs.length === 0 ? (
              <EmptyState message="No recent activity." />
            ) : (
              changeLogs.slice(0, 6).map((log) => (
                <div key={log.log_id} className="rounded-md border border-[#D7DEE8] bg-lightgray/60 p-3 shadow-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-navy">{toTitle(log.entity)} · {log.entity_id}</strong>
                    <Tag tone={statusTone(log.action) as never}>{log.action}</Tag>
                  </div>
                  <p className="mt-1 text-sm font-bold text-slate">{log.changed_by_email ?? "System"} · {formatDateTime(log.changed_at)}</p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionTitle
          title={translate(language, "candidatePipeline")}
          action={<Link className="text-sm font-bold text-primary hover:text-primary" href="/pipeline">{translate(language, "fullPipeline")}</Link>}
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {pipelinePreview.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-4">
              <EmptyState message="No active candidates in pipeline." />
            </div>
          ) : (
            pipelinePreview.map((candidate) => (
              <button
                type="button"
                key={candidate.candidate_id}
                className="rounded-md border border-[#D7DEE8] bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-panel"
                onClick={() => onOpenCandidate(candidate.candidate_id)}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <strong className="text-navy">{candidate.name}</strong>
                  <Tag tone="teal">{candidate.latest_process}</Tag>
                </div>
                <p className="text-sm font-bold text-slate">{candidate.candidate_id} · {candidate.group_position ?? "-"}</p>
                <p className="text-sm font-bold text-slate">{candidate.site ?? "-"} · {candidate.person_in_charge ?? "Unassigned"}</p>
              </button>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}
