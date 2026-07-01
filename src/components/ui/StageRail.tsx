import { Check, Circle, Clock3, X } from "lucide-react";
import { ACTIVE_PIPELINE_STAGES, processLabel } from "@/lib/constants";
import type { ProcessStage, RecruitmentLog } from "@/types/recruitment";

export type StageRailState = "passed" | "pending" | "failed" | "unreached";

type StageRailProps = {
  logs?: RecruitmentLog[];
  currentStage?: ProcessStage | "No activity" | null;
  currentResult?: number | null;
  compact?: boolean;
  label?: string;
  ariaLabel?: string;
  showSummary?: boolean;
};

export function StageRail({ logs, currentStage, currentResult, compact = false, label, ariaLabel, showSummary = compact }: StageRailProps) {
  const currentPendingStage = logs?.find((log) => log.result === null)?.recruitment_process;
  const activeStage = currentStage && currentStage !== "No activity" ? currentStage : undefined;
  const activeIndex = activeStage ? ACTIVE_PIPELINE_STAGES.indexOf(activeStage) : -1;
  const stageItems = ACTIVE_PIPELINE_STAGES.map((stage, index) => {
    const state = logs
      ? stageStateFromLogs(logs, stage, currentPendingStage)
      : stageStateFromCurrent(stage, index, activeIndex, currentResult);
    return {
      stage,
      state,
      isCurrent: activeStage === stage && state !== "passed"
    };
  });
  const summaryItem = stageItems.find((item) => item.state === "pending")
    ?? stageItems.find((item) => item.isCurrent)
    ?? [...stageItems].reverse().find((item) => item.state === "failed" || item.state === "passed");
  const summary = summaryItem
    ? `${processLabel(summaryItem.stage)}: ${stageStateLabel(summaryItem.state)}`
    : "No activity";

  return (
    <div className={compact ? "grid gap-1.5" : "rounded-lg bg-white px-4 py-4"}>
      {label ? <h4 className={compact ? "text-xs font-extrabold text-navy" : "mb-4 font-extrabold text-navy"}>{label}</h4> : null}
      <ol aria-label={ariaLabel ?? label ?? "Candidate pipeline journey"} className={compact ? "flex items-center gap-1.5" : "relative grid gap-4 md:grid-cols-6 md:gap-2 md:justify-items-center"}>
        {!compact ? <span className="absolute left-[8.5%] right-[8.5%] top-3 hidden h-0.5 bg-[#E5E5FB] md:block" /> : null}
        {stageItems.map(({ stage, state, isCurrent }, index) => {
          if (compact) {
            return (
              <li
                key={stage}
                className={`block rounded-full ${isCurrent ? "size-2.5" : "size-2"} ${stageDotClass(state, isCurrent)}`}
                title={`${processLabel(stage)}: ${stageStateLabel(state)}`}
              >
                <span className="sr-only">{processLabel(stage)}: {stageStateLabel(state)}</span>
              </li>
            );
          }

          return (
            <li
              key={stage}
              className="relative z-10 grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-3 md:flex md:w-full md:flex-col md:items-center md:text-center"
            >
              {index < ACTIVE_PIPELINE_STAGES.length - 1 ? (
                <span className="absolute left-3 top-6 h-[calc(100%+1rem)] w-0.5 bg-[#E5E5FB] md:hidden" />
              ) : null}
              <span className={`relative z-10 grid shrink-0 place-items-center rounded-full ring-4 md:mx-auto ${isCurrent ? "size-8" : "size-6"} ${stageDotClass(state, isCurrent)}`}>
                <StageIcon state={state} current={isCurrent} />
              </span>
              <div className="min-w-0 md:mt-3 md:flex md:min-h-[72px] md:flex-col md:items-center md:justify-start">
                <p className="text-xs font-extrabold leading-tight text-navy">{processLabel(stage)}</p>
                <p className="mt-1 text-xs font-medium text-slate">{stageStateLabel(state)}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {showSummary ? <p className="text-[11px] font-bold text-slate">{summary}</p> : null}
    </div>
  );
}

function stageStateFromLogs(logs: RecruitmentLog[], stage: ProcessStage, currentPendingStage?: ProcessStage): StageRailState {
  const stageLogs = logs.filter((log) => log.recruitment_process === stage).sort((a, b) => b.log_id - a.log_id);
  const latest = stageLogs[0];
  if (!latest) return "unreached";
  if (latest.result === 0) return "failed";
  if (latest.result === 1) return "passed";
  return currentPendingStage === stage ? "pending" : "unreached";
}

function stageStateFromCurrent(stage: ProcessStage, index: number, activeIndex: number, currentResult?: number | null): StageRailState {
  if (activeIndex === -1) return "unreached";
  if (index < activeIndex) return "passed";
  if (index > activeIndex) return "unreached";
  if (currentResult === 0) return "failed";
  if (currentResult === 1) return "passed";
  return "pending";
}

function stageDotClass(state: StageRailState, current: boolean) {
  if (state === "passed") return current ? "bg-emerald ring-[#DDF8EF] text-white" : "bg-emerald ring-[#E8FFF7] text-white";
  if (state === "failed") return current ? "bg-scarlet ring-[#FFE1E1] text-white" : "bg-scarlet ring-[#FFF1F0] text-white";
  if (state === "pending") return current ? "bg-amber ring-[#FFF4CC] text-navy" : "bg-amber ring-[#FFF8E1] text-navy";
  return "bg-[#E5E5FB] ring-[#EEF4FF] text-slate";
}

function StageIcon({ state, current }: { state: StageRailState; current: boolean }) {
  if (!current) return null;
  if (state === "passed") return <Check size={14} strokeWidth={3} />;
  if (state === "failed") return <X size={14} strokeWidth={3} />;
  if (state === "pending") return <Clock3 size={14} strokeWidth={2.5} />;
  return <Circle size={10} strokeWidth={3} />;
}

function stageStateLabel(state: StageRailState) {
  if (state === "passed") return "Passed";
  if (state === "failed") return "Failed";
  if (state === "pending") return "Current";
  return "Not reached";
}
