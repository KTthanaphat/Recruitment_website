import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, Info, MoreVertical, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { formatDate, formatNumber } from "@/lib/format";
import { severityLabel, translate } from "@/lib/i18n/dictionary";
import type { Language } from "@/types/recruitment";
import type {
  BulkActionResult,
  DataQualityIssue,
  DisabledReason,
  PipelineBottleneckSummary,
  SourcingConversionMetric,
  StageHealth
} from "@/lib/operations";

export function DisabledReasonHint({ language = "en", reason }: { language?: Language; reason: DisabledReason }) {
  if (!reason.blocked) return null;
  return (
    <div className="rounded-md border border-[#F3D3A2] bg-[#FFF7E8] p-3 text-xs text-slate" role="note">
      <p className="font-semibold text-orange">{reason.label}</p>
      <p className="mt-1 font-medium">{translate(language, "reason")}: {hintDetail(reason)}</p>
      {reason.recovery ? <p className="mt-1 font-medium text-cool">{translate(language, "recovery")}: {reason.recovery}</p> : null}
    </div>
  );
}

export function DataQualityPanel({
  compact = false,
  disabledReasonForIssue,
  expandable = false,
  issues,
  language = "en",
  limit,
  onResolve,
  scrollThreshold,
  title
}: {
  compact?: boolean;
  disabledReasonForIssue?: (issue: DataQualityIssue) => DisabledReason | undefined;
  expandable?: boolean;
  issues: DataQualityIssue[];
  language?: Language;
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
  const resolvedTitle = title ?? translate(language, "dataQuality");
  return (
    <Panel variant={compact ? "subtle" : "section"}>
      <SectionTitle
        title={resolvedTitle}
        eyebrow={translate(language, "recordsCount", { result: formatNumber(issues.length, language), total: formatNumber(issues.length, language) })}
      />
      {visible.length === 0 ? (
        <div className="rounded-md border border-[#D7DEE8] bg-white p-3 text-sm font-medium text-slate">{translate(language, "noDataQualityIssues")}</div>
      ) : (
        <div className={horizontal ? "flex snap-x gap-3 overflow-x-auto overscroll-x-contain pb-2" : "grid gap-2"} data-home-scroll-section={horizontal ? resolvedTitle : undefined}>
          {visible.map((issue) => (
            <div key={issue.id} className={horizontal ? "w-[min(22rem,82vw)] shrink-0 snap-start" : ""}>
              <DataQualityIssueCard disabledReason={disabledReasonForIssue?.(issue)} issue={issue} language={language} onResolve={onResolve} />
            </div>
          ))}
          {expandable && visibleLimit && issues.length > visibleLimit && !expanded ? (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate ring-1 ring-inset ring-[#D7DEE8] transition-colors hover:bg-[#F8FAFD] hover:text-navy focus:outline-none focus:ring-2 focus:ring-primary/30"
                aria-label={translate(language, "showAllDataQualityIssues", { count: formatNumber(issues.length, language) })}
                title={translate(language, "showAllDataQualityIssues", { count: formatNumber(issues.length, language) })}
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

export function InlineDataQualityIssues({ issues, language = "en" }: { issues: DataQualityIssue[]; language?: Language }) {
  if (issues.length === 0) return null;
  return (
    <div className="grid gap-2">
      {issues.slice(0, 3).map((issue) => <DataQualityIssueCard key={issue.id} issue={issue} compact language={language} />)}
    </div>
  );
}

export function DataQualityIssueCard({ compact = false, disabledReason, issue, language = "en", onResolve }: { compact?: boolean; disabledReason?: DisabledReason; issue: DataQualityIssue; language?: Language; onResolve?: (issue: DataQualityIssue) => void }) {
  const Icon = issue.severity === "blocking" ? ShieldAlert : issue.severity === "warning" ? AlertTriangle : Info;
  return (
    <div className={`grid gap-2 rounded-md border p-3 ${issueClass(issue.severity)} ${compact ? "text-xs" : "text-sm"} sm:grid-cols-[auto_1fr_auto] sm:items-start`}>
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold text-navy">{issue.title}</p>
        <p className="mt-0.5 font-medium text-slate">{issue.detail}</p>
      </div>
      {onResolve && issue.actionLabel ? (
        <button type="button" disabled={disabledReason?.blocked} title={disabledReason?.detail} className="inline-flex min-h-8 items-center rounded-md bg-white px-3 text-xs font-semibold text-navy ring-1 ring-inset ring-[#D7DEE8] hover:bg-[#F8FAFD] disabled:cursor-not-allowed disabled:bg-lightgray disabled:text-cool" onClick={() => onResolve(issue)}>
          {issue.actionLabel}
        </button>
      ) : issue.href && issue.actionLabel ? (
        <Link className="inline-flex min-h-8 items-center rounded-md bg-white px-3 text-xs font-semibold text-navy ring-1 ring-inset ring-[#D7DEE8] hover:bg-[#F8FAFD]" href={issue.href}>
          {issue.actionLabel}
        </Link>
      ) : <Tag tone={issue.severity === "blocking" ? "danger" : issue.severity === "warning" ? "warning" : "muted"}>{severityLabel(language, issue.severity)}</Tag>}
    </div>
  );
}

export function BottleneckSummaryPanel({ language = "en", summary }: { language?: Language; summary: PipelineBottleneckSummary }) {
  return (
    <div className="rounded-lg border border-[#D7DEE8] bg-white p-4 shadow-[0_4px_14px_rgba(11,19,43,0.025)]">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-normal text-slate">{translate(language, "pipelineBottleneck")}</p>
          <h3 className="mt-1 text-lg font-semibold text-navy">{summary.mainStage}</h3>
        </div>
        <Tag tone={summary.overSlaCount > 0 ? "warning" : "success"}>{translate(language, "overSla", { count: formatNumber(summary.overSlaCount, language) })}</Tag>
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]">
        <Metric label={translate(language, "oldestCandidate")} value={summary.oldestCandidate} />
        <Metric label={translate(language, "riskOwner")} value={summary.highestRiskOwner} />
        <Metric label={translate(language, "riskSite")} value={summary.highestRiskSite} />
        <Metric label={translate(language, "offerPending")} value={formatNumber(summary.offerPendingCount, language)} />
        <Metric label={translate(language, "repeatTests")} value={formatNumber(summary.testRepeatCount, language)} />
      </div>
    </div>
  );
}

export function StageHealthHeader({ health, language = "en" }: { health: StageHealth; language?: Language }) {
  return (
    <div className="grid gap-0.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {health.overSlaCount > 0 ? (
            <AlertTriangle className="shrink-0 text-scarlet" size={14} aria-label={translate(language, "warning")} />
          ) : null}
          <h3 className={`truncate text-sm font-semibold ${health.overSlaCount > 0 ? "text-scarlet" : "text-navy"}`}>{health.stage}</h3>
        </div>
        <Tag tone="muted">{health.count}</Tag>
      </div>
      <p className="text-[10px] font-medium leading-tight text-cool">
        SLA {formatNumber(health.overSlaCount, language)} - {translate(language, "oldest")} {dayValue(health.oldestAge)} - {translate(language, "average")} {dayValue(health.averageAge)}
      </p>
      <p className="text-[10px] font-medium leading-tight text-cool">
        {translate(language, "passFailLatest", { pass: formatNumber(health.passCount, language), fail: formatNumber(health.failCount, language), latest: formatDate(health.latestMovementDate, language) })}
      </p>
    </div>
  );
}

export function SourcingConversionPanel({
  collapsible = false,
  defaultOpen = true,
  language = "en",
  metrics,
  title
}: {
  collapsible?: boolean;
  defaultOpen?: boolean;
  language?: Language;
  metrics: SourcingConversionMetric[];
  title?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const active = metrics.filter((metric) => metric.applicants > 0 || metric.candidates > 0 || metric.previousApplicants > 0);
  const resolvedTitle = title ?? translate(language, "sourcingConversionQuality");
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
            <span className="truncate">{resolvedTitle}</span>
          </button>
        ) : (
          <strong className="text-sm text-navy">{resolvedTitle}</strong>
        )}
        <Tag tone="muted">{translate(language, "activeChannels", { count: formatNumber(active.length, language) })}</Tag>
      </div>
      {!open ? null : active.length === 0 ? (
        <p className="text-sm font-medium text-slate">{translate(language, "noConversionActivity")}</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {active.map((metric) => (
            <div key={`${metric.groupId}:${metric.channel}`} className="rounded-md border border-[#D7DEE8] bg-white p-3">
              <div className="mb-2 flex items-start justify-between gap-2">
                <strong className="text-sm text-navy">{metric.channel}</strong>
                <Tag tone={healthTone(metric.health)}>{healthLabel(language, metric.health)}</Tag>
              </div>
              <p className="text-xs font-medium text-slate">{translate(language, "applicantsWithDelta", { count: formatNumber(metric.applicants, language), delta: signedDelta(metric.applicants - metric.previousApplicants) })}</p>
              <p className="text-xs font-medium text-slate">{translate(language, "candidatesTestOffer", { candidates: formatNumber(metric.candidates, language), test: formatNumber(metric.reachedTest, language), offer: formatNumber(metric.reachedOffer, language) })}</p>
              <p className="text-xs font-medium text-slate">{translate(language, "acceptedConversion", { accepted: formatNumber(metric.acceptedOffers, language), conversion: percent(metric.applicantToCandidateRate) })}</p>
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
  language = "en",
  onClear,
  onExport,
  onOpenReview,
  selectedCount
}: {
  disabledReason?: DisabledReason;
  entityLabel: string;
  language?: Language;
  onClear: () => void;
  onExport: () => void;
  onOpenReview?: () => void;
  selectedCount: number;
}) {
  if (selectedCount === 0) return null;
  return (
    <div className="sticky bottom-3 z-20 mt-3 grid gap-2 rounded-lg border border-[#D7DEE8] bg-white p-3 shadow-[0_12px_30px_rgba(11,19,43,0.07)] md:grid-cols-[1fr_auto] md:items-center">
      <div>
        <p className="text-sm font-semibold text-navy">{translate(language, "selectedCount", { count: formatNumber(selectedCount, language), entity: entityLabel })}</p>
        {disabledReason?.blocked ? <p className="mt-1 text-xs font-medium text-orange">{disabledReason.detail}</p> : <p className="mt-1 text-xs font-medium text-slate">{translate(language, "bulkReviewNote")}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="secondary" onClick={onExport}>{translate(language, "exportSelected")}</Button>
        {onOpenReview ? <Button type="button" size="sm" variant="secondary" disabled={disabledReason?.blocked} onClick={onOpenReview}>{translate(language, "reviewAction")}</Button> : null}
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>{translate(language, "clear")}</Button>
      </div>
    </div>
  );
}

export function BulkReviewModal({
  actionLabel,
  busy = false,
  ids,
  language = "en",
  onClose,
  onConfirm,
  open,
  result,
  warnings = []
}: {
  actionLabel: string;
  busy?: boolean;
  ids: string[];
  language?: Language;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
  result?: BulkActionResult | null;
  warnings?: DataQualityIssue[];
}) {
  return (
    <Modal open={open} title={translate(language, "reviewBulkAction")} closeLabel={translate(language, "close")} onClose={onClose} width="max-w-2xl">
      <div className="grid gap-4">
        <div className="rounded-md border border-[#D7DEE8] bg-lightgray p-3">
          <p className="text-sm font-semibold text-navy">{actionLabel}</p>
          <p className="mt-1 text-sm font-medium text-slate">{translate(language, "recordsSelected", { count: formatNumber(ids.length, language) })}</p>
        </div>
        {warnings.length > 0 ? <InlineDataQualityIssues issues={warnings.slice(0, 4)} language={language} /> : null}
        {result ? (
          <div className="rounded-md border border-[#D7DEE8] bg-white p-3 text-sm font-medium text-navy">
            <CheckCircle2 className="mr-1 inline" size={16} /> {translate(language, "bulkResult", { succeeded: formatNumber(result.succeeded.length, language), skipped: formatNumber(result.skipped.length, language), failed: formatNumber(result.failed.length, language) })}
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{translate(language, "cancel")}</Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>{translate(language, "confirm")}</Button>
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
  return "border-[#D7DEE8] bg-white";
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

function healthLabel(language: Language, value: SourcingConversionMetric["health"]) {
  if (value === "strong_source" || value === "good_late_stage_quality") return translate(language, "healthGood");
  if (value === "high_volume_low_conversion" || value === "needs_review") return translate(language, "healthWatch");
  return translate(language, "healthWeak");
}

function healthTone(value: SourcingConversionMetric["health"]) {
  if (value === "strong_source" || value === "good_late_stage_quality") return "success" as const;
  if (value === "high_volume_low_conversion" || value === "needs_review") return "warning" as const;
  return "muted" as const;
}

function hintDetail(reason: DisabledReason) {
  return reason.detail;
}
