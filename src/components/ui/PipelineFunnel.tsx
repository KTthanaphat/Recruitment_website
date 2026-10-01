import { formatNumber } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import type { Language } from "@/types/recruitment";
import { ReportHelp } from "@/components/dashboard/ReportHelp";
import { Info } from "lucide-react";

export type PipelineFunnelRow = {
  key: string;
  label: string;
  count: number;
  conversionRate: number | null;
  yieldRate: number | null;
  barRatio: number | null;
  segments?: Array<{ key: string; label: string; count: number; color: string }>;
};

export function PipelineFunnel({
  rows,
  language,
  title,
  subtitle,
  meta,
  helpText,
  compactAtDesktop = false,
  exportMode = false,
  totalLabel,
  totalValue,
  showTotalSummary = true,
  showChannelLegend = true
}: {
  rows: PipelineFunnelRow[];
  language: Language;
  title?: string;
  subtitle?: string;
  meta?: string;
  helpText?: string;
  compactAtDesktop?: boolean;
  exportMode?: boolean;
  totalLabel?: string;
  totalValue: number;
  showTotalSummary?: boolean;
  showChannelLegend?: boolean;
}) {
  const resolvedTitle = title ?? translate(language, "candidatePipeline");
  const resolvedTotalLabel = totalLabel ?? translate(language, "applicants");
  const legend = Array.from(new Map(rows.flatMap((row) => row.segments ?? []).filter((segment) => segment.count > 0).map((segment) => [segment.key, segment])).values());

  return (
    <section className={`pipeline-funnel min-w-0 rounded-lg border border-[#D7DEE8] bg-white shadow-[0_4px_14px_rgba(11,19,43,0.025)] ${exportMode ? "p-5" : "p-4"}`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><h4 className={`font-semibold text-navy ${exportMode ? "text-2xl" : ""}`}>{resolvedTitle}</h4>{exportMode ? <Info size={20} className="text-[#6B7D99]" aria-hidden="true" /> : <ReportHelp label={`${resolvedTitle} ${language === "th" ? "คำอธิบาย" : "help"}`} text={helpText ?? (language === "th" ? "จำนวนแสดงผู้สมัครแต่ละขั้นตอน Conversion คือสัดส่วนเทียบขั้นก่อนหน้า Yield คือสัดส่วนเทียบผู้สมัครทั้งหมด ความกว้างแท่งเทียบกับผู้สมัครทั้งหมด" : "Counts show candidates at each stage. Conversion compares with the preceding stage; yield compares with all applicants. Bar widths are relative to the total applicant count.")} />}</div>
          {subtitle ? <p className="mt-1 text-xs font-medium text-slate">{subtitle}</p> : null}
          {meta ? <p className="mt-1 text-xs font-medium text-slate">{meta}</p> : null}
        </div>
        {showTotalSummary ? <div data-testid="pipeline-total-summary" className="shrink-0 text-right">
          <p className="text-xs font-medium text-slate">{resolvedTotalLabel}</p>
          <p className="text-lg font-semibold tabular-nums text-navy">{formatNumber(totalValue, language)}</p>
        </div> : null}
      </div>

      {showChannelLegend && legend.length > 0 ? <div className="mb-4 flex flex-wrap gap-x-4 gap-y-2 text-xs font-medium text-slate" aria-label={language === "th" ? "สีช่องทางการสรรหา" : "Recruitment channel colors"}>{legend.map((segment) => <span key={segment.key} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} aria-hidden="true" />{segment.label}</span>)}</div> : null}

      <div className={`min-w-0 max-w-full ${exportMode ? "overflow-visible" : "overflow-x-auto overscroll-x-contain"}`}>
        <div className={`grid min-w-[620px] grid-cols-[minmax(10rem,1fr)_8rem_4rem_4rem_4rem] items-stretch rounded-md border border-[#D7DEE8] text-xs ${compactAtDesktop ? "min-[1080px]:min-w-0 min-[1080px]:grid-cols-[minmax(6rem,1fr)_minmax(9rem,11rem)_2.75rem_2.75rem_2.75rem]" : ""} ${exportMode ? "w-full !min-w-0 !text-base" : "overflow-hidden"}`} style={exportMode ? { gridTemplateColumns: "minmax(0, 48fr) minmax(0, 29fr) repeat(3, minmax(0, 7.666fr))", gridTemplateRows: `40px repeat(${rows.length}, minmax(72px, auto))` } : undefined}>
          <div className="bg-[#F8FAFD] px-3 py-2 font-semibold text-slate">{translate(language, "funnel")}</div>
          <div className="border-l border-[#D7DEE8] bg-[#F8FAFD] px-3 py-2 font-semibold text-slate">{translate(language, "stage")}</div>
          <div className="bg-[#F8FAFD] px-2 py-2 text-right font-semibold text-slate">{translate(language, "count")}</div>
          <div className="bg-[#F8FAFD] px-2 py-2 text-right font-semibold text-slate">{translate(language, "conversionShort")}</div>
          <div className="bg-[#F8FAFD] px-2 py-2 text-right font-semibold text-slate">{translate(language, "yieldShort")}</div>
          {rows.map((row, index) => {
            const active = row.count > 0 && totalValue > 0;
            const barWidth = `${Math.min(Math.max((row.barRatio ?? 0) * 100, 0), 100)}%`;
            const isApplicantRow = index === 0;
            return (
              <div key={row.key} className="contents">
                <div className={`border-t border-[#D7DEE8] bg-white px-3 py-2 ${exportMode ? "flex items-center" : ""}`}>
                  <div className="relative flex min-h-9 w-full justify-end overflow-hidden bg-[#EEF2F7]" tabIndex={0} title={`${row.label}: ${formatNumber(row.count, language)}; ${translate(language, "conversionShort")}: ${formatPercent(row.conversionRate)}; ${translate(language, "yieldShort")}: ${formatPercent(row.yieldRate)}`} aria-label={`${row.label}: ${formatNumber(row.count, language)}`}>
                    <div className="flex min-h-9 overflow-hidden" style={{ width: barWidth }}>
                      {active && showChannelLegend && row.segments?.length ? row.segments.filter((segment) => segment.count > 0).map((segment) => <div key={segment.key} className="h-full" style={{ width: `${segment.count / row.count * 100}%`, backgroundColor: segment.color }} title={`${segment.label}: ${formatNumber(segment.count, language)}`} aria-label={`${segment.label}: ${formatNumber(segment.count, language)}`} />) : <div className={`h-full w-full ${active ? "bg-primary" : "bg-[#D7DEE8]"}`} />}
                    </div>
                    {row.segments?.length ? <span className="sr-only">{row.segments.filter((segment) => segment.count > 0).map((segment) => `${segment.label}: ${formatNumber(segment.count, language)}`).join(", ")}</span> : null}
                  </div>
                </div>
                <div className="flex items-center border-t border-l border-[#D7DEE8] bg-white px-2 py-2">
                  <span className={`block min-w-0 whitespace-normal break-words font-semibold leading-tight ${active || isApplicantRow ? "text-navy" : "text-slate"}`} title={row.label}>{row.label}</span>
                </div>
                <div className={`border-t border-l border-[#D7DEE8] bg-white px-2 py-2 text-right font-semibold tabular-nums text-navy ${exportMode ? "flex items-center justify-end" : ""}`}>
                  {formatNumber(row.count, language)}
                </div>
                <div className={`border-t border-l border-[#D7DEE8] bg-white px-2 py-2 text-right font-semibold tabular-nums text-navy ${exportMode ? "flex items-center justify-end" : ""}`}>
                  {formatPercent(row.conversionRate)}
                </div>
                <div className={`border-t border-l border-[#D7DEE8] bg-white px-2 py-2 text-right font-semibold tabular-nums text-navy ${exportMode ? "flex items-center justify-end" : ""}`}>
                  {formatPercent(row.yieldRate)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function formatPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "-";
  const percent = value * 100;
  if (percent === 0 || percent >= 10) return `${Math.round(percent)}%`;
  return `${percent.toFixed(1)}%`;
}
