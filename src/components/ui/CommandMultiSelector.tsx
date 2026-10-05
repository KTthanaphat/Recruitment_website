"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type CommandMultiOption = string | { value: string; label: string };

export function CommandMultiSelector({ label, allLabel, options, values, onChange, typography = "normal" }: { typography?: "normal" | "emphasized"; label: string; allLabel: string; options: CommandMultiOption[]; values: string[]; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false), [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const normalizedOptions = options.map((option) => typeof option === "string" ? { value: option, label: option } : option);
  const choices = [{ value: "", label: allLabel }, ...normalizedOptions];
  const summary = values.length ? normalizedOptions.filter((option) => values.includes(option.value)).map((option) => option.label).join(", ") : allLabel;
  const selectedIndex = Math.max(0, choices.findIndex((choice) => choice.value ? values.includes(choice.value) : values.length === 0));
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
    if (!open) { setOpen(true); setActive(event.key === "End" ? choices.length - 1 : event.key === "ArrowUp" && selectedIndex > 0 ? selectedIndex - 1 : selectedIndex); return; }
    if (event.key === "Home") setActive(0);
    else if (event.key === "End") setActive(choices.length - 1);
    else if (event.key === "ArrowDown") setActive(index => (index + 1) % choices.length);
    else if (event.key === "ArrowUp") setActive(index => (index - 1 + choices.length) % choices.length);
    else toggle(choices[active]?.value ?? "");
  }
  return <div ref={root} onKeyDown={key} className="relative min-w-0">
    <button ref={trigger} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-options`} aria-activedescendant={open ? `${id}-${active}` : undefined} onClick={() => { setActive(selectedIndex); setOpen(value => !value); }} className={`ats-dropdown-trigger flex min-h-11 w-full items-center gap-2 rounded-xl border px-3 text-left text-sm ${typography === "normal" ? "font-normal" : "font-semibold"} text-navy`}>
      <span className="min-w-0 flex-1 truncate" title={summary}>{summary}</span><ChevronDown size={17} className="shrink-0 text-slate" aria-hidden="true" />
    </button>
    {open ? <div id={`${id}-options`} role="listbox" tabIndex={-1} aria-activedescendant={`${id}-${active}`} aria-label={label} aria-multiselectable="true" className="ats-dropdown-menu absolute right-0 z-50 mt-2 grid max-h-72 w-full min-w-[12rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border focus:outline-none focus:ring-2 focus:ring-primary/20">
      {choices.map((choice, index) => {
        const selected = choice.value ? values.includes(choice.value) : values.length === 0;
        return <button id={`${id}-${index}`} key={choice.value || "all"} type="button" role="option" aria-selected={selected} tabIndex={-1} onMouseEnter={() => setActive(index)} onClick={() => { toggle(choice.value); document.getElementById(`${id}-options`)?.focus(); }} className={`ats-dropdown-option flex items-center gap-2 text-left text-sm ${typography === "normal" ? "font-normal" : "font-semibold"} text-navy ${selected ? "is-selected" : ""} ${active === index ? "is-active" : ""}`}><span className={`ats-dropdown-checkbox ${selected ? "is-checked" : ""}`} aria-hidden="true" /><span className="min-w-0 break-words">{choice.label}</span></button>;
      })}
    </div> : null}
  </div>;
}
