"use client";

import { BriefcaseBusiness, HandCoins, UsersRound, Workflow } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, TextInput } from "@/components/ui/Field";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { StatCard } from "@/components/ui/StatCard";
import { Tag } from "@/components/ui/Tag";
import { ACTIVE_PIPELINE_STAGES, processLabel } from "@/lib/constants";
import { formatDateTime, statusTone, toTitle } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type {
  ChangeLog,
  EnrichedCandidate,
  EnrichedOffer,
  EnrichedRequisition,
  Language,
  Profile,
  RequisitionRequestType,
  VacancyWaterfallCategory
} from "@/types/recruitment";

const siteOrder = ["HQ", "KT1", "KT2"];

export function DashboardOverviewView({
  language,
  profile,
  requisitions,
  candidates,
  offers,
  changeLogs,
  onOpenRequisition,
  onOpenCandidate
}: {
  language: Language;
  profile: Profile | null;
  requisitions: EnrichedRequisition[];
  candidates: EnrichedCandidate[];
  offers: EnrichedOffer[];
  changeLogs: ChangeLog[];
  onOpenRequisition: (docId: string) => void;
  onOpenCandidate: (candidateId: string) => void;
}) {
  const [startDate, setStartDate] = useState(currentYearStart());
  const [endDate, setEndDate] = useState(today());

  const activeRequisitions = requisitions.filter((row) => row.status === "ongoing");
  const acceptedOffers = requisitions.reduce((sum, row) => sum + row.accepted_count, 0);
  const openHeadcount = requisitions.reduce((sum, row) => sum + row.open_headcount, 0);
  const ownerName = profile?.nickname ?? profile?.full_name ?? "";
  const responsibleUnfilled = activeRequisitions.filter((row) => row.open_headcount > 0 && row.person_in_charge === ownerName);
  const ongoingCandidates = candidates.filter(
    (row) => row.latest_process !== "No activity"
      && ACTIVE_PIPELINE_STAGES.includes(row.latest_process)
      && row.latest_result !== 0
      && !row.accepted_date
  );
  const needsAction = activeRequisitions
    .filter((row) => row.open_headcount > 0)
    .sort((a, b) => b.open_headcount - a.open_headcount)
    .slice(0, 6);
  const pipelinePreview = ongoingCandidates.slice(0, 8);
  const waterfallRows = useMemo(
    () => buildLiveWaterfallRows(requisitions, offers, startDate, endDate),
    [endDate, offers, requisitions, startDate]
  );

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label={translate(language, "activeRequisitions")} value={activeRequisitions.length} icon={<BriefcaseBusiness size={22} />} />
        <StatCard label={translate(language, "responsibleUnfilled")} value={responsibleUnfilled.length} icon={<BriefcaseBusiness size={22} />} />
        <StatCard label={translate(language, "ongoingCandidates")} value={ongoingCandidates.length} icon={<UsersRound size={22} />} />
        <StatCard label={translate(language, "candidateCount")} value={candidates.length} icon={<UsersRound size={22} />} />
        <StatCard label={translate(language, "acceptedOffers")} value={acceptedOffers} icon={<HandCoins size={22} />} />
        <StatCard label={translate(language, "openHeadcount")} value={openHeadcount} icon={<Workflow size={22} />} />
      </div>

      <section className="min-w-0 bg-white py-6 font-light">
        <div className="mb-9 grid gap-5 px-4 sm:px-6 lg:grid-cols-[1fr_auto] lg:items-start lg:px-8">
          <h2 className="text-2xl font-semibold tracking-normal text-navy sm:text-[28px]">{translate(language, "vacancyWaterfall")}</h2>
          <div className="grid gap-3 sm:flex sm:items-start sm:justify-end">
            <Field label={translate(language, "startDate")} className="text-xs font-light">
              <TextInput
                className="min-h-9 w-full rounded-md border border-[#D7DEE8] bg-white px-2.5 py-1.5 text-sm font-light text-navy shadow-none focus:border-electric sm:w-36"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field label={translate(language, "endDate")} className="text-xs font-light">
              <TextInput
                className="min-h-9 w-full rounded-md border border-[#D7DEE8] bg-white px-2.5 py-1.5 text-sm font-light text-navy shadow-none focus:border-electric sm:w-36"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </Field>
          </div>
        </div>
        {waterfallRows.length === 0 ? (
          <div className="px-4 sm:px-6 lg:px-8">
            <EmptyState message={translate(language, "noWaterfallData")} />
          </div>
        ) : (
          <VacancyWaterfallChart language={language} rows={waterfallRows} />
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <SectionTitle
            title={translate(language, "needsAction")}
            action={<Link className="text-sm font-bold text-primary" href="/requisitions">{translate(language, "openList")}</Link>}
          />
          <div className="grid gap-2">
            {needsAction.length === 0 ? (
              <EmptyState message={translate(language, "noOpenHeadcount")} />
            ) : (
              needsAction.map((row) => (
                <button
                  key={row.doc_id}
                  type="button"
                  className="grid gap-1 rounded-md border border-[#D7DEE8] bg-white p-3 text-left transition hover:bg-[#EEF4FF]"
                  onClick={() => onOpenRequisition(row.doc_id)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-navy">{row.doc_id} - {row.position}</strong>
                    <Tag tone="warning">{row.open_headcount} {translate(language, "open")}</Tag>
                  </div>
                  <p className="text-sm font-bold text-slate">{row.department} - {row.site} - {row.person_in_charge ?? translate(language, "unassigned")}</p>
                </button>
              ))
            )}
          </div>
        </Panel>

        <Panel>
          <SectionTitle
            title={translate(language, "recentActivity")}
            action={<Link className="text-sm font-bold text-primary" href="/audit">{translate(language, "audit")}</Link>}
          />
          <div className="grid gap-2">
            {changeLogs.length === 0 ? (
              <EmptyState message={translate(language, "noRecentActivity")} />
            ) : (
              changeLogs.slice(0, 6).map((log) => (
                <div key={log.log_id} className="rounded-md border border-[#D7DEE8] bg-lightgray/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-navy">{toTitle(log.entity)} - {log.entity_id}</strong>
                    <Tag tone={statusTone(log.action) as never}>{log.action}</Tag>
                  </div>
                  <p className="mt-1 text-sm font-bold text-slate">{log.changed_by_email ?? translate(language, "system")} - {formatDateTime(log.changed_at)}</p>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>

      <Panel>
        <SectionTitle
          title={translate(language, "candidatePipeline")}
          action={<Link className="text-sm font-bold text-primary" href="/pipeline">{translate(language, "fullPipeline")}</Link>}
        />
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {pipelinePreview.length === 0 ? (
            <div className="md:col-span-2 xl:col-span-4">
              <EmptyState message={translate(language, "noActiveCandidates")} />
            </div>
          ) : (
            pipelinePreview.map((candidate) => (
              <button
                type="button"
                key={candidate.candidate_id}
                className="rounded-md border border-[#D7DEE8] bg-white p-3 text-left transition hover:-translate-y-0.5 hover:shadow-panel"
                onClick={() => onOpenCandidate(candidate.candidate_id)}
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <strong className="text-navy">{candidate.name}</strong>
                  <Tag tone="teal">{processLabel(candidate.latest_process)}</Tag>
                </div>
                <p className="text-sm font-bold text-slate">{candidate.candidate_id} - {candidate.group_position ?? "-"}</p>
                <p className="text-sm font-bold text-slate">{candidate.site ?? "-"} - {candidate.person_in_charge ?? translate(language, "unassigned")}</p>
              </button>
            ))
          )}
        </div>
      </Panel>
    </div>
  );
}

type WaterfallRow = {
  waterfall_category: VacancyWaterfallCategory;
  site: string;
  request_type: RequisitionRequestType;
  vacancy_count: number;
};

function VacancyWaterfallChart({ language, rows }: { language: Language; rows: WaterfallRow[] }) {
  const chart = buildWaterfall(rows);
  const plotWidth = 720;
  const plotHeight = 480;
  const width = 1120;
  const topPad = 72;
  const bottomPad = 58;
  const height = topPad + plotHeight + bottomPad;
  const leftPad = 70;
  const plotRight = leftPad + plotWidth;
  const yMin = 0;
  const yMax = chart.yMax;
  const yScale = (value: number) => topPad + ((yMax - Math.max(value, 0)) / Math.max(yMax - yMin, 1)) * plotHeight;
  const step = plotWidth / Math.max(chart.categories.length, 1);
  const barWidth = Math.min(96, Math.max(52, step * 0.5));
  const zeroY = yScale(0);
  const totalBar = chart.bars.find((bar) => bar.categoryType === "total");
  const totalBarRight = totalBar ? categoryX(totalBar.categoryIndex, step, leftPad) + barWidth / 2 : plotRight;

  return (
    <div className="w-full pb-2">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <h3 className="text-2xl font-light leading-tight tracking-normal text-navy sm:text-[26px]">
          {translate(language, "weeklyRecruitmentPerformance")}
        </h3>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
          {chart.legend.map((item) => (
            <div key={item.label} className="flex items-center gap-2 text-sm font-light text-slate">
              <span className="h-3 w-3 shrink-0" style={{ backgroundColor: item.color }} />
              <span>{formatLegendLabel(language, item.label)}</span>
            </div>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="block aspect-[3/2] h-auto w-full max-w-full">
        {totalBar ? (
          <RightSegmentBrackets
            x={totalBarRight + 24}
            segments={totalBar.segments.map((segment) => ({
              key: segment.key,
              label: segment.label,
              yTop: yScale(segment.top),
              yBottom: yScale(segment.bottom)
            }))}
            fallbackLabel={chart.totalBreakdown[0]?.label ?? "No remaining vacancy"}
          />
        ) : null}
        <line x1={leftPad} x2={plotRight} y1={zeroY} y2={zeroY} stroke="#475569" strokeWidth={1} />
        <line x1={leftPad} x2={leftPad} y1={topPad} y2={zeroY} stroke="#475569" strokeWidth={2} />
        {chart.yTicks.filter((tick) => tick > 0).map((tick) => {
          const y = yScale(tick);
          return (
            <g key={tick}>
              <line x1={leftPad - 8} x2={leftPad} y1={y} y2={y} stroke="#475569" strokeWidth={1.5} />
              <text x={leftPad - 18} y={y + 8} textAnchor="end" className="fill-slate text-[22px] font-light">{tick}</text>
            </g>
          );
        })}
        {chart.connectors.map((connector) => {
          const x1 = categoryX(connector.from, step, leftPad) + barWidth / 2;
          const x2 = categoryX(connector.to, step, leftPad) - barWidth / 2;
          const y = yScale(connector.value);
          return (
            <line
              key={`${connector.from}-${connector.to}`}
              x1={x1}
              x2={x2}
              y1={y}
              y2={y}
              stroke="#64748B"
              strokeWidth={1.5}
            />
          );
        })}
        {chart.bars.map((bar) => {
          const x = categoryX(bar.categoryIndex, step, leftPad) - barWidth / 2;
          return (
            <g key={bar.key}>
              {bar.segments.map((segment) => {
                const yA = yScale(segment.bottom);
                const yB = yScale(segment.top);
                const y = Math.min(yA, yB);
                const rectHeight = Math.max(Math.abs(yB - yA), 1);
                return (
                  <rect
                    key={segment.key}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={rectHeight}
                    fill={segment.color}
                    rx={0}
                  />
                );
              })}
              <text x={x + barWidth / 2} y={yScale(bar.labelAnchor) - 14} textAnchor="middle" className="fill-navy text-[24px] font-light">
                {bar.label}
              </text>
            </g>
          );
        })}
        {chart.categories.map((category, index) => (
          <text key={category} x={categoryX(index, step, leftPad)} y={height - 22} textAnchor="middle" className="fill-slate text-[13px] font-semibold">
            {formatCategoryLabel(language, category)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function RightSegmentBrackets({
  x,
  segments,
  fallbackLabel
}: {
  x: number;
  segments: { key: string; label: string; yTop: number; yBottom: number }[];
  fallbackLabel: string;
}) {
  const visibleSegments = segments.filter((segment) => segment.label);
  const items = visibleSegments.length > 0
    ? visibleSegments
    : [{ key: "no-remaining-vacancy", label: fallbackLabel, yTop: 320, yBottom: 372 }];

  return (
    <g>
      {items.map((item) => {
        const top = Math.min(item.yTop, item.yBottom);
        const bottom = Math.max(item.yTop, item.yBottom);
        const mid = (top + bottom) / 2;
        return (
          <path
            key={`${item.key}-bracket`}
            d={`M ${x} ${top} L ${x + 16} ${mid} L ${x} ${bottom}`}
            fill="none"
            stroke="#475569"
            strokeWidth={2.5}
            strokeLinejoin="round"
          />
        );
      })}
      {items.map((item) => {
        const top = Math.min(item.yTop, item.yBottom);
        const bottom = Math.max(item.yTop, item.yBottom);
        const mid = (top + bottom) / 2;
        return (
          <text
            key={`${item.key}-${item.label}`}
            x={x + 34}
            y={mid + 8}
            textAnchor="start"
            className="fill-slate text-[22px] font-light"
          >
            {item.label}
          </text>
        );
      })}
    </g>
  );
}

function buildWaterfall(rows: WaterfallRow[]) {
  const sites = siteOrder.filter((site) => rows.some((row) => row.site === site));
  const categories: string[] = [];
  if (rows.some((row) => row.waterfall_category === "Week Start")) categories.push("Week Start");
  for (const site of sites) if (rows.some((row) => row.waterfall_category === "Open" && row.site === site)) categories.push(`${site} Open`);
  for (const site of sites) if (rows.some((row) => row.waterfall_category === "Filled" && row.site === site)) categories.push(`${site} Filled`);
  if (rows.some((row) => row.waterfall_category === "Total")) categories.push("Total");

  const categoryRows = categories.map((category) => rowsForCategory(rows, category));
  const totals = categoryRows.map((items) => items.reduce((sum, row) => sum + row.vacancy_count, 0));
  const bars = [];
  const connectors = [];
  let running = 0;
  const yMax = waterfallAxisMax(rows);

  for (let index = 0; index < categories.length; index += 1) {
    const category = categories[index];
    const isTotal = category === "Total";
    const isFilled = category.endsWith(" Filled");
    const base = category === "Week Start" || isTotal ? 0 : running;
    const startValue = base;
    const endValue = isTotal ? totals[index] : base + totals[index];
    const segments = [];
    let positiveCursor = base;
    let downwardCursor = base;
    let top = base;

    for (const row of sortSnapshotRows(categoryRows[index])) {
      if (row.vacancy_count === 0) continue;
      const magnitude = Math.abs(row.vacancy_count);
      const isDownward = isFilled || row.vacancy_count < 0;
      const segmentBottom = isDownward ? Math.max(downwardCursor - magnitude, 0) : positiveCursor;
      const segmentTop = isDownward ? downwardCursor : positiveCursor + magnitude;
      if (isDownward) downwardCursor = segmentBottom;
      else positiveCursor = segmentTop;
      top = Math.max(top, segmentTop);
      segments.push({
        key: `${category}-${row.site}-${row.request_type}`,
        label: formatBreakdownLabel(row),
        bottom: segmentBottom,
        top: segmentTop,
        color: snapshotColor(row.site, row.request_type)
      });
    }

    if (!isTotal) {
      running += totals[index];
    }

    bars.push({
      key: category,
      categoryIndex: index,
      segments,
      total: totals[index],
      label: formatChartValue(totals[index], isFilled),
      labelAnchor: Math.max(top, 0),
      startValue,
      endValue,
      topValue: Math.max(startValue, endValue),
      bottomValue: Math.min(startValue, endValue),
      categoryType: categoryType(category)
    });
  }

  for (let index = 0; index < bars.length - 1; index += 1) {
    connectors.push({
      from: index,
      to: index + 1,
      value: connectorValue(bars[index], bars[index + 1])
    });
  }

  return {
    categories,
    bars,
    connectors,
    yTicks: yAxisTicks(yMax),
    yMax,
    legend: stackItems(rows),
    totalBreakdown: totalBreakdown(rows)
  };
}

function categoryType(category: string) {
  if (category === "Week Start") return "weekStart";
  if (category === "Total") return "total";
  if (category.endsWith(" Filled")) return "filled";
  return "open";
}

function connectorValue(
  previous: { categoryType: string; endValue: number; bottomValue: number; topValue: number },
  next: { categoryType: string; startValue: number; endValue: number; topValue: number }
) {
  if (previous.categoryType === "filled" && next.categoryType === "total") return next.topValue;
  if (previous.categoryType === "filled") return previous.bottomValue;
  if (next.categoryType === "filled") return next.startValue;
  if (next.categoryType === "total") return previous.endValue;
  return previous.topValue;
}

function rowsForCategory(rows: WaterfallRow[], category: string) {
  if (category.endsWith(" Open")) return rows.filter((row) => row.waterfall_category === "Open" && row.site === category.replace(" Open", ""));
  if (category.endsWith(" Filled")) return rows.filter((row) => row.waterfall_category === "Filled" && row.site === category.replace(" Filled", ""));
  return rows.filter((row) => row.waterfall_category === category);
}

function sortSnapshotRows(rows: WaterfallRow[]) {
  return [...rows].sort((a, b) => {
    const siteDelta = siteRank(a.site) - siteRank(b.site);
    if (siteDelta !== 0) return siteDelta;
    return requestTypeRank(a.request_type) - requestTypeRank(b.request_type);
  });
}

function siteRank(site: string) {
  const index = siteOrder.indexOf(site);
  return index === -1 ? siteOrder.length : index;
}

function requestTypeRank(requestType: RequisitionRequestType) {
  return requestType === "Replacement" ? 0 : 1;
}

function snapshotColor(site: string, requestType: string) {
  const rep: Record<string, string> = { HQ: "#0AA0C3", KT1: "#146EFA", KT2: "#411EDC" };
  const fresh: Record<string, string> = { HQ: "#90F5EC", KT1: "#80BDFF", KT2: "#C7BCF5" };
  if (requestType === "New") return fresh[site] ?? "#D7DEE8";
  return rep[site] ?? "#475569";
}

function categoryX(index: number, step: number, leftPad: number) {
  return leftPad + step * index + step / 2;
}

function formatChartValue(value: number, isFilled = false) {
  const amount = Math.abs(value).toLocaleString();
  return isFilled || value < 0 ? `(${amount})` : amount;
}

function waterfallAxisMax(rows: WaterfallRow[]) {
  const startTotal = rows
    .filter((row) => row.waterfall_category === "Week Start")
    .reduce((sum, row) => sum + row.vacancy_count, 0);
  const openTotal = rows
    .filter((row) => row.waterfall_category === "Open" && siteOrder.includes(row.site))
    .reduce((sum, row) => sum + Math.max(row.vacancy_count, 0), 0);
  return Math.max(Math.ceil((startTotal + openTotal) * 1.1), 1);
}

function yAxisTicks(max: number) {
  if (max <= 6) {
    return Array.from({ length: max + 1 }, (_, index) => index);
  }

  const step = Math.max(Math.ceil(max / 4), 1);
  return [0, step, step * 2, step * 3, max]
    .filter((value) => value <= max)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((a, b) => a - b);
}

function formatCategoryLabel(language: Language, category: string) {
  if (category === "Week Start") return translate(language, "weekStart");
  if (category === "Total") return translate(language, "total");
  if (category.endsWith(" Open")) return `${category.replace(" Open", "")} ${translate(language, "open")}`;
  if (category.endsWith(" Filled")) return `${category.replace(" Filled", "")} ${translate(language, "filled")}`;
  return category;
}

function formatLegendLabel(language: Language, label: string) {
  const [site, requestType] = label.split(" ");
  const suffix = requestType === "Replacement" ? translate(language, "replacementVacancy") : translate(language, "newVacancy");
  return `${site} ${suffix}`;
}

function totalBreakdown(rows: WaterfallRow[]) {
  const totals = sortSnapshotRows(rows.filter((row) => row.waterfall_category === "Total" && siteOrder.includes(row.site)));
  const visibleTotals = totals.filter((row) => row.vacancy_count !== 0);
  if (visibleTotals.length === 0) return [{ label: "No remaining vacancy" }];

  return visibleTotals.map((row) => ({
    label: formatBreakdownLabel(row)
  }));
}

function formatBreakdownLabel(row: WaterfallRow) {
  return `${row.site}-${row.request_type === "Replacement" ? "REP" : "NEW"}: ${row.vacancy_count.toLocaleString()}`;
}

function stackItems(rows: WaterfallRow[]) {
  const seen = new Set<string>();
  const items = [];
  for (const row of sortSnapshotRows(rows.filter((item) => item.vacancy_count !== 0 && siteOrder.includes(item.site)))) {
    const key = `${row.site}|${row.request_type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      label: `${row.site} ${row.request_type}`,
      color: snapshotColor(row.site, row.request_type)
    });
  }
  return items;
}

function buildLiveWaterfallRows(
  requisitions: EnrichedRequisition[],
  offers: EnrichedOffer[],
  startDate: string,
  endDate: string
): WaterfallRow[] {
  if (!startDate || !endDate || startDate > endDate) return [];

  const rows: WaterfallRow[] = [];
  const requisitionsById = new Map(requisitions.map((row) => [row.doc_id, row]));
  const acceptedOffers = offers.filter((offer) => Boolean(offer.accepted_date));

  for (const requisition of requisitions) {
    if (requisition.status === "cancel") continue;
    if (!siteOrder.includes(requisition.site)) continue;
    const openedDate = dateOnly(requisition.pr_approved_date) ?? dateOnly(requisition.created_at);
    const requestType = requisition.request_type ?? "New";
    if (!openedDate) continue;

    if (openedDate < startDate) {
      const filledBeforeStart = acceptedOffers.filter(
        (offer) => offer.doc_id === requisition.doc_id && dateOnly(offer.accepted_date) !== null && dateOnly(offer.accepted_date)! < startDate
      ).length;
      const openAtStart = Math.max(requisition.head_count - filledBeforeStart, 0);
      if (openAtStart > 0) rows.push(waterfallRow("Week Start", requisition.site, requestType, openAtStart));
    }

    if (openedDate >= startDate && openedDate <= endDate) {
      rows.push(waterfallRow("Open", requisition.site, requestType, requisition.head_count));
    }
  }

  for (const offer of acceptedOffers) {
    const acceptedDate = dateOnly(offer.accepted_date);
    if (!acceptedDate || acceptedDate < startDate || acceptedDate > endDate) continue;

    const requisition = requisitionsById.get(offer.doc_id);
    if (!requisition || requisition.status === "cancel") continue;
    rows.push(waterfallRow("Filled", requisition.site, requisition.request_type ?? "New", -1));
  }

  const groupedRows = aggregateWaterfallRows(rows);
  const totals = new Map<string, WaterfallRow>();
  for (const row of groupedRows) {
    const key = `${row.site}|${row.request_type}`;
    const existing = totals.get(key);
    const value = existing ? existing.vacancy_count + row.vacancy_count : row.vacancy_count;
    totals.set(key, waterfallRow("Total", row.site, row.request_type, value));
  }

  return aggregateWaterfallRows([...groupedRows, ...Array.from(totals.values())]);
}

function waterfallRow(
  waterfallCategory: VacancyWaterfallCategory,
  site: string,
  requestType: RequisitionRequestType,
  vacancyCount: number
): WaterfallRow {
  return {
    waterfall_category: waterfallCategory,
    site,
    request_type: requestType,
    vacancy_count: vacancyCount
  };
}

function aggregateWaterfallRows(rows: WaterfallRow[]): WaterfallRow[] {
  const totals = new Map<string, WaterfallRow>();
  for (const row of rows) {
    const key = `${row.waterfall_category}|${row.site}|${row.request_type}`;
    const existing = totals.get(key);
    if (existing) {
      totals.set(key, { ...existing, vacancy_count: existing.vacancy_count + row.vacancy_count });
    } else {
      totals.set(key, row);
    }
  }
  return Array.from(totals.values());
}

function currentYearStart() {
  return `${new Date().getFullYear()}-01-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function dateOnly(value: string | null | undefined) {
  if (!value) return null;
  return value.slice(0, 10);
}
