"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { Button } from "@/components/ui/Button";

export function Drawer({
  open,
  eyebrow,
  title,
  headerActions,
  headerMeta,
  inactive = false,
  children,
  onClose
}: {
  open: boolean;
  eyebrow: string;
  title: string;
  headerActions?: ReactNode;
  headerMeta?: ReactNode;
  inactive?: boolean;
  children: ReactNode;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);

  useDrawerFocus(open && !inactive, panelRef, onClose);
  useOverlayScrollLock(open);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    if (inactive) panel.setAttribute("inert", "");
    else panel.removeAttribute("inert");
  }, [inactive, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-navy/45">
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal={inactive ? undefined : "true"}
        aria-hidden={inactive || undefined}
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(event) => trapDrawerTabKey(event, panelRef.current)}
        className="h-full min-w-0 w-full overflow-x-hidden overflow-y-auto overscroll-contain bg-white shadow-2xl outline-none sm:max-w-2xl"
      >
        <div className="sticky top-0 z-30 grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-[#D7DEE8] bg-white px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-medium uppercase tracking-normal text-slate">{eyebrow}</p>
            <h3 id={titleId} className="break-words text-xl font-semibold text-navy">{title}</h3>
            {headerMeta ? <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2">{headerMeta}</div> : null}
          </div>
          <div className="flex items-start justify-end gap-2">
            {headerActions}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              title="Close"
              aria-label="Close"
              className="relative text-slate after:absolute after:-inset-1 hover:text-navy"
              icon={<X size={16} aria-hidden="true" />}
            />
          </div>
        </div>
        <div className="min-w-0 p-4 sm:p-5">{children}</div>
      </aside>
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

function useDrawerFocus(open: boolean, panelRef: RefObject<HTMLElement>, onClose: () => void) {
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

function trapDrawerTabKey(event: KeyboardEvent, container: HTMLElement | null) {
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
