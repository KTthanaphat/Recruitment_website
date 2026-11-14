"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { formatDate, formatNumber } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { buildContextualHref } from "@/lib/workspace-url-state";
import type { Language } from "@/types/recruitment";
import type { HomeScope } from "@/lib/dashboard-summary-client";

export type HomeMetric = "open" | "urgent" | "aging" | "sourcing";
type Cursor = { priority: number; id: string };
type MetricRow = {
  id: string; type: "requisition" | "candidate" | "sourcing" | "offer";
  recordId: string; applicationId: string | null; title: string; meta: string;
  reason: string; actionDate: string | null; quantity: number | null;
};
type MetricPage = { items: MetricRow[]; totalCount: number; hasMore: boolean; nextCursor: Cursor | null };
export const homeMetricLabel = (metric: HomeMetric, language: Language) =>
  translate(language, ({ open: "openRequisition", urgent: "urgentItems", aging: "agingCandidates", sourcing: "sourcingGaps" } as const)[metric]);

export function HomeMetricDialog({ metric, client, scope, language, onClose, onOpenCandidate, onOpenRequisition, sourcingHref }: {
  metric: HomeMetric; client: SupabaseClient | null; scope: HomeScope; language: Language; sourcingHref: string;
  onClose: () => void; onOpenCandidate: (id: string, applicationId?: string) => void; onOpenRequisition: (id: string) => void;
}) {
  const params = useSearchParams();
  const [cursor, setCursor] = useState<Cursor | null>(null);
  const [rows, setRows] = useState<MetricRow[]>([]);
  const [page, setPage] = useState<MetricPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const scopeKey = JSON.stringify(scope);
  const request = useRef<{ key: string; client: SupabaseClient | null; promise: Promise<MetricPage> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    async function read(): Promise<MetricPage> {
      if (!client) throw new Error("Home metric client unavailable");
      const { data, error: rpcError } = await client.rpc("app_home_metric_page_v1", {
        p_metric: metric, p_scope: JSON.parse(scopeKey),
        p_after_priority: cursor?.priority ?? null, p_after_id: cursor?.id ?? null, p_limit: 25
      });
      if (rpcError) throw rpcError;
      const value = data as MetricPage | null;
      if (!value || !Array.isArray(value.items) || typeof value.totalCount !== "number" || typeof value.hasMore !== "boolean"
        || value.hasMore && (!value.nextCursor || typeof value.nextCursor.id !== "string" || typeof value.nextCursor.priority !== "number")) throw new Error("Invalid Home metric response");
      return value;
    }
    const key = JSON.stringify([metric, scopeKey, cursor, retry]);
    // Reuse the in-flight read during React development effect replay; scope/client changes start a new read.
    if (!request.current || request.current.key !== key || request.current.client !== client) request.current = { key, client, promise: read() };
    request.current.promise.then(value => {
      if (!cancelled) {
        setRows(previous => cursor ? [...previous, ...value.items.filter(row => !previous.some(existing => existing.id === row.id))] : value.items);
        setPage(value);
      }
    }).catch(() => { if (!cancelled) setError(true); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [client, metric, scopeKey, cursor, retry]);

  const th = language === "th";
  const reasons: Record<string, string> = th ? {
    openHeadcount: "อัตราว่าง", overdueAction: "เลยกำหนดดำเนินการ", sourcingGap: "ยังไม่มีการอัปเดตในช่วง 7 วัน",
    overdueSla: "เกิน SLA", agingCandidate: "ผู้สมัครที่ต้องติดตาม", staleSourcing: "ต้องอัปเดตการสรรหา",
    missingStartDate: "ยังไม่ระบุวันเริ่มงาน", pendingOffer: "ข้อเสนอที่รอดำเนินการ"
  } : {
    openHeadcount: "Open headcount", overdueAction: "Overdue scheduled action", sourcingGap: "No update in the last 7 days",
    overdueSla: "Overdue SLA", agingCandidate: "Candidate follow-up", staleSourcing: "Stale sourcing",
    missingStartDate: "Missing start date", pendingOffer: "Pending offer"
  };
  const subtitle = metric === "aging"
    ? th ? "รายการผู้สมัครที่มีนัดดำเนินการเลยกำหนด ภายใต้ตัวกรองปัจจุบัน" : "Applications with overdue scheduled actions, within the current filters."
    : th ? "รายการที่อยู่เบื้องหลังตัวเลขนี้ ภายใต้ตัวกรองและสิทธิ์ปัจจุบัน" : "Records behind this metric, within your current filters and access.";
  const rowClass = "group flex min-h-14 w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left text-navy hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50";
  return (
    <Modal open title={homeMetricLabel(metric, language)} subtitle={subtitle} width="max-w-xl" closeLabel={translate(language, "close")} onClose={onClose}>
      <div data-home-metric-dialog={metric}>
        {loading && !rows.length ? <div role="status"><LoadingSkeleton variant="text" label={<>{translate(language, "loading")}</>} /></div> : null}
        {!loading && !error && !rows.length ? <p className="py-6 text-center text-sm text-slate">{th ? "ไม่มีรายการที่ต้องแสดง" : "No matching records."}</p> : null}
        <ul className="max-h-[55dvh] divide-y divide-[#E4E9F2] overflow-y-auto overscroll-contain">
          {rows.map(row => {
            const content = <><div className="min-w-0">
              <span className="block break-words text-sm font-semibold">{row.title}</span>
              <span className="mt-0.5 block break-words text-xs text-slate">{row.recordId}{row.meta && row.meta !== row.recordId ? ` · ${row.meta}` : ""}</span>
              <span className="mt-1 block text-xs text-slate">{reasons[row.reason] ?? (th ? "ต้องดำเนินการ" : "Needs attention")}{row.quantity !== null ? ` · ${formatNumber(row.quantity, language)}` : ""}{row.actionDate ? ` · ${formatDate(row.actionDate, language)}` : ""}</span>
            </div><ArrowUpRight size={16} aria-hidden className="shrink-0 text-primary" /></>;
            if (row.type === "sourcing") {
              const [path, query = ""] = sourcingHref.split("?");
              const target = new URLSearchParams(query); target.set("type", "group"); target.set("id", row.recordId);
              const href = buildContextualHref(`${path}?${target}`, { language: params.get("lang"), site: params.get("site"), owner: params.get("pic"), priority: params.get("priority") });
              return <li key={row.id}><Link href={href} onClick={onClose} className={rowClass}>{content}</Link></li>;
            }
            return <li key={row.id}><button type="button" className={rowClass} onClick={() => { onClose(); if (row.type === "requisition") onOpenRequisition(row.recordId); else onOpenCandidate(row.recordId, row.applicationId ?? undefined); }}>{content}</button></li>;
          })}
        </ul>
        {error ? <div role="alert" className="mt-3 flex items-center justify-between gap-3 text-sm text-scarlet"><span>{translate(language, "loadFailed")}</span><Button variant="secondary" onClick={() => setRetry(value => value + 1)} disabled={loading}>{translate(language, "retry")}</Button></div> : null}
        {page ? <div className="mt-3 flex min-h-11 flex-wrap items-center justify-between gap-3 border-t border-[#E4E9F2] pt-3">
          <p role="status" className="text-xs text-slate">{th ? "แสดง" : "Showing"} {formatNumber(rows.length, language)} / {formatNumber(page.totalCount, language)}</p>
          {page.hasMore ? <Button variant="secondary" disabled={loading || error} onClick={() => { if (page.nextCursor) setCursor(page.nextCursor); }}>{loading ? translate(language, "loading") : th ? "แสดงเพิ่มเติม" : "Show more"}</Button> : null}
        </div> : null}
      </div>
    </Modal>
  );
}
