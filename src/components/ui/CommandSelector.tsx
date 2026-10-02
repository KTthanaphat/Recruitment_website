"use client";

import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type CommandOption = { value: string; label: string; disabled?: boolean };

export function CommandSelector({
  ariaLabel, ariaLabelledBy, className = "", density = "regular", disabled = false, emptyLabel, emptyOptionsLabel = "No options available", icon, name, required = false,
  onValueChange, options, value
}: {
  ariaLabel: string;
  ariaLabelledBy?: string;
  className?: string;
  density?: "compact" | "regular";
  disabled?: boolean;
  emptyLabel: string;
  emptyOptionsLabel?: string;
  icon?: ReactNode;
  name?: string;
  required?: boolean;
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
  const enabledIndices = options.flatMap((option, index) => option.disabled ? [] : [index]);

  useEffect(() => {
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-option-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id, open]);

  function openAt(index = selectedIndex) {
    if (disabled) return;
    const enabledIndex = options[index] && !options[index].disabled ? index : enabledIndices[0] ?? 0;
    setActiveIndex(enabledIndex);
    setOpen(true);
  }
  function moveActive(direction: 1 | -1) {
    if (enabledIndices.length === 0) return;
    const current = enabledIndices.indexOf(activeIndex);
    const next = (current + direction + enabledIndices.length) % enabledIndices.length;
    setActiveIndex(enabledIndices[next]);
  }
  function moveToEdge(edge: "start" | "end") {
    if (enabledIndices.length) setActiveIndex(edge === "start" ? enabledIndices[0] : enabledIndices[enabledIndices.length - 1]);
  }
  function choose(option: CommandOption | undefined) { if (!option || option.disabled) return; onValueChange(option.value); setOpen(false); triggerRef.current?.focus(); }
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "Escape") { setOpen(false); return; }
    if (["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!open) { openAt(event.key === "End" ? enabledIndices[enabledIndices.length - 1] : event.key === "ArrowUp" && selectedIndex > 0 ? selectedIndex - 1 : selectedIndex); return; }
      if (event.key === "Home") moveToEdge("start");
      else if (event.key === "End") moveToEdge("end");
      else if (event.key === "ArrowDown") moveActive(1);
      else if (event.key === "ArrowUp") moveActive(-1);
      else choose(options[activeIndex]);
    }
  }

  return <div ref={rootRef} className={`relative min-w-0 ${className}`}>
    {name ? <select className="ats-dropdown-form-value" aria-hidden="true" tabIndex={-1} name={name} value={value} required={required} disabled={disabled} onChange={() => undefined} onInvalid={(event) => { event.preventDefault(); triggerRef.current?.focus(); }}>
      {options.map((option) => <option key={option.value || "empty"} value={option.value} disabled={option.disabled}>{option.label}</option>)}
    </select> : null}
    <button ref={triggerRef} type="button" disabled={disabled} onClick={() => open ? setOpen(false) : openAt()} onKeyDown={onKeyDown}
      className={`ats-dropdown-trigger flex ${height} w-full items-center gap-2 rounded-xl border px-3 text-left text-sm font-semibold text-navy transition disabled:cursor-not-allowed`}
      aria-label={ariaLabelledBy ? undefined : ariaLabel} aria-labelledby={ariaLabelledBy} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open && options[activeIndex] ? `${id}-option-${activeIndex}` : undefined}>
      {icon ? <span className="shrink-0 text-primary" aria-hidden="true">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate" title={selected?.label ?? emptyLabel}>{selected?.label ?? emptyLabel}</span>
      <ChevronDown size={density === "compact" ? 16 : 17} className={`shrink-0 text-slate transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open ? <div id={`${id}-options`} role="listbox" aria-label={ariaLabel} className="ats-dropdown-menu absolute right-0 z-50 mt-2 grid max-h-72 w-full min-w-[12rem] max-w-[calc(100vw-2rem)] overflow-y-auto grid-cols-1 rounded-2xl border">
      {options.length === 0 ? <div role="option" aria-disabled="true" aria-selected="false" className="ats-dropdown-option text-sm text-slate">{emptyOptionsLabel}</div> : options.map((option, index) => {
        const selected = option.value === value;
        return <button id={`${id}-option-${index}`} key={option.value || "empty"} type="button" role="option" aria-selected={selected} tabIndex={-1} disabled={option.disabled} onMouseEnter={() => { if (!option.disabled) setActiveIndex(index); }} onClick={() => choose(option)}
          className={`ats-dropdown-option flex items-center gap-2 text-left text-sm font-semibold text-navy ${selected ? "is-selected" : ""} ${activeIndex === index ? "is-active" : ""}`}>
          <span className={`ats-dropdown-checkbox ${selected ? "is-checked" : ""}`} aria-hidden="true" />
          <span className="block min-w-0 break-words" title={option.label}>{option.label}</span>
        </button>;
      })}
    </div> : null}
  </div>;
}

export function CommandMonthSelector({ ariaLabel, monthLabel, nextYearLabel, onValueChange, previousYearLabel, value }: { ariaLabel: string; monthLabel: (month: number) => string; nextYearLabel: string; onValueChange: (value: string) => void; previousYearLabel: string; value: string }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(value.slice(0, 4)) || new Date().getFullYear());
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const monthButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const id = useId();
  useEffect(() => { const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("mousedown", close); return () => document.removeEventListener("mousedown", close); }, []);
  function close() { setOpen(false); triggerRef.current?.focus(); }
  function openAtSelectedMonth() {
    const selectedMonth = Math.max(0, Math.min(11, Number(value.slice(5, 7)) - 1));
    setYear(Number(value.slice(0, 4)) || year);
    setOpen(true);
    requestAnimationFrame(() => monthButtons.current[selectedMonth]?.focus());
  }
  function handleMonthMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const current = monthButtons.current.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? 11 : Math.max(0, Math.min(11, current + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "ArrowDown" ? 3 : -3)));
    monthButtons.current[next]?.focus();
  }
  return <div ref={rootRef} className="relative">
    <button ref={triggerRef} type="button" onClick={() => open ? close() : openAtSelectedMonth()} onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); close(); } if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key) && !open) { event.preventDefault(); openAtSelectedMonth(); } }} className="ats-dropdown-trigger flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm font-semibold text-navy transition" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open} aria-controls={`${id}-months`}>
      <CalendarDays size={16} className="shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1 truncate tabular-nums" title={value ? `${monthLabel(Number(value.slice(5, 7)))} ${value.slice(0, 4)}` : ariaLabel}>{value ? `${monthLabel(Number(value.slice(5, 7)))} ${value.slice(0, 4)}` : ariaLabel}</span><ChevronDown size={17} className={`shrink-0 text-slate transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
    </button>
    {open ? <div id={`${id}-months`} role="dialog" aria-label={ariaLabel} className="ats-dropdown-menu absolute z-50 mt-2 max-h-72 w-[19rem] max-w-[calc(100vw-2rem)] rounded-2xl border" onKeyDown={handleMonthMenuKeyDown}>
      <div className="mb-3 flex items-center justify-between rounded-xl bg-[#F8FAFD] p-1"><button type="button" className="grid size-8 place-items-center rounded-lg text-slate hover:bg-white hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label={previousYearLabel} onClick={() => setYear((current) => current - 1)}><ChevronLeft size={17} /></button><span className="text-sm font-semibold tabular-nums text-navy">{year}</span><button type="button" className="grid size-8 place-items-center rounded-lg text-slate hover:bg-white hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label={nextYearLabel} onClick={() => setYear((current) => current + 1)}><ChevronRight size={17} /></button></div>
      <div className="grid grid-cols-3 gap-1">{Array.from({ length: 12 }, (_, index) => index + 1).map((month) => { const next = `${year}-${String(month).padStart(2, "0")}`; const selected = next === value; return <button ref={(node) => { monthButtons.current[month - 1] = node; }} key={month} type="button" tabIndex={selected ? 0 : -1} aria-pressed={selected} className="ats-dropdown-option flex items-center justify-center gap-1 text-xs font-semibold text-navy" onClick={() => { onValueChange(next); close(); }}><span className={`ats-dropdown-checkbox ${selected ? "is-checked" : ""}`} aria-hidden="true" />{monthLabel(month)}</button>; })}</div>
    </div> : null}
  </div>;
}
