"use client";

import { Bell, Check, Clock3, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Language, Profile } from "@/types/recruitment";
import { translate } from "@/lib/i18n/dictionary";
import { formatLocalDateInput } from "@/lib/dates";
import { Button } from "@/components/ui/Button";

type RecruitmentNotification = {
  notification_id: string;
  notification_type: "new_hire_confirmation" | "probation";
  candidate_id: string;
  application_id: string | null;
  candidate_name: string;
  doc_id: string;
  position: string | null;
  site: string | null;
  first_working_date: string;
  milestone_days: number | null;
  reminder_days_before: number | null;
  due_date: string;
  read_at: string | null;
  resolved_at: string | null;
};

export function RecruitmentNotifications({
  client,
  language,
  profile,
  onOpenCandidate
}: {
  client: SupabaseClient | null;
  language: Language;
  profile: Profile | null;
  onOpenCandidate: (candidateId: string, applicationId?: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [panelTop, setPanelTop] = useState(64);
  const [rows, setRows] = useState<RecruitmentNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const load = useCallback(async (offset = 0) => {
    if (!client || !profile?.id) {
      setRows([]);
      return;
    }
    setLoading(true);
    const [listResult, unreadResult] = await Promise.all([client
      .from("recruitment_notifications")
      .select("notification_id,notification_type,candidate_id,application_id,candidate_name,doc_id,position,site,first_working_date,milestone_days,reminder_days_before,due_date,read_at,resolved_at")
      .order("resolved_at", { ascending: true, nullsFirst: true })
      .order("read_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: false })
      .range(offset, offset + 49), client
      .from("recruitment_notifications")
      .select("notification_id", { count: "exact", head: true })
      .is("read_at", null)
      .is("resolved_at", null)]);
    if (listResult.error || unreadResult.error) {
      setError(true);
    } else {
      setError(false);
      setHasMore((listResult.data?.length ?? 0) === 50);
      setRows(current => {
        const page = (listResult.data ?? []) as RecruitmentNotification[];
        if (offset === 0) return page;
        const seen = new Set(current.map(row => row.notification_id));
        return [...current, ...page.filter(row => !seen.has(row.notification_id))];
      });
      setUnreadCount(unreadResult.count ?? 0);
    }
    setLoading(false);
  }, [client, profile?.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const markRead = async (row: RecruitmentNotification) => {
    if (!client || row.read_at || markingId) return true;
    setMarkingId(row.notification_id);
    const { error: updateError } = await client.rpc("app_mark_recruitment_notification_read_v1", {
      p_notification_id: row.notification_id
    });
    setMarkingId(null);
    if (updateError) {
      setError(true);
      return false;
    }
    setRows(current => current.map(item => item.notification_id === row.notification_id
      ? { ...item, read_at: new Date().toISOString() }
      : item));
    if (!row.read_at && !row.resolved_at) setUnreadCount(current => Math.max(0, current - 1));
    return true;
  };

  const openCandidate = async (row: RecruitmentNotification) => {
    if (!(await markRead(row))) return;
    setOpen(false);
    onOpenCandidate(row.candidate_id, row.application_id ?? undefined);
  };

  const togglePanel = () => {
    if (!open) {
      const buttonBounds = buttonRef.current?.getBoundingClientRect();
      if (buttonBounds) setPanelTop(Math.min(buttonBounds.bottom + 8, Math.max(16, window.innerHeight - 160)));
      void load(0);
    }
    setOpen(value => !value);
  };

  const formatDate = (value: string) => new Intl.DateTimeFormat(
    language === "th" ? "th-TH-u-ca-gregory" : "en-GB",
    { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }
  ).format(new Date(`${value}T00:00:00.000Z`));

  const titleFor = (row: RecruitmentNotification) => {
    if (row.notification_type === "new_hire_confirmation") return translate(language, "notificationNewHireConfirmation");
    return translate(language, "notificationProbationMilestone", { days: row.milestone_days ?? 0 });
  };

  const timingFor = (row: RecruitmentNotification) => {
    if (row.notification_type !== "probation") {
      const today = formatLocalDateInput();
      const elapsedDays = Math.floor((Date.parse(today + "T00:00:00Z") - Date.parse(row.first_working_date + "T00:00:00Z")) / 86400000);
      return elapsedDays > 0 ? translate(language, "notificationDaysOverdue", { days: elapsedDays }) : translate(language, "dueToday");
    }
    if (row.reminder_days_before === 0) return translate(language, "dueToday");
    return translate(language, "notificationDaysBeforeMilestone", { days: row.reminder_days_before ?? 0 });
  };

  return (
    <div className="relative" ref={rootRef} data-recruitment-notifications>
      <button
        ref={buttonRef}
        type="button"
        className="relative inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-[#C4D8FF] bg-white text-[#0A3CDC] transition hover:bg-[#F8FAFD] focus:outline-none focus:ring-2 focus:ring-primary/30 sm:size-9"
        aria-label={translate(language, "notificationCenter")}
        aria-describedby={unreadCount > 0 ? "recruitment-notification-unread-count" : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={translate(language, "notificationCenter")}
        onClick={togglePanel}
      >
        <Bell size={18} aria-hidden="true" />
        {unreadCount > 0 ? <span id="recruitment-notification-unread-count" className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-[#C52B40] px-1 text-[10px] font-bold leading-none text-white" aria-label={translate(language, "unreadNotificationCount", { count: unreadCount })}>{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      {open ? (
        <section role="dialog" aria-label={translate(language, "notificationCenter")} style={{ top: panelTop }} className="fixed right-4 z-50 max-h-[min(70dvh,34rem)] w-[min(25rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[#D7DEE8] bg-white shadow-[0_16px_48px_rgba(11,19,43,0.18)]">
          <div className="flex items-center justify-between gap-3 border-b border-[#E4E9F2] px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-navy">{translate(language, "notificationCenter")}</h3>
              <p className="mt-0.5 text-xs text-slate">{translate(language, "notificationUnreadSummary", { count: unreadCount })}</p>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" className="relative text-slate after:absolute after:-inset-1 hover:text-navy" aria-label={translate(language, "close")} title={translate(language, "close")} onClick={() => setOpen(false)} icon={<X size={16} aria-hidden="true" />} />
          </div>
          <div className="max-h-[calc(min(70dvh,34rem)-4.5rem)] overflow-y-auto">
            {loading && rows.length === 0 ? <p role="status" className="px-4 py-6 text-center text-sm text-slate">{translate(language, "loading")}</p> : null}
            {error ? <p role="alert" className="px-4 py-5 text-sm text-danger">{translate(language, "notificationLoadFailed")}</p> : null}
            {!loading && !error && rows.length === 0 ? <p className="px-4 py-6 text-center text-sm text-slate">{translate(language, "notificationEmpty")}</p> : null}
            <ul className="divide-y divide-[#E4E9F2]">
            {rows.map(row => (
                <li key={row.notification_id} className={`px-4 py-3 ${!row.read_at && !row.resolved_at ? "bg-[#F6F9FF]" : ""}`}>
                  <button type="button" className="block w-full rounded-md text-left focus:outline-none focus:ring-2 focus:ring-primary/30" onClick={() => void openCandidate(row)}>
                    <span className="flex items-start gap-2">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-navy">{row.candidate_name} - {titleFor(row)}</span>
                        <span className="mt-0.5 block text-sm font-medium text-slate">{timingFor(row)}</span>
                      </span>
                      <span className="flex w-9 shrink-0 justify-center pt-1">{!row.read_at && !row.resolved_at ? <span className="size-3 rounded-full bg-primary" aria-hidden="true" /> : null}</span>
                    </span>
                    <span className="mt-1 block text-xs leading-5 text-slate">{row.position || translate(language, "position")}{row.site ? ` · ${row.site}` : ""} · {row.doc_id}</span>
                    <span className="mt-1 flex items-center gap-1.5 text-xs font-medium text-navy"><Clock3 size={13} aria-hidden="true" />{translate(language, row.notification_type === "probation" ? "notificationReminderDate" : "notificationFirstWorkingDate")} · {formatDate(row.due_date)}</span>
                    {row.resolved_at ? <span className="mt-1 block text-xs text-slate">{translate(language, "notificationResolved")}</span> : null}
                  </button>
                  {!row.read_at ? <button type="button" className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-md px-2 text-xs font-semibold text-primary hover:bg-[#EAF1FF] focus:outline-none focus:ring-2 focus:ring-primary/30" disabled={markingId === row.notification_id} onClick={() => void markRead(row)}><Check size={14} aria-hidden="true" />{translate(language, "notificationMarkRead")}</button> : null}
                </li>
              ))}
            </ul>
            {hasMore ? <div className="border-t border-[#E4E9F2] p-3 text-center"><button type="button" className="min-h-9 rounded-md px-3 text-xs font-semibold text-primary hover:bg-[#EAF1FF] focus:outline-none focus:ring-2 focus:ring-primary/30" disabled={loading} onClick={() => void load(rows.length)}>{translate(language, "notificationLoadMore")}</button></div> : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}
