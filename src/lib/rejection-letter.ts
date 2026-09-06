import type { Language, RejectionLetterLanguage } from "@/types/recruitment";

export const REJECTION_LETTER_VARIABLES = [
  "{candidate_name}", "{candidate_email}", "{failed_stage}", "{failed_outcome_date}",
  "{position_group}", "{site}", "{recruiter_name}", "{current_date}"
] as const;

export type RejectionLetterVariables = Record<(typeof REJECTION_LETTER_VARIABLES)[number], string>;

/** Converts the retired $variable syntax so existing saved templates remain usable. */
export function normalizeRejectionLetterVariables(value: string) {
  return value.replace(/\$([a-z_]+)/g, "{$1}");
}

export function validateLetterTemplate(value: string) {
  const invalid = new Set<string>();
  const normalized = normalizeRejectionLetterVariables(value);
  for (const token of normalized.match(/\{[a-z_]+\}/g) ?? []) if (!(REJECTION_LETTER_VARIABLES as readonly string[]).includes(token)) invalid.add(token);
  const stripped = normalized.replace(/\{[a-z_]+\}/g, "");
  if (/[{}]/.test(stripped)) invalid.add("{}");
  return [...invalid];
}

export function resolveLetterTemplate(value: string, variables: RejectionLetterVariables) {
  return normalizeRejectionLetterVariables(value).replace(/\{[a-z_]+\}/g, (token) => variables[token as keyof RejectionLetterVariables] ?? token);
}

export function letterLanguageForUi(language: Language): RejectionLetterLanguage { return language === "th" ? "th" : "en"; }

export function escapeLetterHtml(value: string) {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character)).replace(/\r?\n/g, "<br>");
}
