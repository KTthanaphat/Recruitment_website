import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";
import { SOURCING_CHANNELS, pipelineDisplayLabel } from "@/lib/constants";
import { formatDate } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { sourcingApplicants } from "@/lib/operations";
import { SOURCING_CHANNEL_COLORS, UNKNOWN_SOURCING_CHANNEL_COLOR } from "@/lib/sourcing-colors";
import { deriveSourcingStageChannels, type StageChannelKey } from "@/lib/sourcing-stage-channels";
import type { DashboardData, Language, SourcingLifecycleRow } from "@/types/recruitment";

type Point = { x: number; y: number };

function SummaryHelp({ label, description, language }: { label: string; description: string; language: Language }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ left: 16, top: 16, width: 256 });
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const positionTooltip = () => {
      const trigger = rootRef.current?.getBoundingClientRect();
      if (!trigger) return;
      const width = Math.min(256, window.innerWidth - 32);
      const left = Math.min(Math.max(16, trigger.right - width), window.innerWidth - width - 16);
      const height = tooltipRef.current?.offsetHeight ?? 80;
      const below = trigger.bottom + 4;
      const top = below + height <= window.innerHeight - 16 ? below : Math.max(16, trigger.top - height - 4);
      setPlacement({ left, top, width });
    };
    positionTooltip();
    const dismissOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", dismissOutside);
    document.addEventListener("keydown", dismissEscape);
    window.addEventListener("resize", positionTooltip);
    window.addEventListener("scroll", positionTooltip, true);
    return () => {
      document.removeEventListener("mousedown", dismissOutside);
      document.removeEventListener("keydown", dismissEscape);
      window.removeEventListener("resize", positionTooltip);
      window.removeEventListener("scroll", positionTooltip, true);
    };
  }, [open]);

  return <span ref={rootRef} className="relative inline-flex shrink-0" onMouseEnter={() => setOpen(true)} onMouseLeave={() => { if (!rootRef.current?.contains(document.activeElement)) setOpen(false); }}>
    <button type="button" className="grid h-7 w-7 place-items-center rounded-full text-[#8A9BB4] hover:bg-[#EEF5FF] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={translate(language, "sourcingSummaryInfo", { metric: label })} aria-expanded={open} aria-controls={open ? id : undefined} aria-describedby={open ? id : undefined} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)} onClick={() => setOpen(true)}><Info size={16} aria-hidden="true" /></button>
    {open ? <span ref={tooltipRef} id={id} role="tooltip" style={placement} className="pointer-events-none fixed z-30 rounded-lg bg-navy px-3 py-2 text-left text-xs font-normal leading-relaxed text-white shadow-lg">{description}</span> : null}
  </span>;
}

function stageChannelLabel(key: StageChannelKey, language: Language) {
  return key === "unknown"
    ? translate(language, "sourcingUnknownChannel")
    : SOURCING_CHANNELS.find((channel) => channel.enabled === key)?.label ?? key;
}

function stageChannelColor(key: StageChannelKey) {
  return key === "unknown" ? UNKNOWN_SOURCING_CHANNEL_COLOR : SOURCING_CHANNEL_COLORS[key];
}

export function SourcingSummaryCharts({ data, language, rows, selectedWeek, selectedRow }: {
  data: DashboardData;
  language: Language;
  rows: SourcingLifecycleRow[];
  selectedWeek: string;
  selectedRow: SourcingLifecycleRow | null;
}) {
  const gradientId = useId().replaceAll(":", "");
  const trendRef = useRef<SVGSVGElement>(null);
  const [trendWidth, setTrendWidth] = useState(240);

  const expectedRows = rows.filter((row) => row.week_start <= selectedWeek && (!selectedRow || row.group.group_id === selectedRow.group.group_id));
  const completedRows = expectedRows.filter((row) => row.status === "saved");
  const applicants = completedRows.length ? completedRows.reduce((sum, row) => sum + (sourcingApplicants(row.update) ?? 0), 0) : null;
  const selectedApplicants = selectedRow?.week_start === selectedWeek && selectedRow.status === "saved" ? sourcingApplicants(selectedRow.update) : null;
  const updatedWeeks = expectedRows.filter((row) => row.update !== null).length;
  const completeness = expectedRows.length ? Math.round(updatedWeeks / expectedRows.length * 100) : 0;
  const weeks = expectedRows.slice(0, 8).reverse();
  useEffect(() => {
    const chart = trendRef.current;
    if (!chart) return;
    const observer = new ResizeObserver(([entry]) => {
      setTrendWidth(Math.max(32, Math.round(entry.contentRect.width)));
    });
    observer.observe(chart);
    return () => observer.disconnect();
  }, [weeks.length]);
  const values = weeks.map((row) => row.status === "saved" ? sourcingApplicants(row.update) : null);
  const maximum = Math.max(0, ...values.filter((value): value is number => value !== null));
  const scale = maximum > 0 ? Math.ceil(maximum * 1.1 / 10) * 10 : 1;
  const ticks = maximum > 0 ? [0, scale / 2, scale] : [0];
  const trendBottom = 72;
  const trendRange = 52;
  const points = values.map((value, index): Point | null => value === null ? null : {
    x: weeks.length === 1 ? trendWidth / 2 : 8 + index * (trendWidth - 16) / (weeks.length - 1),
    y: trendBottom - value * trendRange / scale
  });
  const segments: Point[][] = [];
  points.forEach((point, index) => {
    if (!point) return;
    if (index === 0 || !points[index - 1]) segments.push([]);
    segments.at(-1)!.push(point);
  });

  const distribution = applicants ? SOURCING_CHANNELS
    .map((channel, index) => ({
      key: channel.enabled,
      label: channel.label,
      value: completedRows.reduce((sum, row) => sum + (row.update?.[channel.enabled] ? Number(row.update[channel.count] ?? 0) : 0), 0),
      index,
      color: SOURCING_CHANNEL_COLORS[channel.enabled]
    }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value || a.index - b.index) : [];
  const topChannels = distribution.slice(0, 3);
  const topTotal = topChannels.reduce((sum, channel) => sum + channel.value, 0);
  const topChannelNames = topChannels.length < 2
    ? topChannels[0]?.label ?? ""
    : `${topChannels.slice(0, -1).map((channel) => channel.label).join(", ")} ${language === "th" ? "และ" : "and"} ${topChannels.at(-1)!.label}`;
  let offset = 0;
  const donutArcs = distribution.map((slice) => {
    const length = slice.value / (applicants ?? 1) * 100;
    const start = offset;
    offset += length;
    return {
      key: slice.key,
      channel: slice.key,
      color: slice.color,
      length,
      start
    };
  });

  const stageData = selectedRow ? deriveSourcingStageChannels(data, selectedRow.group.group_id, selectedWeek) : null;
  const stageMax = Math.max(1, ...(stageData?.stages.map((stage) => stage.total) ?? []));

  const cardClass = "min-w-0 rounded-xl border border-[#D7DEE8] bg-white p-3 shadow-[0_8px_24px_rgba(11,19,43,0.05)]";

  return <section data-testid="workspace-sourcing-summary" className="mb-4 min-w-0">
    <div data-testid="workspace-sourcing-summary-row" className="grid min-w-0 gap-2 min-[1080px]:grid-cols-[minmax(0,30fr)_minmax(0,34fr)_minmax(0,36fr)]">
      <div className={cardClass}>
        <div className="flex min-w-0 items-center gap-1"><h2 className="min-w-0 text-base font-semibold text-navy">{translate(language, "accumulatedApplicants")}</h2><SummaryHelp label={translate(language, "accumulatedApplicants")} description={translate(language, "sourcingCumulativeHelp")} language={language} /></div>
        <p className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-end text-center tabular-nums text-navy"><span aria-hidden="true" /><span className="text-4xl font-semibold leading-none min-[1440px]:text-5xl">{applicants ?? "—"}</span>{applicants !== null ? <span className="justify-self-start pl-1.5 pb-0.5 text-sm font-medium leading-none text-slate">({selectedApplicants === null ? "—" : "+" + selectedApplicants})</span> : <span />}</p>
        <div className="mt-2">
          {weeks.length ? <><svg ref={trendRef} data-testid="workspace-sourcing-trend" viewBox={`0 0 ${trendWidth} 80`} className="block h-20 w-full" role="img" aria-label={translate(language, "sourcingTrend")}>
            <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#DCEBFF" stopOpacity="1" /><stop offset="100%" stopColor="#DCEBFF" stopOpacity="0" /></linearGradient></defs>
            {ticks.map((tick) => { const y = trendBottom - tick * trendRange / scale; return <g key={tick}><line x1="8" x2={trendWidth - 8} y1={y} y2={y} stroke="#DCE5F1" strokeDasharray={tick === 0 ? undefined : "3 3"} /><text x="8" y={y - 5} fill="#64748B" fontSize="9">{tick}</text></g>; })}
            {segments.map((segment, index) => segment.length > 1 ? <g key={index}><path d={"M " + segment[0].x + " " + trendBottom + " " + segment.map((point) => "L " + point.x + " " + point.y).join(" ") + " L " + segment.at(-1)!.x + " " + trendBottom + " Z"} fill={"url(#" + gradientId + ")"} /><polyline points={segment.map((point) => point.x + "," + point.y).join(" ")} fill="none" stroke="rgb(var(--app-primary-rgb))" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></g> : null)}
            {points.map((point, index) => point ? <circle key={weeks[index].week_start} cx={point.x} cy={point.y} r="3.5" fill="rgb(var(--app-primary-rgb))" stroke="white" strokeWidth="1.5" tabIndex={0} aria-label={`${formatDate(weeks[index].week_start, language)}: ${values[index]} ${translate(language, "applicants")}`}><title>{formatDate(weeks[index].week_start, language)}: {values[index]} {translate(language, "applicants")}</title></circle> : null)}
          </svg><ul className="sr-only">{weeks.map((row, index) => <li key={row.week_start}>{formatDate(row.week_start, language)}: {values[index] ?? translate(language, "comparisonUnavailable")}</li>)}</ul></> : <p className="text-xs text-slate">{translate(language, "comparisonUnavailable")}</p>}
          <h3 className="mt-1 text-xs font-medium text-slate">{translate(language, "sourcingTrend")}</h3>
        </div>
        <div data-testid="workspace-sourcing-completeness" className="mt-2 border-t border-[#E4E9F2] pt-2">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs"><h3 className="font-medium text-slate">{translate(language, "sourcingWeeklyCompleteness")}</h3><span className="shrink-0 font-semibold tabular-nums text-navy">{updatedWeeks}/{expectedRows.length} ({completeness}%)</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#E4E9F2]" role="progressbar" aria-label={translate(language, "sourcingWeeklyCompleteness")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={completeness} aria-valuetext={`${updatedWeeks}/${expectedRows.length} (${completeness}%)`}><div className="h-full rounded-full bg-primary" style={{ width: completeness + "%" }} /></div>
        </div>
      </div>

      <div className={cardClass}>
        <div className="flex min-w-0 items-center gap-1"><h2 className="min-w-0 text-base font-semibold text-navy">{translate(language, "cumulativeChannelDistribution")}</h2><SummaryHelp label={translate(language, "cumulativeChannelDistribution")} description={translate(language, "sourcingDistributionHelp")} language={language} /></div>
        {applicants !== null && applicants > 0 ? <p data-testid="workspace-sourcing-top-summary" className="mt-1 text-xs leading-relaxed text-slate">{translate(language, "sourcingTopChannelsSummary", {
          count: topChannels.length,
          channelWord: topChannels.length === 1 ? "channel" : "channels",
          channels: topChannelNames,
          topTotal,
          total: applicants,
          percent: Math.round(topTotal / applicants * 100)
        })}</p> : null}
        {applicants === null ? <p className="mt-3 text-sm text-slate">{translate(language, "sourcingChartUnavailable")}</p> : applicants === 0 ? <p className="mt-3 text-sm text-slate">{translate(language, "noApplicantsRecorded")}</p> : <div className="mt-2 flex min-w-0 items-center gap-2">
          <div className="relative aspect-square w-[52%] max-w-60 shrink-0"><svg data-testid="workspace-sourcing-pie" viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={translate(language, "cumulativeChannelDistribution")}>
            <circle cx="50" cy="50" r="35" fill="none" stroke="#E4E9F2" strokeWidth="19" />
            {donutArcs.map((arc) => <circle key={arc.key} data-channel={arc.channel} cx="50" cy="50" r="35" fill="none" stroke={arc.color} strokeWidth="19" strokeDasharray={arc.length + " " + (100 - arc.length)} strokeDashoffset={-arc.start} pathLength="100" transform="rotate(-90 50 50)" />)}
          </svg><div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"><span className="text-xl font-semibold tabular-nums text-navy min-[1440px]:text-2xl">{applicants}</span><span className="text-[10px] text-slate">{translate(language, "applicants")}</span></div></div>
          <ul data-testid="workspace-sourcing-legend" className="grid min-w-0 flex-1 gap-1 text-xs">{distribution.map((slice) => <li key={slice.key} className="flex min-w-0 items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} aria-hidden="true" /><span className="break-words text-navy">{slice.label}: {slice.value} ({Math.round(slice.value / applicants * 100)}%)</span></li>)}</ul>
        </div>}
      </div>

      <div className={cardClass}>
        <div className="flex min-w-0 items-center gap-1"><h2 className="min-w-0 text-base font-semibold text-navy">{translate(language, "sourcingStageChannels")}</h2><SummaryHelp label={translate(language, "sourcingStageChannels")} description={translate(language, "sourcingStageHelp")} language={language} /></div>
        <p className="mt-1 text-xs text-slate">{translate(language, "sourcingStageThrough", { date: formatDate(stageData?.cutoff, language) })}</p>
        <div data-testid="workspace-sourcing-stage-bars" className="mt-2 divide-y divide-dashed divide-[#E4E9F2]">
          {stageData?.stages.map((stage) => <div key={stage.stage} data-stage={stage.stage} className="grid min-w-0 grid-cols-[8rem_minmax(0,1fr)_1.5rem] items-center gap-1.5 py-1.5 text-xs first:pt-0 last:pb-0" aria-label={pipelineDisplayLabel(stage.stage, language) + ": " + stage.total + " " + translate(language, "candidates") + "; " + stage.segments.map((segment) => stageChannelLabel(segment.key, language) + ": " + segment.count).join(", ")}>
            <span className="min-w-0 truncate whitespace-nowrap text-slate" title={pipelineDisplayLabel(stage.stage, language)}>{pipelineDisplayLabel(stage.stage, language)}</span>
            <div className="flex h-4 min-w-0 overflow-hidden rounded-full bg-[#EEF2F7]">{stage.segments.map((segment) => <span key={segment.key} data-channel={segment.key} title={stageChannelLabel(segment.key, language) + ": " + segment.count} className="h-full" style={{ width: segment.count / stageMax * 100 + "%", backgroundColor: stageChannelColor(segment.key) }} />)}</div>
            <span className="text-right font-bold tabular-nums text-navy">{stage.total}</span>
          </div>)}
        </div>
      </div>
    </div>
  </section>;
}
