"use client";

import { BriefcaseBusiness, CalendarClock, CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Panel, SectionTitle } from "@/components/ui/Panel";
import { Tag } from "@/components/ui/Tag";
import { ACTIVE_PIPELINE_STAGES, processIndex, processLabel } from "@/lib/constants";
import { formatCandidateName, formatDate } from "@/lib/format";
import { translate } from "@/lib/i18n/dictionary";
import { candidatePipelineCapability } from "@/lib/operations";
import type { EnrichedCandidate, Language, Offer, ProcessStage, Profile, RecruitmentLog } from "@/types/recruitment";

type CalendarEvent = {
  candidateId: string;
  candidateName: string;
  date: string;
  eventType: "stage" | "start_work";
  overdue: boolean;
  owner: string | null;
  round: number;
  site: string | null;
  stage: ProcessStage;
  position: string | null;
  log?: RecruitmentLog;
};

const weekdayLabels = {
  en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
  th: ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"]
};

export function RecruitmentCalendar({
  candidates,
  language,
  offers,
  profile,
  recruitmentLogs,
  className = "",
  onEditPending,
  onOpenCandidate
}: {
  candidates: EnrichedCandidate[];
  className?: string;
  language: Language;
  offers: Offer[];
  profile: Profile | null;
  recruitmentLogs: RecruitmentLog[];
  onEditPending?: (candidate: EnrichedCandidate) => void;
  onOpenCandidate: (candidateId: string) => void;
}) {
  const today = bangkokToday();
  const [visibleMonth, setVisibleMonth] = useState(() => monthFromIso(today));
  const [selectedDate, setSelectedDate] = useState(today);
  const [eventListDate, setEventListDate] = useState<string | null>(null);
  const candidateById = useMemo(() => new Map(candidates.map((candidate) => [candidate.candidate_id, candidate])), [candidates]);
  const events = useMemo(() => {
    const stageEvents = recruitmentLogs.flatMap((log): CalendarEvent[] => {
    const candidate = candidateById.get(log.candidate_id);
    const estimatedDate = log.estimated_action_date;
    if (!candidate || !estimatedDate || log.result !== null || log.superseded_at || !ACTIVE_PIPELINE_STAGES.includes(log.recruitment_process)) return [];
    return [{
      candidateId: candidate.candidate_id,
      candidateName: formatCandidateName(candidate),
      date: estimatedDate,
      eventType: "stage",
      overdue: estimatedDate < today,
      owner: candidate.person_in_charge,
      round: log.round,
      site: candidate.site,
      stage: log.recruitment_process,
      position: candidate.group_position,
      log
    }];
    });
    const startWorkEvents = offers.flatMap((offer): CalendarEvent[] => {
      const candidate = candidateById.get(offer.candidate_id);
      if (!candidate || !offer.first_working_date) return [];
      return [{
        candidateId: candidate.candidate_id,
        candidateName: formatCandidateName(candidate),
        date: offer.first_working_date,
        eventType: "start_work",
        overdue: false,
        owner: candidate.person_in_charge,
        round: 1,
        site: candidate.site,
        stage: "Offer",
        position: candidate.group_position
      }];
    });
    return [...stageEvents, ...startWorkEvents].sort(compareEvents);
  }, [candidateById, offers, recruitmentLogs, today]);
  const monthKey = isoMonth(visibleMonth.year, visibleMonth.month);
  const monthEvents = events.filter((event) => event.date.startsWith(monthKey));
  const eventsByDate = groupEventsByDate(monthEvents);
  const cells = monthCells(visibleMonth.year, visibleMonth.month);
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const eventListEvents = eventListDate ? eventsByDate.get(eventListDate) ?? [] : [];
  const monthLabel = new Intl.DateTimeFormat(language === "th" ? "th-TH-u-ca-gregory" : "en-US", {
    month: "long",
    timeZone: "UTC",
    year: "numeric"
  }).format(new Date(Date.UTC(visibleMonth.year, visibleMonth.month, 15, 12)));

  function moveMonth(delta: number) {
    const date = new Date(Date.UTC(visibleMonth.year, visibleMonth.month + delta, 1));
    const next = { year: date.getUTCFullYear(), month: date.getUTCMonth() };
    const nextKey = isoMonth(next.year, next.month);
    const firstEventDate = events.find((event) => event.date.startsWith(nextKey))?.date;
    setVisibleMonth(next);
    setSelectedDate(nextKey === today.slice(0, 7) ? today : firstEventDate ?? `${nextKey}-01`);
    setEventListDate(null);
  }

  function returnToToday() {
    setVisibleMonth(monthFromIso(today));
    setSelectedDate(today);
    setEventListDate(null);
  }

  const controls = (
    <div className="flex items-center gap-1" aria-label={translate(language, "recruitmentCalendar")}>
      <button type="button" className="grid size-9 place-items-center rounded-lg border border-[#C9D5E6] text-slate hover:bg-[#F8FAFD] hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30" aria-label={translate(language, "previousMonth")} onClick={() => moveMonth(-1)}><ChevronLeft size={17} aria-hidden="true" /></button>
      <button type="button" className="min-h-9 rounded-lg border border-[#C9D5E6] px-3 text-xs font-semibold text-navy hover:bg-[#F8FAFD] focus:outline-none focus:ring-2 focus:ring-primary/30" onClick={returnToToday}>{translate(language, "today")}</button>
      <button type="button" className="grid size-9 place-items-center rounded-lg border border-[#C9D5E6] text-slate hover:bg-[#F8FAFD] hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30" aria-label={translate(language, "nextMonth")} onClick={() => moveMonth(1)}><ChevronRight size={17} aria-hidden="true" /></button>
    </div>
  );

  return (
    <Panel variant="workspace" className={`p-3 sm:p-4 ${className}`}>
      <SectionTitle title={translate(language, "recruitmentCalendar")} action={controls} />
      <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-[#E4E9F2] bg-[#F8FAFD] px-2.5 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarDays size={17} className="shrink-0 text-primary" aria-hidden="true" />
          <strong className="truncate text-sm text-navy" aria-live="polite">{monthLabel}</strong>
        </div>
        <span className="shrink-0 text-xs font-semibold tabular-nums text-slate">{translate(language, "calendarEventsCount", { count: monthEvents.length, plural: monthEvents.length === 1 ? "" : "s" })}</span>
      </div>

      <div className="hidden md:block" data-recruitment-calendar="desktop">
        <div className="grid grid-cols-7 border-x border-t border-[#D7DEE8] bg-[#F8FAFD] text-center text-xs font-semibold text-slate">
          {weekdayLabels[language].map((label) => <div key={label} className="border-r border-[#D7DEE8] py-1 last:border-r-0">{label}</div>)}
        </div>
        <div className="grid grid-cols-7 border-l border-t border-[#D7DEE8]">
          {cells.map((date, index) => {
            if (!date) return <div key={`blank-${index}`} aria-hidden="true" className="h-24 border-b border-r border-[#D7DEE8] bg-[#F8FAFD]/70" />;
            const dayEvents = eventsByDate.get(date) ?? [];
            const visibleEvents = dayEvents.slice(0, 2);
            return <div key={date} className={`relative h-24 min-w-0 border-b border-r border-[#D7DEE8] p-1 ${date === today ? "bg-[#F1F7FF] shadow-[inset_0_0_0_2px_rgb(var(--app-primary-rgb)/0.35)]" : "bg-white"}`}>
              <span className={`absolute left-1 top-1 inline-grid size-4 place-items-center rounded text-[10px] font-semibold tabular-nums ${date === today ? "bg-primary text-white" : "text-navy"}`}>{Number(date.slice(-2))}</span>
              {dayEvents.length >= 3 ? <button type="button" className="absolute right-1 top-1 rounded px-1 text-[10px] font-semibold tabular-nums text-primary hover:bg-[#F1F7FF] focus:outline-none focus:ring-2 focus:ring-primary/30" aria-label={translate(language, "showAllEvents", { count: dayEvents.length, date: formatDate(date, language) })} title={translate(language, "showAllEvents", { count: dayEvents.length, date: formatDate(date, language) })} onClick={() => setEventListDate(date)}>({dayEvents.length})</button> : null}
              <div className="mt-5 grid gap-0.5">
                {visibleEvents.map((event) => <CalendarEventButton key={`${event.candidateId}-${event.eventType}-${event.stage}-${event.round}`} compact event={event} language={language} onOpenCandidate={onOpenCandidate} />)}
              </div>
            </div>;
          })}
        </div>
      </div>

      <div className="md:hidden" data-recruitment-calendar="mobile">
        <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-slate">{weekdayLabels[language].map((label) => <span key={label} className="py-1.5">{label}</span>)}</div>
        <div role="grid" aria-label={translate(language, "recruitmentCalendar")} className="grid grid-cols-7 gap-1">
          {cells.map((date, index) => {
            if (!date) return <span key={`blank-${index}`} role="gridcell" aria-hidden="true" />;
            const count = eventsByDate.get(date)?.length ?? 0;
            const selected = date === selectedDate;
            return <div key={date} role="gridcell" aria-selected={selected}>
              <button type="button" aria-label={`${formatDate(date, language)}, ${translate(language, "calendarEventsCount", { count, plural: count === 1 ? "" : "s" })}`} aria-pressed={selected} className={`relative grid min-h-11 w-full place-items-center rounded-lg border text-xs font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary/30 ${selected ? "border-primary bg-primary text-white" : date === today ? "border-primary/50 bg-[#F1F7FF] text-primary" : "border-[#E4E9F2] bg-white text-navy"}`} onClick={() => setSelectedDate(date)}>
                {Number(date.slice(-2))}
                {count > 0 ? <span className={`absolute bottom-1 right-1 inline-grid min-w-4 place-items-center rounded px-1 text-[9px] ${selected ? "bg-white text-primary" : "bg-primary/10 text-primary"}`}>{count}</span> : null}
              </button>
            </div>;
          })}
        </div>
        <div className="mt-3 border-t border-[#E4E9F2] pt-3" aria-label={translate(language, "selectedDayEvents", { date: formatDate(selectedDate, language) })}>
          <p className="mb-2 text-xs font-semibold text-slate">{translate(language, "selectedDayEvents", { date: formatDate(selectedDate, language) })}</p>
          <div className="grid gap-2">
            {selectedEvents.length > 0 ? selectedEvents.map((event) => <CalendarEventButton key={`${event.candidateId}-${event.eventType}-${event.stage}-${event.round}`} event={event} language={language} mobile onOpenCandidate={onOpenCandidate} />) : <p className="rounded-lg bg-[#F8FAFD] px-3 py-3 text-sm font-medium text-slate">{translate(language, "noEstimatedActionsForDate")}</p>}
          </div>
        </div>
      </div>

      {monthEvents.length === 0 ? <div className="mt-3"><EmptyState variant="quiet" message={translate(language, "noEstimatedActions")} /></div> : null}
      <Drawer
        closeLabel={translate(language, "close")}
        eyebrow={translate(language, "recruitmentCalendar")}
        onClose={() => setEventListDate(null)}
        open={Boolean(eventListDate)}
        title={eventListDate ? translate(language, "selectedDayEvents", { date: formatDate(eventListDate, language) }) : ""}
      >
        <div className="grid gap-2">
          {eventListEvents.map((event) => <CalendarEventDetail key={`${event.candidateId}-${event.eventType}-${event.stage}-${event.round}`} candidate={candidateById.get(event.candidateId)} event={event} language={language} profile={profile} onEditPending={(candidate) => { setEventListDate(null); onEditPending?.(candidate); }} onOpenCandidate={(candidateId) => { setEventListDate(null); onOpenCandidate(candidateId); }} />)}
        </div>
      </Drawer>
    </Panel>
  );
}

function CalendarEventDetail({ candidate, event, language, profile, onEditPending, onOpenCandidate }: { candidate: EnrichedCandidate | undefined; event: CalendarEvent; language: Language; profile: Profile | null; onEditPending: (candidate: EnrichedCandidate) => void; onOpenCandidate: (candidateId: string) => void }) {
  const isStageEvent = event.eventType === "stage" && Boolean(event.log) && Boolean(candidate);
  const canEdit = isStageEvent && candidatePipelineCapability(candidate!, [event.log!], profile).canWrite;
  if (!isStageEvent) {
    return <div className="rounded-md border border-[#D7DEE8] bg-white p-3 shadow-[0_6px_16px_rgba(11,19,43,0.025)]">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><strong className="min-w-0 break-words text-navy">{event.candidateName}</strong><Tag tone="teal">{translate(language, "startWorkingEvent")}</Tag></div>
      <p className="mt-1 break-words text-sm font-medium text-slate">{event.position ?? "-"}</p>
      <p className="mt-1 text-sm font-semibold text-primary">{formatDate(event.date, language)}</p>
      <div className="mt-3"><Button type="button" size="sm" variant="secondary" onClick={() => onOpenCandidate(event.candidateId)}>{translate(language, "viewDetail")}</Button></div>
    </div>;
  }

  const log = event.log!;
  return <div className="min-w-0 rounded-md border border-[#D7DEE8] bg-white p-3 shadow-[0_6px_16px_rgba(11,19,43,0.025)]">
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2"><strong className="min-w-0 break-words text-navy">{event.candidateName}</strong><Tag tone="warning">{translate(language, "awaitingOutcome")}</Tag></div>
    <p className="mt-1 text-sm font-semibold text-navy">{processLabel(event.stage, language)} / {translate(language, "round")} {event.round}</p>
    <p className="mt-1 break-words text-sm font-medium text-slate">{translate(language, "pendingDetails")}: {formatDate(log.log_date, language)} / {log.interviewer ?? translate(language, "noInterviewer")}</p>
    <p className="mt-1 break-words text-sm font-semibold text-primary">{translate(language, "estimatedDateValue", { date: formatDate(event.date, language) })}</p>
    {log.remark ? <p className="mt-1 break-words text-sm text-slate">{log.remark}</p> : null}
    <div className="mt-3 flex flex-wrap items-center gap-2">
      {event.overdue ? <Tag tone="danger">{translate(language, "overdue")}</Tag> : null}
      {canEdit ? <Button type="button" size="sm" variant="secondary" onClick={() => onEditPending(candidate!)}>{translate(language, "edit")}</Button> : null}
      <Button type="button" size="sm" variant="secondary" onClick={() => onOpenCandidate(event.candidateId)}>{translate(language, "viewDetail")}</Button>
    </div>
  </div>;
}

function CalendarEventButton({ compact = false, event, language, mobile = false, onOpenCandidate }: { compact?: boolean; event: CalendarEvent; language: Language; mobile?: boolean; onOpenCandidate: (candidateId: string) => void }) {
  const isStartWork = event.eventType === "start_work";
  const detail = isStartWork ? event.position ?? "-" : `${processLabel(event.stage, language)} · ${translate(language, "round")} ${event.round}`;
  const eventType = translate(language, isStartWork ? "startWorkingEvent" : "stageEvent");
  const label = translate(language, "calendarEventLabel", {
    date: formatDate(event.date, language),
    eventType,
    name: event.candidateName,
    overdue: event.overdue ? `, ${translate(language, "overdue")}` : ""
  });
  return <button type="button" aria-label={label} title={label} className={`${mobile ? "min-h-11 p-3" : compact ? "min-h-7 px-1 py-0.5" : "min-h-9 p-1.5"} min-w-0 rounded-md border text-left focus:outline-none focus:ring-2 focus:ring-primary/30 ${event.overdue ? "border-[#F4B4AE] bg-[#FFF8F7] text-scarlet hover:bg-[#FFF1F0]" : "border-[rgb(var(--app-primary-rgb)/0.22)] bg-[rgb(var(--app-primary-rgb)/0.08)] text-navy hover:bg-[#F1F7FF]"}`} onClick={() => onOpenCandidate(event.candidateId)}>
    <strong className={`block truncate font-semibold ${compact ? "text-[11px] leading-3" : "text-xs"}`}>{event.candidateName}</strong>
    <span className={`flex min-w-0 items-center gap-1 font-medium ${compact ? "text-[10px] leading-3" : "text-[11px]"}`}><span className="shrink-0" aria-hidden="true">{isStartWork ? <BriefcaseBusiness size={compact ? 11 : 13} /> : <CalendarClock size={compact ? 11 : 13} />}</span><span className="truncate">{detail}</span></span>
    {mobile ? <span className="mt-1 block truncate text-[11px] font-medium">{event.site ?? "-"} · {event.owner ?? "-"}</span> : null}
    {event.overdue ? <span className={`${compact ? "text-[9px] leading-3" : "mt-0.5 text-[10px]"} block font-semibold`}>{translate(language, "overdue")}</span> : null}
  </button>;
}

function compareEvents(a: CalendarEvent, b: CalendarEvent) {
  return a.date.localeCompare(b.date)
    || processIndex(a.stage) - processIndex(b.stage)
    || a.eventType.localeCompare(b.eventType)
    || a.candidateName.localeCompare(b.candidateName)
    || a.candidateId.localeCompare(b.candidateId);
}

function groupEventsByDate(events: CalendarEvent[]) {
  const groups = new Map<string, CalendarEvent[]>();
  for (const event of events) groups.set(event.date, [...(groups.get(event.date) ?? []), event]);
  return groups;
}

function monthCells(year: number, month: number) {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const weekCount = Math.ceil((firstWeekday + days) / 7);
  return Array.from({ length: weekCount * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day < 1 || day > days ? null : `${isoMonth(year, month)}-${String(day).padStart(2, "0")}`;
  });
}

function monthFromIso(value: string) {
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) - 1 };
}

function isoMonth(year: number, month: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

function bangkokToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", timeZone: "Asia/Bangkok", year: "numeric" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}
