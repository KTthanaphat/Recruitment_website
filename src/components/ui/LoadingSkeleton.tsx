
import type { CSSProperties, ReactNode } from "react";
import { RotateCw } from "lucide-react";
import type { Language } from "@/types/recruitment";

export type SkeletonVariant = "text" | "table" | "cards" | "metrics" | "chart" | "detail" | "lookup";
export type SkeletonColumn = { kind?: "text" | "number" | "action" | "date"; className?: string; width?: string; actionCount?: 1 | 2 };
function loadingText(language: Language) { return language === "th" ? "กำลังโหลดข้อมูล…" : "Loading data…"; }
export function NumberSkeleton({ ratio = false }: { ratio?: boolean }) {
  return <span aria-hidden="true" className="inline-flex items-center gap-1 align-middle"><span className="ats-skeleton inline-block h-5 w-8 rounded-md" />{ratio ? <><span>/</span><span className="ats-skeleton inline-block h-5 w-8 rounded-md" /></> : null}</span>;
}
export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={"ats-skeleton block rounded-md " + className}/>;
}
function Shape({ column = {} }: { column?: SkeletonColumn }) {
  if (column.kind === "action") return <span aria-hidden="true" data-skeleton-actions className="inline-flex gap-2">{Array.from({ length: column.actionCount ?? 1 }, (_, index) => <SkeletonBlock key={index} className="ats-attendance-placeholder"/>)}</span>;
  return <span aria-hidden="true" className={"ats-skeleton block rounded-md " + (column.kind === "number" ? "ml-auto h-5 w-10" : column.kind === "date" ? "h-4 w-24" : "h-4 w-3/4")} />;
}
/** Insert directly in tbody so placeholder widths follow the real table columns. */
export function TableSkeletonRows({ columns, language = "en", label }: { columns: number | SkeletonColumn[]; language?: Language; label?: ReactNode }) {
  const cells = typeof columns === "number" ? Array.from({ length: columns }, () => ({} as SkeletonColumn)) : columns;
  return <>{Array.from({ length: 3 }, (_, row) => <tr key={row} data-loading-skeleton={row === 0 ? "table" : undefined} className="ats-skeleton-row border-b border-[#E4E9F2]">
    {cells.map((column, index) => <td key={index} className={"px-3 py-4 " + (column.className ?? "")} style={{ width: column.width }}>{row === 0 && index === 0 ? <span role="status" className="sr-only">{label ?? loadingText(language)}</span> : null}<Shape column={column}/></td>)}
  </tr>)}</>;
}
export function LoadingSkeleton({ variant = "table", label, language = "en", className = "", columns = 3, gridClassName = "", metricLabels, metricRatios, count: requestedCount }: {
  variant?: SkeletonVariant; label?: ReactNode; language?: Language; className?: string;
  columns?: number | SkeletonColumn[]; gridClassName?: string; metricLabels?: ReactNode[]; metricRatios?: readonly boolean[]; count?: number;
}) {
  const count = variant === "table" ? 3 : variant === "lookup" ? 4 : requestedCount ?? (variant === "cards" ? 5 : variant === "metrics" ? metricLabels?.length ?? 4 : 1);
  const cells = typeof columns === "number" ? Array.from({ length: columns }, () => ({} as SkeletonColumn)) : columns;
  const rowStyle: CSSProperties | undefined = variant === "table" && !gridClassName ? { gridTemplateColumns: "repeat(" + cells.length + ", minmax(0,1fr))" } : undefined;
  return <div role="status" aria-busy="true" data-loading-skeleton={variant} className={"min-w-0 py-3 " + className}>
    <span className="sr-only">{label ?? loadingText(language)}</span>
    <div className={"grid gap-3 " + (variant === "metrics" ? gridClassName || "[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]" : variant === "table" ? "" : gridClassName)}>
      {Array.from({ length: count }, (_, index) => variant === "table" ? <div key={index} style={rowStyle} className={"ats-skeleton-row grid min-w-0 items-center gap-4 border-b border-[#E4E9F2] px-3 py-4 " + gridClassName}>{cells.map((column, cell) => <div key={cell} className={"min-w-0 " + (column.className ?? "")}><Shape column={column}/></div>)}</div>
      : variant === "metrics" ? <div key={index} className="ats-skeleton-row grid min-w-0 gap-3 rounded-xl border border-[#E4E9F2] p-3"><div className="text-xs font-medium text-slate">{metricLabels?.[index] ?? <span aria-hidden="true" className="ats-skeleton block h-3 w-24 rounded-md"/>}</div><NumberSkeleton ratio={metricRatios?.[index]}/><span aria-hidden="true" className="ats-skeleton block h-3 w-2/3 rounded-md"/></div>
      : <div key={index} aria-hidden="true" className={"ats-skeleton-row grid min-w-0 gap-3 " + (variant === "cards" ? "rounded-lg border border-[#E4E9F2] p-4" : "py-2")}>
        <span className={"ats-skeleton block rounded-md " + (variant === "chart" ? "h-52 w-full" : variant === "detail" ? "h-10 w-2/3" : "h-4 w-3/4")}/>
        <span className={"ats-skeleton block rounded-md " + (variant === "detail" ? "h-40 w-full" : "h-3 w-1/2")}/>
        <span className="ats-skeleton block h-3 w-2/3 rounded-md"/>{variant === "cards" || variant === "detail" ? <div className="flex gap-3"><NumberSkeleton/><NumberSkeleton/></div> : null}
      </div>)}
    </div>
  </div>;
}
export function RefreshIndicator({ language = "en", label }: { language?: Language; label?: ReactNode }) {
  return <span role="status" aria-busy="true" data-refreshing="true" className="inline-flex items-center gap-2 text-xs text-slate"><RotateCw aria-hidden="true" size={14} className="motion-safe:animate-spin"/><span>{label ?? (language === "th" ? "กำลังอัปเดตข้อมูล…" : "Refreshing…")}</span></span>;
}

/** Standalone read region with real headers, native cells and three aligned rows. */
export function TableLoadingPlaceholder({ headers, columns, language = "en", label, className = "", tableClassName = "" }: {
  headers: ReactNode[]; columns?: SkeletonColumn[]; language?: Language; label?: ReactNode; className?: string; tableClassName?: string;
}) {
  return <div aria-busy="true" className={"min-w-0 overflow-x-auto " + className}><table className={"w-full border-collapse text-left text-sm " + tableClassName}>
    <thead><tr>{headers.map((header,index)=><th key={index} scope="col" className="border-b border-[#E4E9F2] px-3 py-2 font-medium text-slate">{header}</th>)}</tr></thead>
    <tbody aria-busy="true"><TableSkeletonRows columns={columns ?? headers.length} language={language} label={label}/></tbody>
  </table></div>;
}
