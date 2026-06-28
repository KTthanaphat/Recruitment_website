import type { ResultValue } from "@/types/recruitment";

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  return value.slice(0, 10);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
