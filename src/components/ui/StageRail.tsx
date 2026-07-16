import { Check, Circle, Clock3, X } from "lucide-react";
import {
  isDerivedResumeScreeningStage,
  PIPELINE_JOURNEY_STAGES,
  pipelineDisplayLabel,
  type PipelineDisplayStage
} from "@/lib/constants";
import { translate } from "@/lib/i18n/dictionary";
import type { Language, ProcessStage, RecruitmentLog } from "@/types/recruitment";

export type StageRailState = "passed" | "pending" | "failed" | "unreached";

type StageRailProps = {
  logs?: RecruitmentLog[];
  currentStage?: ProcessStage | "No activity" | null;
  currentResult?: number | null;
  compact?: boolean;
  label?: string;
  language?: Language;
  ariaLabel?: string;
  showSummary?: boolean;
};

export function StageRail({ logs, currentStage, currentResult, compact = false, label, language = "en", ariaLabel, showSummary = compact }: StageRailProps) {
  const currentPendingStage = logs?.find((log) => log.result === null)?.recruitment_process;
  const activeStage = currentStage && currentStage !== "No activity" ? currentStage : undefined;
  const activeIndex = activeStage ? PIPELINE_JOURNEY_STAGES.indexOf(activeStage) : -1;
  const hasCandidateRecord = Boolean(activeStage) || Boolean(logs?.length);
  const stageItems = PIPELINE_JOURNEY_STAGES.map((stage, index) => {
    const state = logs
      ? stageStateFromLogs(logs, stage, currentPendingStage, hasCandidateRecord)
      : stageStateFromCurrent(stage, index, activeIndex, currentResult, hasCandidateRecord);
    return {
      stage,
      state,
      isCurrent: !isDerivedResumeScreeningStage(stage) && activeStage === stage && state !== "passed"
    };
  });
  const summaryItem = stageItems.find((item) => item.state === "pending")
    ?? stageItems.find((item) => item.isCurrent)
    ?? [...stageItems].reverse().find((item) => item.state === "failed" || item.state === "passed");
  const summary = summaryItem
    ? `${pipelineDisplayLabel(summaryItem.stage, language)}: ${stageStateLabel(language, summaryItem.state)}`
    : translate(language, "noActivity");

  return (
    <div className={compact ? "relative z-0 grid gap-1.5" : "relative z-0 rounded-lg bg-white px-4 py-4"}>
      {label ? <h4 className={compact ? "text-xs font-semibold text-navy" : "mb-4 font-semibold text-navy"}>{label}</h4> : null}
      <ol
        aria-label={ariaLabel ?? label ?? translate(language, "candidatePipelineJourney")}
        className={compact ? "relative z-0 grid h-4 w-36 max-w-full items-center" : "relative z-0 grid gap-4 md:grid-cols-7 md:gap-2 md:justify-items-center"}
        style={compact ? { gridTemplateColumns: `repeat(${stageItems.length}, minmax(0, 1fr))` } : undefined}
      >
        {compact ? (
          <span
            className="absolute top-1/2 z-0 grid h-1 -translate-y-1/2 overflow-hidden rounded-full"
            style={{
              left: `${50 / stageItems.length}%`,
              right: `${50 / stageItems.length}%`,
              gridTemplateColumns: `repeat(${Math.max(stageItems.length - 1, 1)}, minmax(0, 1fr))`
            }}
            aria-hidden="true"
          >
            {stageItems.slice(0, -1).map((item, index) => (
              <span
                key={`${item.stage}-connector`}
                className={`h-1 ${stageConnectorClass(item.state, stageItems[index + 1]?.state)}`}
              />
            ))}
          </span>
        ) : null}
        {stageItems.map(({ stage, state, isCurrent }, index) => {
          const nextState = stageItems[index + 1]?.state;
          if (compact) {
            return (
              <li
                key={stage}
                className="relative z-[1] grid place-items-center"
                title={`${pipelineDisplayLabel(stage, language)}: ${stageStateLabel(language, state)}`}
              >
                <span className={`block shrink-0 rounded-full ${isCurrent ? "size-3.5" : "size-3"} ${stageDotClass(state, isCurrent)} ring-2 ring-white`} aria-hidden="true" />
                <span className="sr-only">{pipelineDisplayLabel(stage, language)}: {stageStateLabel(language, state)}</span>
              </li>
            );
          }

          return (
            <li
              key={stage}
              className="relative z-[1] grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-3 md:flex md:w-full md:flex-col md:items-center md:text-center"
            >
              {index < PIPELINE_JOURNEY_STAGES.length - 1 ? (
                <>
                  <span className={`absolute left-3 top-6 h-[calc(100%+1rem)] w-1 rounded-full md:hidden ${stageConnectorClass(state, nextState)}`} aria-hidden="true" />
                  <span className={`absolute left-[calc(50%+0.75rem)] right-[calc(-50%+0.75rem)] top-3 z-0 hidden h-1 rounded-full md:block ${stageConnectorClass(state, nextState)}`} aria-hidden="true" />
                </>
              ) : null}
              <span className={`relative z-[1] grid shrink-0 place-items-center rounded-full ring-4 md:mx-auto ${isCurrent ? "size-8" : "size-6"} ${stageDotClass(state, isCurrent)}`}>
                <StageIcon state={state} current={isCurrent} />
              </span>
              <div className="min-w-0 md:mt-3 md:flex md:min-h-[72px] md:flex-col md:items-center md:justify-start">
                <p className="text-xs font-semibold leading-tight text-navy">{pipelineDisplayLabel(stage, language)}</p>
                <p className="mt-1 text-xs font-medium text-slate">{stageStateLabel(language, state)}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {showSummary ? <p className="text-[11px] font-medium text-slate">{summary}</p> : null}
    </div>
  );
}

function stageStateFromLogs(logs: RecruitmentLog[], stage: PipelineDisplayStage, currentPendingStage?: ProcessStage, hasCandidateRecord = false): StageRailState {
  if (isDerivedResumeScreeningStage(stage)) return hasCandidateRecord ? "passed" : "unreached";
  const stageLogs = logs.filter((log) => log.recruitment_process === stage).sort((a, b) => b.log_id - a.log_id);
  const latest = stageLogs[0];
  if (!latest) return "unreached";
  if (latest.result === 0) return "failed";
  if (latest.result === 1) return "passed";
  return currentPendingStage === stage ? "pending" : "unreached";
}

function stageStateFromCurrent(stage: PipelineDisplayStage, index: number, activeIndex: number, currentResult?: number | null, hasCandidateRecord = false): StageRailState {
  if (isDerivedResumeScreeningStage(stage)) return hasCandidateRecord ? "passed" : "unreached";
  if (activeIndex === -1) return "unreached";
  if (index < activeIndex) return "passed";
  if (index > activeIndex) return "unreached";
  if (currentResult === 0) return "failed";
  if (currentResult === 1) return "passed";
  return "pending";
}

function stageDotClass(state: StageRailState, current: boolean) {
  if (state === "passed") return current ? "bg-primary ring-[#BFEFFF] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.85),0_6px_18px_rgb(var(--app-primary-rgb)/0.24)]" : "bg-primary ring-[#E4F8FF] text-white";
  if (state === "failed") return current ? "bg-scarlet ring-[#FFE1E1] text-white" : "bg-scarlet ring-[#FFF1F0] text-white";
  if (state === "pending") return current ? "bg-[#FFD43B] ring-[#FFF2A8] text-navy shadow-[0_0_0_1px_rgba(255,255,255,0.9),0_6px_18px_rgba(255,212,59,0.28)]" : "bg-[#FFD43B] ring-[#FFF8D6] text-navy";
  return "bg-[#DDEBFF] ring-[#F5FAFF] text-slate";
}

function stageConnectorClass(state: StageRailState, nextState?: StageRailState) {
  if (state === "failed" || nextState === "failed") return "bg-scarlet";
  if (state === "pending" || nextState === "pending") return "bg-[#FFD43B]";
  if (state === "passed") return "bg-primary";
  return "bg-[#DCEBFF]";
}

function StageIcon({ state, current }: { state: StageRailState; current: boolean }) {
  if (!current) return null;
  if (state === "passed") return <Check size={14} strokeWidth={3} />;
  if (state === "failed") return <X size={14} strokeWidth={3} />;
  if (state === "pending") return <Clock3 size={14} strokeWidth={2.5} />;
  return <Circle size={10} strokeWidth={3} />;
}

function stageStateLabel(language: Language, state: StageRailState) {
  if (state === "passed") return translate(language, "passed");
  if (state === "failed") return translate(language, "failed");
  if (state === "pending") return translate(language, "current");
  return translate(language, "notReached");
}
