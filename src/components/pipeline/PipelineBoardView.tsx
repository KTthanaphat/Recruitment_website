"use client";

import { Plus, Workflow } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { ACTIVE_PIPELINE_STAGES, processIndex, processLabel } from "@/lib/constants";
import { formatDate, resultText, statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { EnrichedCandidate, Language, ProcessStage } from "@/types/recruitment";

export function PipelineBoardView({
  language,
  rows,
  canWrite,
  onNewCandidate,
  onAddUpdate,
  onOpen,
  onMove
}: {
  language: Language;
  rows: EnrichedCandidate[];
  canWrite: boolean;
  onNewCandidate: () => void;
  onAddUpdate: () => void;
  onOpen: (candidateId: string) => void;
  onMove: (candidate: EnrichedCandidate, nextStage: ProcessStage) => void;
}) {
  const [dragged, setDragged] = useState<EnrichedCandidate | null>(null);
  const [blockedStage, setBlockedStage] = useState<ProcessStage | null>(null);
  const failedGroups = failedCandidatesByStage(rows);

  return (
    <div className="grid gap-4">
      <Panel>
        <SectionTitle
          title={translate(language, "candidatePipeline")}
          action={
            canWrite ? (
              <>
                <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onNewCandidate}>New Candidate</Button>
                <Button type="button" size="sm" variant="secondary" icon={<Workflow size={16} />} onClick={onAddUpdate}>{translate(language, "addUpdate")}</Button>
              </>
            ) : null
          }
        />
        <div className="grid grid-flow-col gap-3 overflow-x-auto pb-2" style={{ gridAutoColumns: "minmax(190px, 1fr)" }}>
          {ACTIVE_PIPELINE_STAGES.map((stage) => {
            const stageRows = rows.filter((row) => row.latest_process === stage);
            const isBlocked = blockedStage === stage;

            return (
              <section
                key={stage}
                className={`min-h-72 rounded-lg border border-[#D7DEE8] bg-lightgray/65 p-2.5 transition ${
                  isBlocked ? "border-scarlet bg-[#FFF1F0]" : ""
                }`}
                onDragOver={(event) => {
                  if (!canWrite || !dragged) return;
                  const targetIndex = processIndex(stage);
                  const currentIndex = processIndex(dragged.latest_process);
                  if (targetIndex > currentIndex) {
                    event.preventDefault();
                    setBlockedStage(null);
                  } else {
                    setBlockedStage(stage);
                  }
                }}
                onDragLeave={() => setBlockedStage(null)}
                onDrop={(event) => {
                  event.preventDefault();
                  setBlockedStage(null);
                  if (!canWrite || !dragged) return;
                  if (processIndex(stage) > processIndex(dragged.latest_process)) {
                    onMove(dragged, stage);
                  }
                  setDragged(null);
                }}
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-extrabold text-navy">{processLabel(stage)}</h3>
                  <Tag tone="muted">{stageRows.length}</Tag>
                </div>
                <div className="grid gap-2">
                  {stageRows.length === 0 ? (
                    <EmptyState message="No candidates" />
                  ) : (
                    stageRows.map((candidate) => (
                      <article
                        key={candidate.candidate_id}
                        draggable={canWrite}
                        onDragStart={() => setDragged(candidate)}
                        onDragEnd={() => {
                          setDragged(null);
                          setBlockedStage(null);
                        }}
                        className="cursor-pointer rounded-md border border-[#D7DEE8] bg-white p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-panel"
                        onClick={() => onOpen(candidate.candidate_id)}
                      >
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <strong className="text-sm leading-tight text-navy">{candidate.name}</strong>
                          <Tag tone={statusTone(resultText(candidate.latest_result).toLowerCase()) as never}>{resultText(candidate.latest_result)}</Tag>
                        </div>
                        <p className="text-xs font-bold text-slate">{candidate.candidate_id} - {candidate.group_position ?? "-"}</p>
                        <p className="text-xs font-bold text-slate">{candidate.site ?? "-"} - {candidate.person_in_charge ?? "-"}</p>
                        <p className="mt-1.5 text-xs font-bold text-cool">Updated {formatDate(candidate.updated_at)}</p>
                      </article>
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </Panel>

      <Panel>
        <SectionTitle title="Failed Candidates - Last 7 Days" />
        {failedGroups.length === 0 ? (
          <EmptyState message="No failed candidates in the last 7 days." />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {failedGroups.map((group) => (
              <div key={group.stage} className="rounded-lg border border-[#D7DEE8] bg-lightgray/65 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <strong className="text-sm text-navy">{processLabel(group.stage)}</strong>
                  <Tag tone="danger">{group.rows.length}</Tag>
                </div>
                <div className="grid gap-2">
                  {group.rows.map((candidate) => (
                    <button
                      key={candidate.candidate_id}
                      type="button"
                      className="rounded-md bg-white p-2 text-left text-sm font-bold text-slate transition hover:bg-[#EEF4FF]"
                      onClick={() => onOpen(candidate.candidate_id)}
                    >
                      <span className="block text-navy">{candidate.name}</span>
                      <span className="block text-xs">{candidate.candidate_id} - {candidate.site ?? "-"} - {formatDate(candidate.latest_log_date)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function failedCandidatesByStage(rows: EnrichedCandidate[]) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);
  const groups = new Map<ProcessStage, EnrichedCandidate[]>();

  for (const row of rows) {
    if (row.latest_result !== 0 || row.latest_process === "No activity" || !row.latest_log_date) continue;
    const logDate = new Date(`${row.latest_log_date}T00:00:00`);
    if (logDate < cutoff) continue;
    groups.set(row.latest_process, [...(groups.get(row.latest_process) ?? []), row]);
  }

  return Array.from(groups.entries()).map(([stage, stageRows]) => ({
    stage,
    rows: stageRows.sort((a, b) => (b.latest_log_date ?? "").localeCompare(a.latest_log_date ?? ""))
  }));
}
