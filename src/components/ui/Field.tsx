import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Children, isValidElement, useEffect, useId, useRef, useState, type ChangeEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { CommandSelector, type CommandOption } from "@/components/ui/CommandSelector";

export function Field({
  label,
  children,
  className = ""
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid gap-1.5 text-sm font-medium text-navy ${className}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

const fieldClass =
  "min-h-10 w-full rounded-md border border-[#D7DEE8] bg-white px-3 py-2 text-sm font-normal text-navy shadow-none transition placeholder:text-cool hover:border-[#C9D5E6] focus:border-primary focus:bg-[#FBFDFF]";

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={fieldClass} {...props} />;
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={fieldClass} {...props} />;
}

/** Shared command-selector field that keeps the existing FormData shape. */
export function CreateSelectInput({ children, defaultValue, disabled, name, onChange, value, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const controlledValue = value === undefined ? undefined : String(value);
  const [internalValue, setInternalValue] = useState(controlledValue ?? String(defaultValue ?? ""));
  useEffect(() => { if (controlledValue !== undefined) setInternalValue(controlledValue); }, [controlledValue]);
  const options: CommandOption[] = Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode; disabled?: boolean }>(child)) return [];
    const optionValue = child.props.value ?? "";
    const optionLabel = typeof child.props.children === "string" || typeof child.props.children === "number" ? String(child.props.children) : optionValue;
    return [{ value: optionValue, label: optionLabel, disabled: child.props.disabled }];
  });
  const selectorValue = controlledValue ?? internalValue;
  return <CommandSelector
    ariaLabel={String(props["aria-label"] ?? name ?? "Select option")}
    disabled={disabled}
    emptyLabel={options.find((option) => option.value === "")?.label ?? "Select option"}
    name={name}
    onValueChange={(nextValue) => {
      if (controlledValue === undefined) setInternalValue(nextValue);
      onChange?.({ target: { value: nextValue, name }, currentTarget: { value: nextValue, name } } as unknown as ChangeEvent<HTMLSelectElement>);
    }}
    options={options}
    value={selectorValue}
  />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} min-h-24 resize-y`} {...props} />;
}

const monthLabels = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  th: ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"]
};
const weekdayLabels = { en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"], th: ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"] };

export function DayDateSelector({
  ariaLabel,
  clearLabel = "Clear",
  defaultValue = "",
  disabled = false,
  language = "en",
  name,
  nextMonthLabel = "Next month",
  onChange,
  previousMonthLabel = "Previous month",
  required = false,
  value
}: {
  ariaLabel: string;
  clearLabel?: string;
  defaultValue?: string;
  disabled?: boolean;
  language?: "en" | "th";
  name: string;
  nextMonthLabel?: string;
  onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
  previousMonthLabel?: string;
  required?: boolean;
  value?: string;
}) {
  const controlledValue = value === undefined ? undefined : normalizeIsoDate(value);
  const [internalValue, setInternalValue] = useState(normalizeIsoDate(defaultValue));
  const selectedValue = controlledValue ?? internalValue;
  const selectedDate = dateFromIso(selectedValue);
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDate ?? todayDate());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const id = useId();

  useEffect(() => {
    const next = controlledValue ?? normalizeIsoDate(defaultValue);
    if (controlledValue === undefined) setInternalValue(next);
    setVisibleMonth(dateFromIso(next) ?? todayDate());
  }, [controlledValue, defaultValue]);
  useEffect(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  function close() { setOpen(false); triggerRef.current?.focus(); }
  function select(nextValue: string) {
    if (controlledValue === undefined) setInternalValue(nextValue);
    onChange?.({ target: { value: nextValue, name }, currentTarget: { value: nextValue, name } } as ChangeEvent<HTMLInputElement>);
    close();
  }
  function clearSelection() {
    if (controlledValue === undefined) setInternalValue("");
    onChange?.({ target: { value: "", name }, currentTarget: { value: "", name } } as ChangeEvent<HTMLInputElement>);
    close();
  }
  function shiftMonth(delta: number) {
    setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const dayCells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1);
  const todayValue = isoFromDate(todayDate());

  return <div ref={rootRef} className="relative">
    <input type="hidden" name={name} value={selectedValue} required={required} />
    <button
      ref={triggerRef}
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={`${id}-calendar`}
      onClick={() => { if (!open) setVisibleMonth(selectedDate ?? todayDate()); setOpen((current) => !current); }}
      onKeyDown={(event) => { if (event.key === "Escape") close(); if (["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); setVisibleMonth(selectedDate ?? todayDate()); setOpen(true); } }}
      className="flex min-h-10 w-full items-center gap-2 rounded-md border border-[#D7DEE8] bg-white px-3 py-2 text-left text-sm font-normal tabular-nums text-navy transition hover:border-[#C9D5E6] hover:bg-[#FBFDFF] focus:border-primary focus:bg-[#FBFDFF] focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:cursor-not-allowed disabled:bg-[#F1F5F9] disabled:text-slate"
    >
      <CalendarDays size={16} className="shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1">{selectedValue ? displayDate(selectedValue) : ariaLabel}</span>
    </button>
    {open ? <div id={`${id}-calendar`} role="dialog" aria-label={ariaLabel} className="absolute z-50 mt-2 w-[19rem] rounded-xl border border-[#C9D5E6] bg-white p-3 shadow-[0_18px_40px_rgba(11,19,43,0.18)] max-md:fixed max-md:inset-x-2 max-md:bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] max-md:mt-0 max-md:w-auto">
      <div className="mb-3 flex items-center justify-between rounded-lg bg-[#F8FAFD] p-1">
        <button type="button" className="grid size-8 place-items-center rounded-md text-slate hover:bg-white hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label={previousMonthLabel} onClick={() => shiftMonth(-1)}><ChevronLeft size={17} /></button>
        <span className="text-sm font-semibold tabular-nums text-navy">{monthLabels[language][month]} {year}</span>
        <button type="button" className="grid size-8 place-items-center rounded-md text-slate hover:bg-white hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/20" aria-label={nextMonthLabel} onClick={() => shiftMonth(1)}><ChevronRight size={17} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate">{weekdayLabels[language].map((label) => <span key={label} className="grid min-h-7 place-items-center">{label}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">{dayCells.map((day, index) => {
        if (!day) return <span key={`blank-${index}`} aria-hidden="true" />;
        const dayValue = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const selected = dayValue === selectedValue;
        const isToday = dayValue === todayValue;
        return <button key={dayValue} type="button" aria-label={displayDate(dayValue)} aria-pressed={selected} onClick={() => select(dayValue)} className={`grid min-h-9 place-items-center rounded-md border text-sm font-semibold tabular-nums transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${selected ? "border-primary bg-primary text-white shadow-sm" : isToday ? "border-primary/40 bg-[#F1F7FF] text-primary hover:bg-white" : "border-transparent text-navy hover:border-[#C9D5E6] hover:bg-[#F8FAFD]"}`}>{day}</button>;
      })}</div>
      {!required && selectedValue ? <div className="mt-3 flex justify-end border-t border-[#E4E9F2] pt-2"><button type="button" className="min-h-9 rounded-md px-3 text-sm font-semibold text-slate hover:bg-[#F8FAFD] hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/30" onClick={clearSelection}>{clearLabel}</button></div> : null}
    </div> : null}
  </div>;
}

function normalizeIsoDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

function dateFromIso(value: string) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

function todayDate() {
  const parts = new Intl.DateTimeFormat("en-US", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Bangkok" }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return new Date(Number(value("year")), Number(value("month")) - 1, Number(value("day")));
}

function isoFromDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function displayDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
