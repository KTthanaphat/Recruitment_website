"use client";

import { Check, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { Language } from "@/types/recruitment";

export type AttendanceOutcome = "started" | "did_not_start";

/** Opens the existing attendance review flow; this control never saves a record. */
export function AttendanceDecisionActions({ language, eligible = true, pending = false, onDecision }: {
  language: Language;
  eligible?: boolean;
  pending?: boolean;
  onDecision: (outcome: AttendanceOutcome) => void | Promise<void>;
}) {
  const locked = useRef(false);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState(false);
  async function decide(outcome: AttendanceOutcome) {
    if (locked.current || pending || !eligible) return;
    locked.current = true;
    setOpening(true); setOpenError(false);
    try { await onDecision(outcome); }
    catch { setOpenError(true); }
    finally { requestAnimationFrame(() => { locked.current = false; setOpening(false); }); }
  }
  if (!eligible) return null;
  return <div data-attendance-actions role="group" aria-label={language === "th" ? "ยืนยันการเริ่มงาน" : "Working confirmation actions"} aria-busy={pending || opening} className="flex shrink-0 flex-wrap items-center gap-2">
    {(["started", "did_not_start"] as const).map(outcome => <AttendanceDecisionButton key={outcome} language={language} outcome={outcome} disabled={pending || opening} onDecision={decide}/>)}
    {openError ? <span role="alert" className="w-full text-xs text-danger">{language === "th" ? "เปิดการยืนยันไม่สำเร็จ โปรดลองอีกครั้ง" : "Could not open confirmation. Please try again."}</span> : null}
  </div>;
}

function AttendanceDecisionButton({ language, outcome, disabled, onDecision }: {
  language: Language; outcome: AttendanceOutcome; disabled: boolean;
  onDecision: (outcome: AttendanceOutcome) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ left: 12, top: 12 });
  const trigger = useRef<HTMLButtonElement>(null);
  const tooltip = useRef<HTMLSpanElement>(null);
  const id = useId();
  const accept = outcome === "started";
  const label = language === "th"
    ? accept ? "ยอมรับ: เริ่มงานแล้ว" : "ปฏิเสธ: ไม่ได้เริ่มงาน"
    : accept ? "Accept: Started work" : "Reject: Did not start";
  const explanation = language === "th"
    ? accept ? "ยืนยันว่าผู้สมัครเริ่มงานแล้ว — ตรวจสอบก่อนบันทึก" : "ยืนยันว่าผู้สมัครไม่ได้เริ่มงาน — ระบุเหตุผลและตรวจสอบก่อนบันทึก"
    : accept ? "Confirm that the candidate started work — review before saving" : "Confirm that the candidate did not start — provide a reason and review before saving";

  useLayoutEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const width = tooltip.current?.offsetWidth ?? 240;
      const height = tooltip.current?.offsetHeight ?? 48;
      setPlacement({
        left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)),
        top: rect.top - height - 6 >= 12 ? rect.top - height - 6 : Math.min(rect.bottom + 6, window.innerHeight - height - 12)
      });
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus();
    };
    position();
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { document.removeEventListener("keydown", escape, true); window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open, explanation]);

  return <span className="inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
    <Button ref={trigger} type="button" variant="ghost" size="icon-sm"
      className={"ats-attendance-button " + (accept ? "ats-attendance-accept" : "ats-attendance-reject")}
      aria-label={label} title={label + " — " + explanation} aria-describedby={open ? id : undefined}
      disabled={disabled} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}
      onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); setOpen(false); event.stopPropagation(); } }}
      onClick={() => { setOpen(false); void onDecision(outcome); }}>
      {accept ? <Check size={18} aria-hidden="true"/> : <X size={18} aria-hidden="true"/>}
    </Button>
    {open ? createPortal(<span ref={tooltip} id={id} role="tooltip" style={{ ...placement, maxWidth: "calc(100vw - 24px)" }} className="pointer-events-none fixed z-[90] w-max rounded-md bg-navy px-3 py-2 text-xs font-normal leading-relaxed text-white shadow-lg">{explanation}</span>, document.body) : null}
  </span>;
}
