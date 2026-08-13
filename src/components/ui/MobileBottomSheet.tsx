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
  children
}: {
  open: boolean;
  title: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const sheetRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [isPhone, setIsPhone] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setIsPhone(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useOverlayScrollLock(open && isPhone);

  useEffect(() => {
    if (!open || !isPhone) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    window.setTimeout(() => sheetRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [isPhone, onClose, open]);

  if (!open || !isPhone) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end bg-navy/45 md:hidden" onMouseDown={onClose}>
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
