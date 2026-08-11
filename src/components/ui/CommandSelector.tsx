"use client";

import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type CommandOption = { value: string; label: string; disabled?: boolean };

export function CommandSelector({
  ariaLabel, className = "", density = "regular", disabled = false, emptyLabel, icon, name,
  onValueChange, options, value
}: {
  ariaLabel: string;
  className?: string;
  density?: "compact" | "regular";
  disabled?: boolean;
  emptyLabel: string;
  icon?: ReactNode;
  name?: string;
  onValueChange: (value: string) => void;
  options: readonly CommandOption[];
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options.find((option) => option.value === value);
  const height = density === "compact" ? "min-h-9" : "min-h-11";

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function openAt(index = selectedIndex) { if (disabled) return; setActiveIndex(index); setOpen(true); }
  function choose(option: CommandOption) { if (option.disabled) return; onValueChange(option.value); setOpen(false); triggerRef.current?.focus(); }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") { setOpen(false); return; }
    if (["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) { openAt(event.key === "End" ? options.length - 1 : event.key === "ArrowUp" ? Math.max(0, selectedIndex - 1) : selectedIndex); return; }
      if (event.key === "Home") setActiveIndex(0);
      else if (event.key === "End") setActiveIndex(options.length - 1);
      else if (event.key === "ArrowDown") setActiveIndex((current) => Math.min(options.length - 1, current + 1));
      else if (event.key === "ArrowUp") setActiveIndex((current) => Math.max(0, current - 1));
      else choose(options[activeIndex]);
    }
  }

  return <div ref={rootRef} className={`relative ${className}`}>
    {name ? <input type="hidden" name={name} value={value} /> : null}
    <button ref={triggerRef} type="button" disabled={disabled} onClick={() => open ? setOpen(false) : openAt()} onKeyDown={onKeyDown}
      className={`flex ${height} w-full items-center gap-2 rounded-xl border border-[#B8CCE4] ${density === "compact" ? "bg-[#F8FAFD] text-primary" : "bg-white"} px-3 text-left text-sm font-semibold text-navy shadow-sm transition hover:border-primary/60 hover:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-[#F1F5F9]`}
      aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`}>
      <span className="shrink-0 text-primary" aria-hidden="true">{icon ?? <SlidersHorizontal size={density === "compact" ? 15 : 16} />}</span>
      <span className="min-w-0 flex-1 truncate">{selected?.label ?? emptyLabel}</span>
      <ChevronDown size={density === "compact" ? 16 : 17} className={`shrink-0 text-slate transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open ? <div id={`${id}-options`} role="listbox" aria-label={ariaLabel} className="absolute right-0 z-50 mt-2 grid max-h-72 w-full min-w-[12rem] overflow-y-auto grid-cols-1 gap-1.5 rounded-2xl border border-[#C9D5E6] bg-white p-2 shadow-[0_18px_40px_rgba(11,19,43,0.18)]">
      {options.map((option, index) => <button key={option.value || "empty"} type="button" role="option" aria-selected={option.value === value} disabled={option.disabled} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(option)}
        className={`relative min-h-10 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${option.value === value ? "border-primary bg-primary text-white shadow-sm" : "border-[#E4E9F2] bg-[#F8FAFD] text-navy hover:border-[#8AAED8] hover:bg-white"} ${activeIndex === index ? "ring-2 ring-primary/20" : ""}`}>
        <span className="block pr-5">{option.label}</span>{option.value === value ? <Check size={16} className="absolute right-3 top-1/2 -translate-y-1/2" aria-hidden="true" /> : null}
      </button>)}
    </div> : null}
  </div>;
}

export function CommandMonthSelector({ ariaLabel, monthLabel, nextYearLabel, onValueChange, previousYearLabel, value }: { ariaLabel: string; monthLabel: (month: number) => string; nextYearLabel: string; onValueChange: (value: string) => void; previousYearLabel: string; value: string }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(value.slice(0, 4)) || new Date().getFullYear());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  useEffect(() => { const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  function close() { setOpen(false); triggerRef.current?.focus(); }
  return <div ref={rootRef} className="relative">
    <button ref={triggerRef} type="button" onClick={() => { setYear(Number(value.slice(0, 4)) || year); setOpen((current) => !current); }} onKeyDown={(event) => { if (event.key === "Escape") close(); if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); setOpen(true); } }} className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[#B8CCE4] bg-white px-3 text-left text-sm font-semibold text-navy shadow-sm transition hover:border-primary/60 hover:bg-[#FBFDFF] focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-months`}>
      <CalendarDays size={16} className="shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1 truncate tabular-nums">{value ? `${monthLabel(Number(value.slice(5, 7)))} ${value.slice(0, 4)}` : ariaLabel}</span><ChevronDown size={17} className={`shrink-0 text-slate transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open ? <div id={`${id}-months`} role="dialog" aria-label={ariaLabel} className="absolute z-50 mt-2 w-[19rem] rounded-2xl border border-[#C9D5E6] bg-white p-3 shadow-[0_18px_40px_rgba(11,19,43,0.18)]">
      <div className="mb-3 flex items-center justify-between rounded-xl bg-[#F8FAFD] p-1"><button type="button" className="grid size-8 place-items-center rounded-lg text-slate hover:bg-white hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label={previousYearLabel} onClick={() => setYear((current) => current - 1)}><ChevronLeft size={17} /></button><span className="text-sm font-semibold tabular-nums text-navy">{year}</span><button type="button" className="grid size-8 place-items-center rounded-lg text-slate hover:bg-white hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label={nextYearLabel} onClick={() => setYear((current) => current + 1)}><ChevronRight size={17} /></button></div>
      <div className="grid grid-cols-3 gap-1.5">{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => { const next = `${year}-${String(month).padStart(2, "0")}`; const selected = next === value; return <button key={month} type="button" aria-pressed={selected} className={`min-h-10 rounded-xl border px-2 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${selected ? "border-primary bg-primary text-white shadow-sm" : "border-[#E4E9F2] bg-[#F8FAFD] text-navy hover:border-[#8AAED8] hover:bg-white"}`} onClick={() => { onValueChange(next); close(); }}>{monthLabel(month)}</button>; })}</div>
    </div> : null}
  </div>;
}
