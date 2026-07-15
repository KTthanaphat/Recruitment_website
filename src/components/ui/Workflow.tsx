import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, MoreVertical, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { formatDate } from "@/lib/format";
import type {
  BulkActionResult,
  DataQualityIssue,
  DisabledReason,
  PipelineBottleneckSummary,
  SourcingConversionMetric,
  StageHealth
} from "@/lib/operations";

export function DisabledReasonHint({ reason }: { reason: DisabledReason }) {
  if (!reason.blocked) return null;
  return (
    <div className="rounded-md border border-[#F3D3A2] bg-[#FFF7E8] p-3 text-xs text-slate" role="note">
      <p className="font-semibold text-orange">{reason.label}</p>
      <p className="mt-1 font-medium">Reason: {hintDetail(reason)}</p>
      {reason.recovery ? <p className="mt-1 font-medium text-cool">Recovery: {reason.recovery}</p> : null}
    </div>
  );
}

export function DataQualityPanel({
  compact = false,
  disabledReasonForIssue,
  expandable = false,
  issues,
  limit,
  onResolve,
  scrollThreshold,
  title = "Data Quality"
}: {
  compact?: boolean;
  disabledReasonForIssue?: (issue: DataQualityIssue) => DisabledReason | undefined;
  expandable?: boolean;
  issues: DataQualityIssue[];
  limit?: number;
  onResolve?: (issue: DataQualityIssue) => void;
  scrollThreshold?: number;
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const horizontal = Boolean(scrollThreshold && issues.length > scrollThreshold);
  const visibleLimit = horizontal ? undefined : limit ?? (compact ? 5 : undefined);
  const shouldLimit = Boolean(visibleLimit && visibleLimit > 0 && issues.length > visibleLimit && (!expandable || !expanded));
  const visible = shouldLimit && visibleLimit ? issues.slice(0, visibleLimit) : issues;
  return (
    <Panel variant={compact ? "subtle" : "section"}>
      <SectionTitle
        title={title}
        eyebrow={`${issues.length} issue${issues.length === 1 ? "" : "s"}`}
      />
      {visible.length === 0 ? (
        <div className="rounded-md border border-[#C9D5E6] bg-[#F8FAFD] p-3 text-sm font-medium text-primary">No data quality issues detected for this view.</div>
      ) : (
        <div className={horizontal ? "flex snap-x gap-3 overflow-x-auto overscroll-x-contain pb-2" : "grid gap-2"} data-home-scroll-section={horizontal ? title : undefined}>
          {visible.map((issue) => (
            <div key={issue.id} className={horizontal ? "w-[min(22rem,82vw)] shrink-0 snap-start" : ""}>
              <IssueRow disabledReason={disabledReasonForIssue?.(issue)} issue={issue} onResolve={onResolve} />
            </div>
          ))}
          {expandable && visibleLimit && issues.length > visibleLimit && !expanded ? (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate ring-1 ring-inset ring-[#C9D5E6] transition-colors hover:bg-[#F8FAFD] hover:text-navy focus:outline-none focus:ring-2 focus:ring-primary/30"
                aria-label={`Show all ${issues.length} data quality issues`}
                title={`Show all ${issues.length} data quality issues`}
                onClick={() => setExpanded(true)}
              >
                <MoreVertical size={16} aria-hidden="true" />
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

export function InlineDataQualityIssues({ issues }: { issues: DataQualityIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="grid gap-2">
      {issues.slice(0, 3).map((issue) => <IssueRow key={issue.id} issue={issue} compact />)}
    </div>
  );
}

function IssueRow({ compact = false, disabledReason, issue, onResolve }: { compact?: boolean; disabledReason?: DisabledReason; issue: DataQualityIssue; onResolve?: (issue: DataQualityIssue) => void }) {
  const Icon = issue.severity === "blocking" ? ShieldAlert : issue.severity === "warning" ? AlertTriangle : Info;
  return (
    <div className={`grid gap-2 rounded-md border p-3 ${issueClass(issue.severity)} ${compact ? "text-xs" : "text-sm"} sm:grid-cols-[auto_1fr_auto] sm:items-start`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold text-navy">{issue.title}</p>
        <p className="mt-0.5 font-medium text-slate">{issue.detail}</p>
      </div>
      {onResolve && issue.actionLabel ? (
        <button type="button" disabled={disabledReason?.blocked} title={disabledReason?.detail} className="inline-flex min-h-8 items-center rounded-md bg-white px-3 text-xs font-semibold text-primary ring-1 ring-inset ring-[#C9D5E6] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:bg-lightgray disabled:text-cool" onClick={() => onResolve(issue)}>
          {issue.actionLabel}
        </button>
      ) : issue.href && issue.actionLabel ? (
        <Link className="inline-flex min-h-8 items-center rounded-md bg-white px-3 text-xs font-semibold text-primary ring-1 ring-inset ring-[#C9D5E6] hover:bg-[#F8FAFD]" href={issue.href}>
          {issue.actionLabel}
        </Link>
      ) : <Tag tone={issue.severity === "blocking" ? "danger" : issue.severity === "warning" ? "warning" : "muted"}>{issue.severity}</Tag>}
    </div>
  );
}

export function BottleneckSummaryPanel({ summary }: { summary: PipelineBottleneckSummary }) {
  return (
    <div className="rounded-lg border border-[#D7DEE8] bg-white p-4 shadow-[0_8px_20px_rgba(11,19,43,0.03)]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-slate">Pipeline Bottleneck</p>
          <h3 className="mt-1 text-lg font-semibold text-navy">{summary.mainStage}</h3>
        </div>
        <Tag tone={summary.overSlaCount > 0 ? "warning" : "success"}>{summary.overSlaCount} over SLA</Tag>
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <Metric label="Oldest candidate" value={summary.oldestCandidate} />
        <Metric label="Risk owner" value={summary.highestRiskOwner} />
        <Metric label="Risk site" value={summary.highestRiskSite} />
        <Metric label="Offer pending" value={summary.offerPendingCount} />
        <Metric label="Repeat tests" value={summary.testRepeatCount} />
      </div>
    </div>
  );
}

export function StageHealthHeader({ health }: { health: StageHealth }) {
  return (
    <div className="grid gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {health.overSlaCount > 0 ? (
            <AlertTriangle className="shrink-0 text-scarlet" size={14} aria-label="Warning" />
          ) : null}
          <h3 className={`truncate text-sm font-semibold ${health.overSlaCount > 0 ? "text-scarlet" : "text-navy"}`}>{health.stage}</h3>
        </div>
        <Tag tone="muted">{health.count}</Tag>
      </div>
      <p className="text-[10px] font-medium leading-tight text-cool">
        Over SLA {health.overSlaCount} - Oldest {dayValue(health.oldestAge)} - Average {dayValue(health.averageAge)}
      </p>
      <p className="text-[10px] font-medium leading-tight text-cool">
        Pass {health.passCount} / Fail {health.failCount} - Latest {formatDate(health.latestMovementDate)}
      </p>
    </div>
  );
}

export function SourcingConversionPanel({
  collapsible = false,
  defaultOpen = true,
  metrics,
  title = "Sourcing Conversion Quality"
}: {
  collapsible?: boolean;
  defaultOpen?: boolean;
  metrics: SourcingConversionMetric[];
  title?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const active = metrics.filter((metric) => metric.applicants > 0 || metric.candidates > 0 || metric.previousApplicants > 0);
  return (
    <div className="rounded-md border border-[#D7DEE8] bg-[#F8FAFD] p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {collapsible ? (
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-2 rounded-sm text-left text-sm font-semibold text-navy focus:outline-none focus:ring-2 focus:ring-primary/25"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            <ChevronDown size={16} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} aria-hidden="true" />
            <span className="truncate">{title}</span>
          </button>
        ) : (
          <strong className="text-sm text-navy">{title}</strong>
        )}
        <Tag tone="muted">{active.length} active channels</Tag>
      </div>
      {!open ? null : active.length === 0 ? (
        <p className="text-sm font-medium text-slate">No applicant or candidate conversion activity for the selected period.</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {active.map((metric) => (
            <div key={`${metric.groupId}:${metric.channel}`} className="rounded-md border border-[#D7DEE8] bg-white p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <strong className="text-sm text-navy">{metric.channel}</strong>
                <Tag tone={healthTone(metric.health)}>{healthLabel(metric.health)}</Tag>
              </div>
              <p className="text-xs font-medium text-slate">Applicants {metric.applicants} ({signedDelta(metric.applicants - metric.previousApplicants)})</p>
              <p className="text-xs font-medium text-slate">Candidates {metric.candidates} - Test {metric.reachedTest} - Offer {metric.reachedOffer}</p>
              <p className="text-xs font-medium text-slate">Accepted {metric.acceptedOffers} - Conv {percent(metric.applicantToCandidateRate)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function BulkActionToolbar({
  disabledReason,
  entityLabel,
  onClear,
  onExport,
  onOpenReview,
  selectedCount
}: {
  disabledReason?: DisabledReason;
  entityLabel: string;
  onClear: () => void;
  onExport: () => void;
  onOpenReview?: () => void;
  selectedCount: number;
}) {
  if (selectedCount === 0) return null;
  return (
    <div className="sticky bottom-3 z-20 mt-3 grid gap-2 rounded-lg border border-[#C9D5E6] bg-white p-3 shadow-[0_14px_34px_rgba(11,19,43,0.08)] md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <p className="text-sm font-semibold text-navy">{selectedCount} {entityLabel} selected</p>
        {disabledReason?.blocked ? <p className="mt-1 text-xs font-medium text-orange">{disabledReason.detail}</p> : <p className="mt-1 text-xs font-medium text-slate">Bulk actions are reviewed before any write operation.</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onExport}>Export selected</Button>
        {onOpenReview ? <Button type="button" size="sm" variant="secondary" disabled={disabledReason?.blocked} onClick={onOpenReview}>Review action</Button> : null}
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>Clear</Button>
      </div>
    </div>
  );
}

export function BulkReviewModal({
  actionLabel,
  busy = false,
  ids,
  onClose,
  onConfirm,
  open,
  result,
  warnings = []
}: {
  actionLabel: string;
  busy?: boolean;
  ids: string[];
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  result?: BulkActionResult | null;
  warnings?: DataQualityIssue[];
}) {
  return (
    <Modal open={open} title="Review Bulk Action" onClose={onClose} width="max-w-2xl">
      <div className="grid gap-4">
        <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3">
          <p className="text-sm font-semibold text-navy">{actionLabel}</p>
          <p className="mt-1 text-sm font-medium text-slate">{ids.length} records selected.</p>
        </div>
        {warnings.length > 0 ? <InlineDataQualityIssues issues={warnings.slice(0, 4)} /> : null}
        {result ? (
          <div className="rounded-md border border-[#C9D5E6] bg-[#F8FAFD] p-3 text-sm font-medium text-primary">
            <CheckCircle2 className="mr-1 inline" size={16} /> {result.succeeded.length} succeeded, {result.skipped.length} skipped, {result.failed.length} failed.
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>Confirm</Button>
        </div>
      </div>
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-[#D7DEE8] bg-lightgray/70 p-3">
      <p className="text-xs font-medium text-slate">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-navy">{value}</p>
    </div>
  );
}

function issueClass(severity: DataQualityIssue["severity"]) {
  if (severity === "blocking") return "border-[#F4B4AE] bg-[#FFF8F7]";
  if (severity === "warning") return "border-[#F3D3A2] bg-[#FFFDF5]";
  return "border-[#D7DEE8] bg-[#F8FAFD]";
}

function dayValue(value: number | null) {
  return value === null ? "-" : `${value}d`;
}

function percent(value: number | null) {
  return value === null ? "-" : `${Math.round(value * 100)}%`;
}

function signedDelta(value: number) {
  if (value > 0) return `+${value}`;
  return String(value);
}

function healthLabel(value: SourcingConversionMetric["health"]) {
  return value.replaceAll("_", " ");
}

function healthTone(value: SourcingConversionMetric["health"]) {
  if (value === "strong_source" || value === "good_late_stage_quality") return "success" as const;
  if (value === "high_volume_low_conversion" || value === "needs_review") return "warning" as const;
  return "muted" as const;
}

function hintDetail(reason: DisabledReason) {
  return reason.detail;
}
