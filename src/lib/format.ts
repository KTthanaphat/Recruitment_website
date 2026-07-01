import type { Language, ResultValue } from "@/types/recruitment";

export function formatDate(value: string | null | undefined, language: Language = "en") {
  if (!value) return "-";
  const date = dateFromValue(value);
  if (!date) return value.slice(0, 10);
  return new Intl.DateTimeFormat(localeForLanguage(language), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

export function formatDateTime(value: string | null | undefined, language: Language = "en") {
  if (!value) return "-";
  const date = dateFromValue(value);
  if (!date) return value;
  return new Intl.DateTimeFormat(localeForLanguage(language), {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

export function formatNumber(value: number, language: Language = "en") {
  return new Intl.NumberFormat(localeForLanguage(language)).format(value);
}

function localeForLanguage(language: Language) {
  return language === "th" ? "th-TH" : "en-US";
}

function dateFromValue(value: string) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function resultText(result: ResultValue) {
  if (result === 1) return "Pass";
  if (result === 0) return "Fail";
  return "Pending";
}

export function statusTone(status: string): "primary" | "success" | "warning" | "danger" | "muted" | "teal" | "purple" {
  if (["filled", "pass", "accepted", "system_admin"].includes(status)) return "success";
  if (["cancel", "fail", "rejected", "Withdrawn"].includes(status)) return "danger";
  if (["viewer", "pending"].includes(status)) return "muted";
  if (["admin_recruiter", "site_recruiter", "ongoing"].includes(status)) return "primary";
  return "warning";
}

export function toTitle(value: string) {
  return value
    .replace(/[-_]/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1));
}

export function emptyToNull(value: FormDataEntryValue | null) {
  if (value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

export function boolFromForm(value: FormDataEntryValue | null) {
  return value === "on" || value === "1" || value === "true";
}
