"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/Button";

export function Modal({
  open,
  title,
  children,
  closeLabel = "Close",
  onClose,
  width = "max-w-3xl"
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  closeLabel?: string;
  onClose: () => void;
  width?: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useDialogFocus(open, panelRef, onClose);
  useOverlayScrollLock(open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-stretch bg-navy/45 p-0 sm:place-items-center sm:p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => trapDialogTabKey(event, panelRef.current)}
        className={`max-h-screen min-w-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain bg-white shadow-2xl outline-none sm:max-h-[92vh] sm:rounded-lg ${width}`}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#D7DEE8] bg-white px-5 py-4">
          <h3 id={titleId} className="text-lg font-semibold text-navy">{title}</h3>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            title={closeLabel}
            aria-label={closeLabel}
            className="relative text-slate after:absolute after:-inset-1 hover:text-navy"
            icon={<X size={16} aria-hidden="true" />}
          />
        </div>
        <div className="min-w-0 p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}

function useOverlayScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
}

function useDialogFocus(open: boolean, panelRef: RefObject<HTMLElement>, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => panelRef.current?.focus(), 0);

    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
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
