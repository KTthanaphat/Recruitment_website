"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/Button";
import { useOverlayScrollLock } from "@/components/ui/overlay-scroll-lock";

export function Modal({
  open,
  closeDisabled = false,
  title,
  children,
  closeLabel = "Close",
  onClose,
  width = "max-w-3xl",
  compactControls = false,
  subtitle,
  titleIcon,
  compactWarning = false
}: {
  open: boolean;
  closeDisabled?: boolean;
  title: string;
  children: ReactNode;
  closeLabel?: string;
  onClose: () => void;
  width?: string;
  compactControls?: boolean;
  subtitle?: string;
  titleIcon?: ReactNode;
  compactWarning?: boolean;
}) {
  const titleId = useId();
  const subtitleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useDialogFocus(open, panelRef, onClose);
  useOverlayScrollLock(open);

  if (!open) return null;

  return (
    <div className={compactWarning ? "contact-match-overlay fixed inset-0 z-[60] grid bg-navy/45" : "fixed inset-0 z-[60] grid place-items-stretch bg-navy/45 p-0 sm:place-items-center sm:p-4"}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
        tabIndex={-1}
        onKeyDown={(event) => trapDialogTabKey(event, panelRef.current)}
        className={compactWarning ? "contact-match-modal min-w-0 w-full bg-white outline-none" : `max-h-screen min-w-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain bg-white shadow-2xl outline-none sm:max-h-[92vh] sm:rounded-lg ${width} ${compactControls ? "dashboard-compact-controls" : ""}`}
      >
        <div className={compactWarning ? "contact-match-header flex items-start justify-between gap-3" : "sticky top-0 z-10 flex items-center justify-between border-b border-[#D7DEE8] bg-white px-5 py-4"}>
          <div className="min-w-0 flex-1"><div className="flex items-start gap-2">{titleIcon ? <span className="mt-1 shrink-0" aria-hidden="true">{titleIcon}</span> : null}<h3 id={titleId} className="text-lg font-semibold text-navy">{title}</h3></div>{subtitle ? <p id={subtitleId} className="mt-1.5 text-sm leading-relaxed text-slate">{subtitle}</p> : null}</div>
          <Button
            type="button"
            variant="ghost"
            size={compactControls ? "icon-toolbar" : "icon-sm"}
            disabled={closeDisabled}
            onClick={onClose}
            title={closeLabel}
            aria-label={closeLabel}
            className="relative text-slate after:absolute after:-inset-1 hover:text-navy"
            icon={<X size={16} aria-hidden="true" />}
          />
        </div>
        <div className={compactWarning ? "contact-match-body" : "min-w-0 p-4 sm:p-5"}>{children}</div>
      </div>
    </div>
  );
}

function useDialogFocus(open: boolean, panelRef: RefObject<HTMLElement>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => panelRef.current?.focus(), 0);

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A nested confirmation/review owns Escape; keep the underlying form draft open.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs[dialogs.length - 1] !== panelRef.current) return;
      event.preventDefault();
      onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose, open, panelRef]);
}

function trapDialogTabKey(event: KeyboardEvent, container: HTMLElement | null) {
  if (event.key !== "Tab" || !container) return;
  const focusable = Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), details summary, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((element) => !element.hasAttribute("disabled") && !element.getAttribute("aria-hidden"));
  if (focusable.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}
