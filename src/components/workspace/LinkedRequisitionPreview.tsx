"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatRequisitionOptionLabel, formatRequisitionTitle } from "@/lib/format";
import { requisitionStatusLabel, translate } from "@/lib/i18n/dictionary";
import type { EnrichedRequisition, Language } from "@/types/recruitment";

export function LinkedRequisitionPreview({ groupName, language, requisitions, onOpenRequisition }: { groupName: string; language: Language; requisitions: EnrichedRequisition[]; onOpenRequisition: (docId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 0 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const pointerFocus = useRef(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const cancelClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null; };
  const scheduleClose = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), 150); };
  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(360, window.innerWidth - 24);
    const top = window.innerHeight - rect.bottom >= 220 || rect.top < 220 ? rect.bottom + 6 : Math.max(12, rect.top - Math.min(320, window.innerHeight - 24) - 6);
    setPosition({ top, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    const onPointerDown = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node) && !previewRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const label = translate(language, requisitions.length === 1 ? "workspaceRequisitionCountOne" : "workspaceRequisitionCountMany", { count: requisitions.length });
  return <>
    <button
      ref={triggerRef}
      type="button"
      className="min-h-11 max-w-full rounded-md px-1 text-left text-sm font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      aria-label={`${translate(language, "linkedRequisitions")}: ${label}, ${groupName}`}
      aria-expanded={open}
      aria-controls={id}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") { cancelClose(); setOpen(true); } }}
      onPointerLeave={(event) => { if (event.pointerType === "mouse" && !previewRef.current?.contains(event.relatedTarget as Node)) scheduleClose(); }}
      onPointerDown={() => { pointerFocus.current = true; }}
      onFocus={() => { if (!pointerFocus.current) setOpen(true); pointerFocus.current = false; }}
      onClick={() => { cancelClose(); setOpen(true); }}
    >{label}</button>
    {open && typeof document !== "undefined" ? createPortal(
      <div
        ref={previewRef}
        id={id}
        role="region"
        aria-label={`${translate(language, "linkedRequisitions")}: ${groupName}`}
        data-testid="workspace-requisition-preview"
        className="fixed z-[80] max-h-[min(20rem,calc(100dvh-1.5rem))] overflow-y-auto overscroll-contain rounded-lg border border-[#C9D5E6] bg-white p-2 shadow-lg"
        style={{ top: position.top, left: position.left, width: position.width }}
        onPointerEnter={() => { cancelClose(); setOpen(true); }}
        onPointerLeave={(event) => { if (event.pointerType === "mouse" && !triggerRef.current?.contains(event.relatedTarget as Node)) scheduleClose(); }}
      >
        <p className="px-2 py-1 text-xs font-semibold text-slate">{translate(language, "linkedRequisitions")}</p>
        <ul className="divide-y divide-[#E4E9F2]">
          {requisitions.map((row) => <li key={row.doc_id} className="min-w-0 text-sm">
            <button type="button" className="block min-h-11 w-full rounded-md px-2 py-2 text-left hover:bg-[#F1F6FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" aria-label={formatRequisitionOptionLabel(row)} onClick={() => { cancelClose(); setOpen(false); onOpenRequisition(row.doc_id); }}>
              <span className="block break-words font-semibold text-navy">{formatRequisitionTitle(row)}</span>
              <span className="block break-all text-xs text-slate">{row.doc_id}</span>
              <span className="mt-1 block text-xs text-slate">{requisitionStatusLabel(language, row.status)} · {Math.min(row.head_count, row.accepted_count)}/{row.head_count}</span>
            </button>
          </li>)}
        </ul>
      </div>, document.body) : null}
  </>;
}
