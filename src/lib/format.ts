import { resultLabel } from "@/lib/i18n/dictionary";
import type { Language, ResultValue } from "@/types/recruitment";

type RequisitionTitleFields = { position?: string | null; level?: string | null };
type RequisitionOptionFields = RequisitionTitleFields & { doc_id: string };
type CandidateIdentityFields = { name?: string | null; nickname?: string | null };

export function formatRequisitionTitle(requisition: RequisitionTitleFields) {
  const storedPosition = requisition.position ?? "";
  const position = storedPosition.trim() ? storedPosition : "-";
  const rawLevel = requisition.level?.trim() ?? "";
  const levelMatch = rawLevel.match(/^L?(0|[1-9]|1[0-4])$/i);
  return levelMatch ? `${position} (L${levelMatch[1]})` : position;
}

/** Compact card title: retain the full value for tables and details, but protect mobile card height. */
export function formatRequisitionCardTitle(requisition: RequisitionTitleFields, maxLength = 30) {
  const position = requisition.position?.trim() || "-";
  if (position.length <= maxLength) return formatRequisitionTitle(requisition);
  const rawLevel = requisition.level?.trim() ?? "";
  const levelMatch = rawLevel.match(/^L?(0|[1-9]|1[0-4])$/i);
  return `${position.slice(0, maxLength).trimEnd()}...${levelMatch ? ` (L${levelMatch[1]})` : ""}`;
}

export function formatRequisitionOptionLabel(requisition: RequisitionOptionFields) {
  return `${formatRequisitionTitle(requisition)} — ${requisition.doc_id}`;
}

export function formatCandidateName(candidate: CandidateIdentityFields) {
  const name = candidate.name?.trim() ?? "";
  const nickname = candidate.nickname?.trim() ?? "";
  if (name && nickname) return `${name} (${nickname})`;
  return name || nickname || "-";
}

export function formatThaiMobilePhone(value: string | null | undefined) {
  if (!value) return "-";
  return /^0[0-9]{9}$/.test(value) ? `${value.slice(0, 3)}-${value.slice(3, 6)}-${value.slice(6)}` : value;
}

export function formatDate(value: string | null | undefined, language: Language = "en") {
  if (!value) return "-";
  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`;
  const date = dateFromValue(value);
  if (!date) return value.slice(0, 10);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

export function formatDateTime(value: string | null | undefined, language: Language = "en") {
  if (!value) return "-";
  const date = dateFromValue(value);
  if (!date) return value;
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  return `${formatDate(value, language)} ${time}`;
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

export function resultText(result: ResultValue, language: Language = "en") {
  return resultLabel(language, result);
}

export function statusTone(status: string | number): "primary" | "success" | "warning" | "danger" | "muted" | "teal" | "purple" {
  const value = String(status);
  if (["filled", "pass", "accepted", "system_admin", "1"].includes(value)) return "success";
  if (["cancel", "fail", "rejected", "Withdrawn", "0"].includes(value)) return "danger";
  if (["viewer", "pending"].includes(value)) return "muted";
  if (["admin_recruiter", "site_recruiter", "ongoing"].includes(value)) return "primary";
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
