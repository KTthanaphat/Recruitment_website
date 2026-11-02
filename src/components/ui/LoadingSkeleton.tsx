import type { ReactNode } from "react";
import { RotateCw } from "lucide-react";
import type { Language } from "@/types/recruitment";

export type SkeletonVariant = "text" | "table" | "cards" | "metrics" | "chart" | "detail" | "lookup";
export function LoadingSkeleton({ variant = "table", label, language = "en", className = "" }: { variant?: SkeletonVariant; label?: ReactNode; language?: Language; className?: string }) {
  const count = variant === "table" ? 5 : variant === "cards" ? 3 : variant === "lookup" ? 4 : variant === "metrics" ? 4 : 1;
  return <div role="status" aria-busy="true" data-loading-skeleton={variant} className={`min-w-0 py-3 ${className}`}>
    <span className="sr-only">{label ?? (language === "th" ? "กำลังโหลดข้อมูล…" : "Loading data…")}</span>
    <div aria-hidden="true" className={`grid gap-3 ${variant === "metrics" ? "grid-cols-2 lg:grid-cols-4" : ""}`}>
      {Array.from({ length: count }, (_, index) => <div key={index} className={`ats-skeleton-row min-w-0 ${variant === "text" ? "grid grid-cols-3 gap-3" : variant === "table" ? "grid grid-cols-[2fr_1fr_1fr] gap-4 border-b border-[#E4E9F2] py-3" : variant === "cards" || variant === "metrics" ? "grid gap-3 rounded-lg border border-[#E4E9F2] p-4" : "grid gap-3 py-2"}`}>
        <span className={`ats-skeleton block rounded-md ${variant === "chart" ? "h-52 w-full" : variant === "detail" ? "h-10 w-2/3" : "h-4 w-3/4"}`} />
        <span className={`ats-skeleton block rounded-md ${variant === "detail" ? "h-40 w-full" : "h-3 w-1/2"}`} />
        <span className="ats-skeleton block h-3 w-2/3 rounded-md" />
      </div>)}
    </div>
  </div>;
}
export function RefreshIndicator({ language = "en", label }: { language?: Language; label?: ReactNode }) {
  return <span role="status" aria-busy="true" data-refreshing="true" className="inline-flex items-center gap-2 text-xs text-slate"><RotateCw aria-hidden="true" size={14} className="motion-safe:animate-spin" /><span>{label ?? (language === "th" ? "กำลังอัปเดตข้อมูล…" : "Refreshing…")}</span></span>;
}
