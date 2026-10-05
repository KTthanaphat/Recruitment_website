"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { useOverlayScrollLock } from "@/components/ui/overlay-scroll-lock";

/** A phone-sized secondary-action surface. Desktop callers should retain their inline controls. */
export function MobileBottomSheet({
  open,
  title,
  closeLabel,
  onClose,
  breakpoint = "md",
  children
}: {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  breakpoint?: "md" | "lg";
  children: ReactNode;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [isPhone, setIsPhone] = useState(false);
  const closeRef = useRef(onClose), openRef = useRef(open);
  closeRef.current = onClose; openRef.current = open;
  useEffect(() => {
    const query = window.matchMedia(breakpoint === "lg" ? "(max-width: 1023px)" : "(max-width: 767px)");
    const update = () => { setIsPhone(query.matches); if (!query.matches && openRef.current) closeRef.current(); };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, [breakpoint]);
  useOverlayScrollLock(open && isPhone);

  useEffect(() => {
    if (!open || !isPhone) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timeout = window.setTimeout(() => sheetRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = Array.from(sheetRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []).filter(item => item.getClientRects().length > 0);
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); sheetRef.current?.focus(); }
      else if (event.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timeout);
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus();
    };
  }, [isPhone, open]);

  if (!open || !isPhone) return null;

  return (
    <div className={`fixed inset-0 z-[70] flex items-end bg-navy/45 ${breakpoint === "lg" ? "lg:hidden" : "md:hidden"}`} onMouseDown={onClose}>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
        className="max-h-[min(84dvh,42rem)] w-full overflow-y-auto overscroll-contain rounded-t-2xl bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl outline-none"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#D7DEE8] bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="mb-2 h-1 w-9 rounded-full bg-[#C9D5E6]" aria-hidden="true" />
            <h3 id={titleId} className="text-base font-semibold text-navy">{title}</h3>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label={closeLabel} title={closeLabel} onClick={onClose} icon={<X size={16} aria-hidden="true" />} />
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
