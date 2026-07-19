"use client";

import { LampDesk, MoreVertical } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Tag } from "@/components/ui/Tag";
import type { DisabledReason, NextActionTone, OperationalSummaryItem, WorkQueueItem } from "@/lib/operations";
import { buildContextualHref } from "@/lib/workspace-url-state";

export type RecordAction = {
  id: string;
  label: string;
  href?: string;
  onSelect?: () => void;
  icon?: ReactNode;
  iconOnly?: boolean;
  tone?: "primary" | "secondary" | "danger";
  disabledReason?: DisabledReason;
  external?: boolean;
};

export type RecordActionGroupProps = {
  label: string;
  primary?: RecordAction;
  items: RecordAction[];
};

export type RecordQuickAction = RecordAction & {
  iconOnly?: boolean;
};

export function RecordQuickActions({ actions, label }: { actions: RecordQuickAction[]; label: string }) {
  const searchParams = useSearchParams();
  const withContext = (action: RecordQuickAction) => action.href?.startsWith("/") && !action.external
    ? {
      ...action,
      href: buildContextualHref(action.href, {
        language: searchParams.get("lang"),
        site: searchParams.get("site"),
        owner: searchParams.get("pic"),
        sourcingWeek: searchParams.get("sourcingWeek")
      })
    }
    : action;

  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5" aria-label={label}>
      {actions.map((action) => <RecordActionControl key={action.id} action={withContext(action)} onComplete={() => undefined} />)}
    </div>
  );
}

export function RecordActionGroup({ label, primary, items }: RecordActionGroupProps) {
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const withContext = (action: RecordAction) => action.href?.startsWith("/") && !action.external
    ? {
      ...action,
      href: buildContextualHref(action.href, {
        language: searchParams.get("lang"),
        site: searchParams.get("site"),
        owner: searchParams.get("pic"),
        sourcingWeek: searchParams.get("sourcingWeek")
      })
    }
    : action;

  useEffect(() => {
    if (!open) return;
    const firstAction = menuRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled])');
    firstAction?.focus();

    function closeOnOutsideClick(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [open]);

  function closeMenu(restoreFocus = true) {
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const actions = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? []);
    if (actions.length === 0) return;
    event.preventDefault();
    const current = actions.indexOf(document.activeElement as HTMLElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? actions.length - 1
        : event.key === "ArrowDown"
          ? (current + 1 + actions.length) % actions.length
          : (current - 1 + actions.length) % actions.length;
    actions[next]?.focus();
  }

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-wrap items-center gap-2">
      {primary ? <RecordActionControl action={withContext(primary)} prominent onComplete={() => setOpen(false)} /> : null}
      {items.length > 0 ? (
        <>
          <Button
            ref={triggerRef}
            type="button"
            size="icon-sm"
            variant="secondary"
            icon={<MoreVertical size={17} />}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`More actions for ${label}`}
            title={`More actions for ${label}`}
            onClick={() => setOpen((current) => !current)}
          >
            <span className="sr-only">More</span>
          </Button>
          {open ? (
            <div
              ref={menuRef}
              role="menu"
              aria-label={`Actions for ${label}`}
              className="absolute right-0 top-full z-50 mt-2 grid w-[min(20rem,calc(100vw-2rem))] gap-1 rounded-2xl border border-[#E4E9F2] bg-white p-1.5 shadow-[0_8px_24px_rgba(11,19,43,0.08)]"
              onKeyDown={onMenuKeyDown}
            >
              {items.map((action) => <RecordActionControl key={action.id} action={withContext(action)} menuItem onComplete={() => closeMenu(false)} />)}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function RecordActionControl({
  action,
  menuItem = false,
  onComplete,
  prominent = false
}: {
  action: RecordAction;
  menuItem?: boolean;
  onComplete: () => void;
  prominent?: boolean;
}) {
  const blocked = action.disabledReason?.blocked === true;
  const iconOnly = action.iconOnly && !menuItem;
  const className = menuItem
    ? "grid min-h-10 w-full grid-cols-[auto_1fr] items-center gap-x-2 rounded px-3 py-2 text-left text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:cursor-not-allowed disabled:text-cool"
    : iconOnly
      ? "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/25"
    : "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-primary/25";
  const content = (
    <>
      {action.icon ?? (iconOnly ? <LampDesk size={16} aria-hidden="true" /> : null)}
      <span className={iconOnly ? "sr-only" : "min-w-0"}>
        <span className="block">{action.label}</span>
        {blocked && action.disabledReason?.detail ? <span className="mt-0.5 block text-xs font-medium text-orange">{action.disabledReason.detail}</span> : null}
      </span>
    </>
  );

  if (action.href && !blocked) {
    return (
      <Link
        role={menuItem ? "menuitem" : undefined}
        aria-label={iconOnly ? action.label : undefined}
        title={iconOnly ? action.label : undefined}
        className={`${className} ${prominent ? "bg-primary text-white hover:bg-primary/90" : menuItem ? actionMenuClass(action.tone) : actionClass(action.tone)}`}
        href={action.href}
        target={action.external ? "_blank" : undefined}
        rel={action.external ? "noreferrer" : undefined}
        onClick={onComplete}
      >
        {content}
      </Link>
    );
  }

  return (
    <button
      role={menuItem ? "menuitem" : undefined}
      type="button"
      aria-label={iconOnly ? action.label : undefined}
      title={blocked ? action.disabledReason?.detail : iconOnly ? action.label : undefined}
      className={`${className} ${prominent ? "bg-primary text-white hover:bg-primary/90" : menuItem ? actionMenuClass(action.tone) : actionClass(action.tone)}`}
      disabled={blocked}
      onClick={() => {
        action.onSelect?.();
        onComplete();
      }}
    >
      {content}
    </button>
  );
}

export function OperationalSummaryStrip({ items, density = "default" }: { items: OperationalSummaryItem[]; density?: "default" | "compact" }) {
  return (
    <div className={`grid gap-2 ${density === "compact" ? "[grid-template-columns:repeat(auto-fit,minmax(130px,1fr))]" : "[grid-template-columns:repeat(auto-fit,minmax(150px,1fr))]"}`}>
      {items.map((item) => (
        <div key={item.label} className={`rounded-xl border ${density === "compact" ? "px-3 py-2" : "p-3"} ${summaryCardClass(item.tone)}`}>
          <p className="text-xs font-medium text-slate">{item.label}</p>
          <p className={`mt-1 font-semibold tabular-nums ${density === "compact" ? "text-lg" : "text-xl"} ${summaryValueClass(item.tone)}`}>{item.value}</p>
          {item.helper ? <p className="mt-1 text-xs font-medium text-cool">{item.helper}</p> : null}
        </div>
      ))}
    </div>
  );
}

export function AgeSlaIndicator({ age, label, overdue }: { age: number | null; label: string; overdue?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ${overdue ? "bg-[#FFF8F7] text-scarlet ring-[#F4B4AE]" : "bg-white text-slate ring-[#D7DEE8]"}`}>
      {age === null ? "-" : `${age}d`} - {label}
    </span>
  );
}

export function LinkedRecordActions({ links }: { links: Array<{ href: string; label: string; tone?: NextActionTone }> }) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link) => (
        <Link
          key={`${link.href}:${link.label}`}
          className={`inline-flex min-h-8 items-center rounded-md px-3 text-xs font-semibold ring-1 ring-inset transition-colors ${linkClass(link.tone)}`}
          href={link.href}
        >
          {link.label}
        </Link>
      ))}
    </div>
  );
}

export function RecordActionList({
  emptyMessage = "No urgent work right now.",
  items,
  layout = "stack",
  onOpenCandidate,
  onOpenRequisition
}: {
  emptyMessage?: string;
  items: WorkQueueItem[];
  layout?: "stack" | "horizontal";
  onOpenCandidate?: (candidateId: string) => void;
  onOpenRequisition?: (docId: string) => void;
}) {
  if (items.length === 0) {
    return <p className="rounded-xl border border-[#E4E9F2] bg-[#F8FAFD] p-3 text-sm font-medium text-slate">{emptyMessage}</p>;
  }

  const horizontal = layout === "horizontal";
  const listClass = horizontal ? "flex snap-x gap-3 overflow-x-auto overscroll-x-contain pb-2" : "grid gap-2";
  const itemClass = horizontal ? "w-[min(22rem,82vw)] shrink-0 snap-start" : "";

  return (
    <div className={listClass} data-home-scroll-section={horizontal ? "Today's Work" : undefined}>
      {items.map((item) => {
        const buttonAction = item.type === "candidate" || item.type === "offer"
          ? () => onOpenCandidate?.(item.recordId)
          : item.type === "requisition"
            ? () => onOpenRequisition?.(item.recordId)
            : undefined;
        const content = (
          <>
            <div className="min-w-0">
              <strong className="block truncate text-sm text-navy">{item.title}</strong>
              <p className="mt-0.5 text-xs font-medium text-slate">{item.meta}</p>
            </div>
            <Tag tone={item.tone}>{item.actionLabel}</Tag>
          </>
        );

        if (buttonAction) {
          return (
            <button
              key={item.id}
              type="button"
              className={`ats-card grid gap-2 p-3 text-left sm:grid-cols-[1fr_auto] sm:items-center ${itemClass}`}
              onClick={buttonAction}
            >
              {content}
            </button>
          );
        }

        return (
          <Link
            key={item.id}
            className={`ats-card grid gap-2 p-3 sm:grid-cols-[1fr_auto] sm:items-center ${itemClass}`}
            href={item.type === "sourcing" ? `/workspace?type=group&id=${encodeURIComponent(item.recordId)}` : "/sourcing"}
          >
            {content}
          </Link>
        );
      })}
    </div>
  );
}

function summaryValueClass(tone: NextActionTone = "primary") {
  if (tone === "danger") return "text-scarlet";
  if (tone === "muted") return "text-slate";
  return "text-navy";
}

function summaryCardClass(tone: NextActionTone = "primary") {
  if (tone === "danger") return "border-[#F4B4AE] bg-[#FFF8F7]";
  if (tone === "warning") return "border-[#F3D3A2] bg-white";
  return "border-[#E4E9F2] bg-white";
}

function linkClass(tone: NextActionTone = "primary") {
  if (tone === "danger") return "bg-[#FFF1F0] text-scarlet ring-[#F4B4AE] hover:bg-[#FFE1E1]";
  if (tone === "warning") return "bg-[#FFF7E8] text-orange ring-[#F3D3A2] hover:bg-[#FFEED2]";
  if (tone === "success") return "bg-white text-navy ring-[#C9D5E6] hover:bg-[#F8FAFD]";
  return "bg-white text-navy ring-[#C9D5E6] hover:bg-[#F8FAFD]";
}

function actionClass(tone: RecordAction["tone"] = "secondary") {
  if (tone === "danger") return "bg-[#FFF1F0] text-scarlet hover:bg-[#FFE1E1]";
  if (tone === "primary") return "bg-white text-navy ring-1 ring-inset ring-[#C9D5E6] hover:bg-[#F8FAFD]";
  return "bg-lightgray text-navy hover:bg-[#E6EDF7]";
}

function actionMenuClass(tone: RecordAction["tone"] = "secondary") {
  if (tone === "danger") return "bg-[#FFF1F0] text-scarlet hover:bg-[#FFE1E1]";
  if (tone === "primary") return "bg-primary text-white hover:bg-primary/90";
  return "text-navy hover:bg-lightgray";
}
