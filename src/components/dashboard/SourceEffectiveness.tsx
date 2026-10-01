import { ReportHelp } from "@/components/dashboard/ReportHelp";
import { formatNumber } from "@/lib/format";
import type { Language } from "@/types/recruitment";
import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type SourceEffectivenessRow = {
  key: string;
  label: string;
  color: string;
  applicants: number;
  phone: number;
  hired: number;
};

type Measure = "applicants" | "phone" | "hired";

function channelTint(color: string) {
  return `#${[1, 3, 5].map((offset) => Math.round(Number.parseInt(color.slice(offset, offset + 2), 16) * 0.25 + 255 * 0.75).toString(16).padStart(2, "0")).join("")}`;
}

function CompositionSegment({ row, value, total, language, exportMode }: { row: SourceEffectivenessRow; value: number; total: number; language: Language; exportMode: boolean }) {
  const segmentRef = useRef<HTMLSpanElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);
  const [labelFits, setLabelFits] = useState(false);
  const count = formatNumber(value, language);
  const percentage = `${Math.round(value / total * 100)}%`;
  const label = `${count} (${percentage})`;

  useEffect(() => {
    const segment = segmentRef.current;
    const text = labelRef.current;
    if (!segment || !text) return;
    const measure = () => setLabelFits(text.getBoundingClientRect().width + 8 <= segment.getBoundingClientRect().width);
    const observer = new ResizeObserver(measure);
    observer.observe(segment);
    measure();
    void document.fonts?.ready.then(measure);
    return () => observer.disconnect();
  }, [label]);

  return <span ref={segmentRef} data-channel={row.key} data-label-visible={labelFits} title={`${row.label}: ${label}`} className={`relative h-full shrink-0 overflow-hidden font-light tabular-nums ${exportMode ? "text-base" : "text-[11px]"}`} style={{ flexBasis: `${value / total * 100}%`, backgroundColor: row.color, color: "#F8FAFC", textShadow: "none" }}>
    <span ref={labelRef} aria-hidden="true" className="absolute left-1/2 top-1/2 w-max -translate-x-1/2 -translate-y-1/2 whitespace-nowrap leading-none" style={{ visibility: labelFits ? "visible" : "hidden" }}>{label}</span>
  </span>;
}

export function SourceEffectiveness({ rows, language, exportMode = false }: { rows: SourceEffectivenessRow[]; language: Language; exportMode?: boolean }) {
  const th = language === "th";
  const title = th ? "ประสิทธิผลของแหล่งผู้สมัคร" : "Source effectiveness";
  const measures: Array<{ key: Measure; label: string }> = [
    { key: "applicants", label: th ? "ผู้สมัคร" : "Applicants" },
    { key: "phone", label: th ? "คัดกรองโทรศัพท์" : "Phone Screening" },
    { key: "hired", label: th ? "รับข้อเสนอแล้ว" : "Hired" }
  ];
  const totals = Object.fromEntries(measures.map(({ key }) => [key, rows.reduce((sum, row) => sum + row[key], 0)])) as Record<Measure, number>;
  const largestApplicants = Math.max(0, ...rows.map((row) => row.applicants));
  const exportDetailRowHeight = Math.min(60, Math.max(48, Math.floor(660 / Math.max(rows.length, 1))));
  const percent = (value: number, prior: number) => prior > 0 ? `${Math.round(value / prior * 100)}%` : "—";

  function miniBar(row: SourceEffectivenessRow, measure: Measure) {
    const value = row[measure];
    const baselineWidth = largestApplicants > 0 ? row.applicants / largestApplicants * 100 : 0;
    const share = row.applicants > 0 ? value / row.applicants : 0;
    const overflow = measure !== "applicants" && value > row.applicants;
    const label = measures.find((item) => item.key === measure)!.label;
    const description = `${row.label} ${label}: ${formatNumber(value, language)}; ${th ? "เทียบกับผู้สมัครช่องทางนี้" : "of this channel's Applicants"}: ${percent(value, row.applicants)}${overflow ? (th ? "; แท่งจำกัดที่ 100%" : "; bar capped at 100%") : ""}`;
    return <div data-mini-measure={measure} className="flex min-w-0 flex-wrap items-center gap-0.5" role="img" aria-label={description} title={description}>
      <div className={`${exportMode ? "h-2" : "h-1.5"} min-w-0 flex-1 bg-[#EEF2F7]`} data-mini-track data-channel-tint={channelTint(row.color)}>
        {row.applicants > 0 ? <div className="flex h-full" data-mini-baseline style={{ width: `${baselineWidth}%`, backgroundColor: channelTint(row.color) }}>
          <span className="h-full" style={{ width: `${measure === "applicants" ? 100 : Math.min(share * 100, 100)}%`, backgroundColor: row.color }} />
        </div> : null}
      </div>
      {overflow ? <span className="shrink-0 text-[8px] font-bold text-primary" aria-hidden="true">{row.applicants === 0 ? "+" : ">100%"}</span> : null}
    </div>;
  }

  function metricValue(row: SourceEffectivenessRow, measure: Measure) {
    const prior = measure === "phone" ? row.applicants : row.phone;
    const value = `${formatNumber(row[measure], language)}${measure === "applicants" ? "" : ` (${percent(row[measure], prior)})`}`;
    return <div className={`source-metric-value grid min-w-0 items-center gap-1 pr-1 tabular-nums ${exportMode ? "text-base" : "text-[10px]"}`} data-metric-value={measure}>
      <span className="min-w-0 text-right leading-tight" title={value}>{value}</span>
      {miniBar(row, measure)}
    </div>;
  }

  return <section className={`source-effectiveness min-w-0 rounded-lg border border-[#D7DEE8] bg-white ${exportMode ? "p-5" : "p-4"}`} data-testid="source-effectiveness">
    <div className="flex items-center gap-2"><h4 className={`font-semibold text-navy ${exportMode ? "text-2xl" : ""}`}>{title}</h4>{exportMode ? <Info size={20} className="text-[#6B7D99]" aria-hidden="true" /> : <ReportHelp label={`${title} ${th ? "คำอธิบาย" : "help"}`} text={th ? "เปรียบเทียบกิจกรรมในช่วงเวลาเดียวกัน ผู้สมัครมาจากยอดรายสัปดาห์ คัดกรองโทรศัพท์นับผู้สมัครไม่ซ้ำที่ผ่านขั้นตอนคัดกรองโทรศัพท์ และรับเข้าทำงานนับผู้สมัครไม่ซ้ำที่รับข้อเสนอแล้ว ตัวเลขในแท่งบนเทียบกับยอดรวมของแต่ละแถว ตารางแสดงเปอร์เซ็นต์คัดกรองโทรศัพท์เทียบผู้สมัคร และรับข้อเสนอเทียบผู้ผ่านคัดกรองโทรศัพท์; แท่งเล็กทั้งสามใช้ผู้สมัครของช่องทางเป็นฐาน อัตราส่วนอาจเกิน 100% ได้" : "Same-period activity: Applicants use saved weekly counts, Phone Screening counts distinct candidates who passed Phone Screen, and Hired counts distinct candidates with accepted offers. Labels in the top bars use each measure's total. Table percentages compare Phone Screening with Applicants and Hired with Phone Screening; all three mini bars use each channel's Applicants as their baseline. Period ratios may exceed 100%."} />}</div>
    <div className={`grid min-w-0 ${exportMode ? "mt-5 gap-4" : "mt-4 gap-3"}`} aria-label={th ? "สัดส่วนตามช่องทาง" : "Channel composition"}>
      {measures.map(({ key, label }) => {
        const active = rows.filter((row) => row[key] > 0);
        return <div key={key} data-measure={key} className="min-w-0">
          <div className={`mb-1 font-semibold text-navy ${exportMode ? "text-sm" : "text-xs"}`}><span>{label}: <span className="tabular-nums">{formatNumber(totals[key], language)}</span></span></div>
          <div className="max-w-full">
            <div className={`flex w-full bg-[#EEF2F7] ${exportMode ? "h-6" : "h-5"}`} role="img" aria-label={`${label}: ${formatNumber(totals[key], language)}; ${active.map((row) => `${row.label}: ${formatNumber(row[key], language)} (${percent(row[key], totals[key])})`).join(", ")}`}>
              {active.map((row) => <CompositionSegment key={row.key} row={row} value={row[key]} total={totals[key]} language={language} exportMode={exportMode} />)}
            </div>
          </div>
        </div>;
      })}
    </div>
    <div className={`source-detail-wide min-w-0 max-w-full ${exportMode ? "mt-5" : "mt-4"}`}>
      <table className={`w-full table-fixed border-collapse leading-tight ${exportMode ? "text-base" : "text-[10px]"}`} style={exportMode ? { height: 38 + rows.length * exportDetailRowHeight } : undefined}>
        <colgroup><col style={{ width: "30%" }} /><col /><col /><col /></colgroup>
        <thead><tr className="border-b border-[#D7DEE8] bg-[#F8FAFD] text-slate"><th scope="col" className="px-0.5 py-2 text-left">{th ? "ช่องทาง" : "Channel"}</th>{measures.map(({ key, label }) => <th key={key} scope="col" className="px-0.5 py-2 text-left">{label}</th>)}</tr></thead>
        <tbody>{rows.map((row) => <tr key={row.key} data-channel={row.key} className="border-b border-[#E4E9F2] text-navy"><th scope="row" className="px-0.5 py-2 text-left font-medium"><span className="flex min-w-0 items-center gap-1"><span className="size-2 shrink-0" style={{ backgroundColor: row.color }} aria-hidden="true" /><span className="min-w-0 break-words" title={row.label}>{row.label}</span></span></th>{measures.map(({ key }) => <td key={key} className="min-w-0 px-0.5 py-2">{metricValue(row, key)}</td>)}</tr>)}</tbody>
      </table>
    </div>
    <div className="source-detail-compact mt-4 min-w-0 max-w-full">
      <table className="w-full border-collapse text-[10px] leading-tight">
        {rows.map((row) => <tbody key={row.key}>
          <tr data-channel={row.key} className="border-t border-[#D7DEE8] bg-[#F8FAFD]"><th scope="rowgroup" colSpan={2} className="px-1 py-1.5 text-left font-semibold text-navy"><span className="inline-flex items-center gap-1"><span className="size-2 shrink-0" style={{ backgroundColor: row.color }} aria-hidden="true" />{row.label}</span></th></tr>
          {measures.map(({ key, label }) => <tr key={key} data-channel={row.key} className="border-b border-[#E4E9F2] text-navy"><th scope="row" className="w-[42%] px-1 py-1 text-left font-medium">{label}</th><td className="min-w-0 px-1 py-1">{metricValue(row, key)}</td></tr>)}
        </tbody>)}
      </table>
    </div>
  </section>;
}
