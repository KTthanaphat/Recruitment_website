"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { PROCESS_STAGES, processIndex } from "@/lib/constants";
import { formatDate, resultText, statusTone } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { EnrichedCandidate, Language, ProcessStage } from "@/types/recruitment";

export function PipelineView({
  language,
  rows,
  canWrite,
  onAddUpdate,
  onOpen,
  onMove
}: {
  language: Language;
  rows: EnrichedCandidate[];
  canWrite: boolean;
  onAddUpdate: () => void;
  onOpen: (candidateId: string) => void;
  onMove: (candidate: EnrichedCandidate, nextStage: ProcessStage) => void;
}) {
  const [dragged, setDragged] = useState<EnrichedCandidate | null>(null);
  const [blockedStage, setBlockedStage] = useState<ProcessStage | null>(null);

  return (
    <Panel>
      <SectionTitle
        title={translate(language, "candidatePipeline")}
        action={canWrite ? <Button type="button" size="sm" icon={<Plus size={16} />} onClick={onAddUpdate}>{translate(language, "addUpdate")}</Button> : null}
      />
      <div className="grid gap-3 overflow-x-auto pb-2 xl:grid-cols-9">
        {PROCESS_STAGES.map((stage) => {
          const stageRows = rows.filter((row) => row.latest_process === stage);
          const isBlocked = blockedStage === stage;

          return (
            <section
              key={stage}
              className={`min-h-80 min-w-64 rounded-lg border border-[#D7DEE8] bg-lightgray/75 p-3 transition ${
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
                <h3 className="text-sm font-extrabold text-navy">{stage}</h3>
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
                      className="cursor-pointer rounded-lg border border-[#D7DEE8] bg-white p-3 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-panel"
                      onClick={() => onOpen(candidate.candidate_id)}
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <strong className="text-sm text-navy">{candidate.name}</strong>
                        <Tag tone={statusTone(resultText(candidate.latest_result).toLowerCase()) as never}>{resultText(candidate.latest_result)}</Tag>
                      </div>
                      <p className="text-xs font-bold text-slate">{candidate.candidate_id} · {candidate.group_position ?? "-"}</p>
                      <p className="text-xs font-bold text-slate">{candidate.site ?? "-"} · {candidate.person_in_charge ?? "-"}</p>
                      <p className="mt-2 text-xs font-bold text-cool">Updated {formatDate(candidate.updated_at)}</p>
                    </article>
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </Panel>
  );
}
