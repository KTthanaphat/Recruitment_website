"use client";

import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export function CommandMultiSelector({ label, allLabel, options, values, onChange }: { label: string; allLabel: string; options: string[]; values: string[]; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId(), choices = ["", ...options];
  const summary = values.length ? values.join(", ") : allLabel;
  useEffect(() => { if (open) { document.getElementById(`${id}-options`)?.focus(); document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: "nearest" }); } }, [active, open, id]);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  function toggle(value: string) { onChange(value === "" ? [] : values.includes(value) ? values.filter(item => item !== value) : [...values, value]); }
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Tab" && open) { trigger.current?.focus(); setOpen(false); return; }
    if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); return; }
    if (!["Enter", " ", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    if (!open) { setOpen(true); setActive(event.key === "End" ? choices.length - 1 : 0); return; }
    if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(choices.length - 1);
    else if (event.key === "ArrowDown") setActive(index => Math.min(choices.length - 1, index + 1));
    else if (event.key === "ArrowUp") setActive(index => Math.max(0, index - 1));
    else toggle(choices[active]);
  }
  return <div ref={root} onKeyDown={key} className="relative min-w-0">
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`} onClick={() => setOpen(value => !value)} className="flex min-h-11 w-full items-center gap-2 rounded-xl border border-[#B8CCE4] bg-white px-3 text-left text-sm text-navy focus:outline-none focus:ring-2 focus:ring-primary/20">
      <span className="min-w-0 flex-1 truncate" title={summary}>{summary}</span><ChevronDown size={17} className="shrink-0 text-slate" aria-hidden="true" />
    </button>
    {open ? <div id={`${id}-options`} role="listbox" tabIndex={-1} aria-activedescendant={`${id}-${active}`} aria-label={label} aria-multiselectable="true" className="absolute right-0 z-50 mt-2 grid max-h-72 w-full min-w-[12rem] gap-1 overflow-y-auto rounded-xl border border-[#C9D5E6] bg-white p-2 shadow-lg focus:outline-none focus:ring-2 focus:ring-primary/20">
      {choices.map((value, index) => {
        const selected = value ? values.includes(value) : values.length === 0;
        return <button id={`${id}-${index}`} key={value} type="button" role="option" aria-selected={selected} tabIndex={-1} onMouseEnter={() => setActive(index)} onClick={() => { toggle(value); document.getElementById(`${id}-options`)?.focus(); }} className={`flex min-h-11 items-center gap-2 rounded-lg px-2 text-left text-sm text-navy ${active === index ? "bg-[#E9F2FF]" : "hover:bg-[#F8FAFD]"}`}><span className="grid size-4 shrink-0 place-items-center rounded border border-[#8FA8C6]" aria-hidden="true">{selected ? <Check size={13} /> : null}</span><span className="break-words">{value || allLabel}</span></button>;
      })}
    </div> : null}
  </div>;
}
