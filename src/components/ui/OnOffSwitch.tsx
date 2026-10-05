"use client";

import type { Language } from "@/types/recruitment";

/** Controlled state: callers own draft updates or immediate persistence. */
export function OnOffSwitch({ checked, onCheckedChange, label, language, disabled = false, title }: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  language: Language;
  disabled?: boolean;
  title?: string;
}) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label}
    title={title} disabled={disabled} className="ats-square-switch"
    onClick={() => onCheckedChange(!checked)}>
    <span className="ats-square-switch-label" aria-hidden="true">{checked ? (language === "th" ? "เปิด" : "ON") : (language === "th" ? "ปิด" : "OFF")}</span>
    <span className="ats-square-switch-thumb" aria-hidden="true" />
  </button>;
}
