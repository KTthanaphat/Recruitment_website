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
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <StatCard label={translate(language, "activeRequisitions")} value={activeRequisitions.length} icon={<BriefcaseBusiness size={22} />} />
        <StatCard label="Responsible Unfilled" value={responsibleUnfilled.length} icon={<BriefcaseBusiness size={22} />} />
        <StatCard label="Ongoing Candidates" value={ongoingCandidates.length} icon={<UsersRound size={22} />} />
        <StatCard label={translate(language, "candidateCount")} value={candidates.length} icon={<UsersRound size={22} />} />
        <StatCard label={translate(language, "acceptedOffers")} value={acceptedOffers} icon={<HandCoins size={22} />} />
        <StatCard label={translate(language, "openHeadcount")} value={openHeadcount} icon={<Workflow size={22} />} />
      </div>

      <Panel>
        <SectionTitle
          title="Vacancy Waterfall"
          action={
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Start Date">
                <TextInput type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
              </Field>
              <Field label="End Date">
                <TextInput type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
              </Field>
            </div>
          }
        />
        {waterfallRows.length === 0 ? (
          <EmptyState message="No requisition or accepted offer data for the selected date range." />
        ) : (
          <VacancyWaterfallChart rows={waterfallRows} />
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <SectionTitle
            title={translate(language, "needsAction")}
            action={<Link className="text-sm font-bold text-primary" href="/requisitions">{translate(language, "openList")}</Link>}
          />
          <div className="grid gap-2">
            {needsAction.length === 0 ? (
              <EmptyState message="No open headcount needs action." />
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
                    <Tag tone="warning">{row.open_headcount} open</Tag>
                  </div>
                  <p className="text-sm font-bold text-slate">{row.department} - {row.site} - {row.person_in_charge ?? "Unassigned"}</p>
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
              <EmptyState message="No recent activity." />
            ) : (
              changeLogs.slice(0, 6).map((log) => (
                <div key={log.log_id} className="rounded-md border border-[#D7DEE8] bg-lightgray/50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-sm text-navy">{toTitle(log.entity)} - {log.entity_id}</strong>
                    <Tag tone={statusTone(log.action) as never}>{log.action}</Tag>
                  </div>
                  <p className="mt-1 text-sm font-bold text-slate">{log.changed_by_email ?? "System"} - {formatDateTime(log.changed_at)}</p>
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
              <EmptyState message="No active candidates in pipeline." />
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
                <p className="text-sm font-bold text-slate">{candidate.site ?? "-"} - {candidate.person_in_charge ?? "Unassigned"}</p>
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

function VacancyWaterfallChart({ rows }: { rows: WaterfallRow[] }) {
  const chart = buildWaterfall(rows);
  const plotSize = 420;
  const width = 620;
  const height = 540;
  const topPad = 34;
  const bottomPad = 70;
  const leftPad = 42;
  const plotRight = leftPad + plotSize;
  const plotHeight = plotSize;
  const yMin = chart.yMin;
  const yMax = chart.yMax;
  const yScale = (value: number) => topPad + ((yMax - value) / Math.max(yMax - yMin, 1)) * plotHeight;
  const step = plotSize / Math.max(chart.categories.length, 1);
  const barWidth = Math.min(42, step * 0.58);
  const zeroY = yScale(0);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[620px]">
        <line x1={leftPad} x2={plotRight} y1={zeroY} y2={zeroY} stroke="#475569" strokeWidth={1} />
        {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
          const y = topPad + tick * plotHeight;
          return <line key={tick} x1={leftPad} x2={plotRight} y1={y} y2={y} stroke="#D7DEE8" strokeDasharray="4 4" />;
        })}
        {chart.connectors.map((connector) => (
          <line
            key={`${connector.from}-${connector.to}`}
            x1={categoryX(connector.from, step, leftPad) + barWidth / 2}
            x2={categoryX(connector.to, step, leftPad) - barWidth / 2}
            y1={yScale(connector.value)}
            y2={yScale(connector.value)}
            stroke="#94A3B8"
            strokeDasharray="5 4"
          />
        ))}
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
                    rx={3}
                  />
                );
              })}
              <text x={x + barWidth / 2} y={yScale(bar.labelAnchor) - 8} textAnchor="middle" className="fill-navy text-[12px] font-bold">
                {formatChartValue(bar.total)}
              </text>
            </g>
          );
        })}
        {chart.categories.map((category, index) => (
          <text key={category} x={categoryX(index, step, leftPad)} y={height - 28} textAnchor="middle" className="fill-slate text-[11px] font-bold">
            {category}
          </text>
        ))}
        <g transform={`translate(${plotRight + 18}, ${topPad})`}>
          <text x={0} y={0} className="fill-navy text-[11px] font-extrabold">Legend</text>
          {chart.legend.map((item, index) => (
            <g key={item.label} transform={`translate(0, ${14 + index * 18})`}>
              <rect width={10} height={10} fill={item.color} rx={2} />
              <text x={14} y={9} className="fill-slate text-[10px] font-bold">{item.label}</text>
            </g>
          ))}
        </g>
        <g transform={`translate(${plotRight + 18}, ${topPad + 138})`}>
          <text x={12} y={0} className="fill-navy text-[11px] font-extrabold">Total remaining</text>
          <path d="M 6 12 C -2 12 -2 24 6 24 L 6 24 C -2 24 -2 36 6 36" fill="none" stroke="#475569" strokeWidth={1.5} />
          {chart.totalBreakdown.map((item, index) => (
            <text key={item.label} x={16} y={18 + index * 16} className="fill-slate text-[10px] font-bold">{item.label}</text>
          ))}
        </g>
      </svg>
    </div>
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
  let yMin = 0;
  let yMax = 1;

  for (let index = 0; index < categories.length; index += 1) {
    const category = categories[index];
    const isTotal = category === "Total";
    const base = isTotal ? 0 : running;
    const segments = [];
    let positiveBottom = base;
    let negativeBottom = base;
    let top = base;
    let bottom = base;

    for (const row of sortSnapshotRows(categoryRows[index])) {
      if (row.vacancy_count === 0) continue;
      const segmentBottom = row.vacancy_count > 0 ? positiveBottom : negativeBottom;
      const segmentTop = segmentBottom + row.vacancy_count;
      if (row.vacancy_count > 0) positiveBottom = segmentTop;
      else negativeBottom = segmentTop;
      top = Math.max(top, segmentTop);
      bottom = Math.min(bottom, segmentTop);
      segments.push({
        key: `${category}-${row.site}-${row.request_type}`,
        bottom: segmentBottom,
        top: segmentTop,
        color: snapshotColor(row.site, row.request_type)
      });
    }

    if (!isTotal) {
      running += totals[index];
      if (index < categories.length - 1) connectors.push({ from: index, to: index + 1, value: running });
    }

    yMin = Math.min(yMin, bottom);
    yMax = Math.max(yMax, top);
    bars.push({
      key: category,
      categoryIndex: index,
      segments,
      total: totals[index],
      labelAnchor: top
    });
  }

  const pad = Math.max(Math.abs(yMax - yMin) * 0.15, 4);
  return {
    categories,
    bars,
    connectors,
    yMin: yMin - pad,
    yMax: yMax + pad,
    legend: sites.flatMap((site) => [
      { label: `${site} New`, color: snapshotColor(site, "New") },
      { label: `${site} Rep`, color: snapshotColor(site, "Replacement") }
    ]),
    totalBreakdown: totalBreakdown(rows)
  };
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
    return a.request_type === b.request_type ? 0 : a.request_type === "New" ? -1 : 1;
  });
}

function siteRank(site: string) {
  const index = siteOrder.indexOf(site);
  return index === -1 ? siteOrder.length : index;
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

function formatChartValue(value: number) {
  return value < 0 ? `( ${Math.abs(value).toLocaleString()} )` : value.toLocaleString();
}

function totalBreakdown(rows: WaterfallRow[]) {
  const totals = sortSnapshotRows(rows.filter((row) => row.waterfall_category === "Total" && siteOrder.includes(row.site)));
  const visibleTotals = totals.filter((row) => row.vacancy_count !== 0);
  if (visibleTotals.length === 0) return [{ label: "No remaining vacancy" }];

  return visibleTotals.map((row) => ({
    label: `${row.site}-${row.request_type}: ${row.vacancy_count.toLocaleString()}`
  }));
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

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function dateOnly(value: string | null | undefined) {
  if (!value) return null;
  return value.slice(0, 10);
}
