"use client";

import { AlertTriangle, ArrowRight, Plus, Workflow } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { ACTIVE_PIPELINE_STAGES, processIndex, processLabel } from "@/lib/constants";
import { formatDate } from "@/lib/format";
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
  const [openStageMenu, setOpenStageMenu] = useState<string | null>(null);
  const activeRows = rows.filter((row) => row.latest_result !== 0 && !(row.latest_process === "Offer" && row.latest_result === 1));
  const failedGroups = failedCandidatesByStage(rows);
  const passedOfferRows = passedOfferCandidates(rows);

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
        <div className="grid grid-flow-col gap-3 overflow-x-auto pb-2" style={{ gridAutoColumns: "minmax(240px, 1fr)" }}>
          {ACTIVE_PIPELINE_STAGES.map((stage) => {
            const stageRows = sortByLastUpdateDesc(activeRows.filter((row) => row.latest_process === stage));
            const hasAging = stageRows.some((row) => isAging(candidateLastUpdate(row)));
            const isBlocked = blockedStage === stage;

            return (
              <section
                key={stage}
                className={`min-h-72 rounded-lg border border-[#D7DEE8] bg-lightgray/75 p-2.5 transition-colors ${
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
                <div className="mb-3 grid gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-extrabold text-navy">{processLabel(stage)}</h3>
                    <div className="flex items-center gap-1.5">
                      <Tag tone="muted">{stageRows.length}</Tag>
                      {hasAging ? <AlertTriangle className="text-scarlet" size={16} aria-label="Aging candidates in stage" /> : null}
                    </div>
                  </div>
                </div>
                <div className="grid gap-2">
                  {stageRows.length === 0 ? (
                    <EmptyState message={translate(language, "noCandidatesInStage").replace("{stage}", processLabel(stage))} />
                  ) : (
                    stageRows.map((candidate) => {
                      const updateStages = nextStages(candidate.latest_process);
                      return (
                      <PipelineCandidateCard
                        key={candidate.candidate_id}
                        candidate={candidate}
                        language={language}
                        canWrite={canWrite}
                        draggable={canWrite}
                        updateStages={updateStages}
                        menuOpen={openStageMenu === candidate.candidate_id}
                        onOpen={onOpen}
                        onMove={onMove}
                        onMenuToggle={() => setOpenStageMenu((current) => current === candidate.candidate_id ? null : candidate.candidate_id)}
                        onMenuClose={() => setOpenStageMenu(null)}
                        onDragStart={() => setDragged(candidate)}
                        onDragEnd={() => {
                          setDragged(null);
                          setBlockedStage(null);
                        }}
                      />
                    );
                    })
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <SectionTitle title="Failed Candidates - Last 7 Days" />
          {failedGroups.length === 0 ? (
            <EmptyState message="No failed candidates in the last 7 days." />
          ) : (
            <div className="grid gap-3">
              {failedGroups.map((group) => (
                <div key={group.stage} className="rounded-lg border border-[#F4B4AE] bg-[#FFF1F0] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <strong className="text-sm text-navy">{processLabel(group.stage)}</strong>
                    <Tag tone="danger">{group.rows.length}</Tag>
                  </div>
                  <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
                    {group.rows.map((candidate) => (
                      <PipelineCandidateCard
                        key={candidate.candidate_id}
                        candidate={candidate}
                        language={language}
                        canWrite={false}
                        tone="failed"
                        onOpen={onOpen}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel>
          <SectionTitle title="Passed Offer - Last 7 Days" />
          {passedOfferRows.length === 0 ? (
            <EmptyState message="No Offer Pass candidates in the last 7 days." />
          ) : (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))]">
              {passedOfferRows.map((candidate) => (
                <PipelineCandidateCard
                  key={candidate.candidate_id}
                  candidate={candidate}
                  language={language}
                  canWrite={false}
                  tone="passed"
                  onOpen={onOpen}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>
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
    rows: sortByLastUpdateDesc(stageRows)
  }));
}

function passedOfferCandidates(rows: EnrichedCandidate[]) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 7);

  return sortByLastUpdateDesc(rows
    .filter((row) => {
      if (row.latest_process !== "Offer" || row.latest_result !== 1 || !row.latest_log_date) return false;
      const logDate = new Date(`${row.latest_log_date}T00:00:00`);
      return logDate >= cutoff;
    }));
}

function PipelineCandidateCard({
  candidate,
  language,
  canWrite,
  draggable = false,
  updateStages = [],
  menuOpen = false,
  tone = "default",
  onOpen,
  onMove,
  onMenuToggle,
  onMenuClose,
  onDragStart,
  onDragEnd
}: {
  candidate: EnrichedCandidate;
  language: Language;
  canWrite: boolean;
  draggable?: boolean;
  updateStages?: ProcessStage[];
  menuOpen?: boolean;
  tone?: "default" | "failed" | "passed";
  onOpen: (candidateId: string) => void;
  onMove?: (candidate: EnrichedCandidate, nextStage: ProcessStage) => void;
  onMenuToggle?: () => void;
  onMenuClose?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  const aging = isAging(candidateLastUpdate(candidate));
  const lastUpdate = candidateLastUpdate(candidate);
  const toneClass = tone === "failed"
    ? "hover:border-scarlet/40 hover:bg-[#FFF8F7]"
    : tone === "passed"
      ? "hover:border-emerald/40 hover:bg-[#F4FFF9]"
      : "hover:border-primary/40";

  return (
    <article
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={`relative min-w-0 cursor-pointer rounded-md border border-[#D7DEE8] bg-white p-3 shadow-sm transition-colors motion-safe:transition-transform motion-safe:hover:-translate-y-0.5 hover:shadow-panel ${toneClass}`}
      onClick={() => {
        onMenuClose?.();
        onOpen(candidate.candidate_id);
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <strong className="block truncate text-sm leading-tight text-navy">{candidate.name}</strong>
          <p className="mt-1 truncate text-xs font-bold text-slate">{candidate.site ?? "-"}-{candidate.group_position ?? "-"} ({candidate.person_in_charge ?? "-"})</p>
        </div>
        {canWrite ? (
          <button
            type="button"
            className={`grid size-8 shrink-0 place-items-center rounded-full transition-colors ${
              aging ? "bg-[#FFF8E1] text-[#8A5A00] hover:bg-[#FFF1B8]" : "bg-[#E6EDF7] text-primary hover:bg-[#D7DEE8]"
            } disabled:bg-[#EEF4FF] disabled:text-[#AFC6EE]`}
            aria-label={`${translate(language, "updateStageFor")} ${candidate.name}`}
            title={`${translate(language, "updateStageFor")} ${candidate.name}`}
            disabled={updateStages.length === 0}
            onClick={(event) => {
              event.stopPropagation();
              onMenuToggle?.();
            }}
          >
            <ArrowRight size={16} strokeWidth={2.5} />
          </button>
        ) : null}
      </div>
      <p className={`mt-3 text-[10px] font-medium ${aging ? "text-[#8A5A00]" : "text-cool"}`}>Updated {formatDate(lastUpdate)}</p>
      {menuOpen ? (
        <div className="absolute right-3 top-12 z-20 grid min-w-36 gap-1 rounded-md border border-[#D7DEE8] bg-white p-2 shadow-panel" onClick={(event) => event.stopPropagation()}>
          {updateStages.map((nextStage) => (
            <button
              key={nextStage}
              type="button"
              className="rounded px-2 py-1 text-left text-xs font-bold text-slate transition-colors hover:bg-lightgray hover:text-primary focus:bg-lightgray focus:text-primary"
              aria-label={`${translate(language, "updateStage")} ${candidate.name} to ${processLabel(nextStage)}`}
              onClick={(event) => {
                event.stopPropagation();
                onMenuClose?.();
                onMove?.(candidate, nextStage);
              }}
            >
              {processLabel(nextStage)}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function candidateLastUpdate(candidate: EnrichedCandidate) {
  return candidate.latest_log_date ?? candidate.updated_at;
}

function sortByLastUpdateDesc(candidates: EnrichedCandidate[]) {
  return [...candidates].sort((a, b) => candidateLastUpdate(b).localeCompare(candidateLastUpdate(a)));
}

function isAging(value: string | null | undefined) {
  if (!value) return false;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  const ageMs = Date.now() - date.getTime();
  return ageMs > 7 * 24 * 60 * 60 * 1000;
}

function nextStages(stage: ProcessStage | "No activity" | null | undefined) {
  const currentIndex = ACTIVE_PIPELINE_STAGES.indexOf(stage as ProcessStage);
  if (currentIndex === -1) return ACTIVE_PIPELINE_STAGES;
  return ACTIVE_PIPELINE_STAGES.slice(currentIndex + 1);
}
