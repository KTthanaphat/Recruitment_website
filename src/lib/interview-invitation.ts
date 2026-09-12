import type { Language, RejectionLetterLanguage } from "@/types/recruitment";

export const INTERVIEW_INVITATION_VARIABLES = [
  "{candidate_name}", "{candidate_email}", "{interview_stage}", "{position_group}", "{site}", "{pic_name}", "{recruiter_name}",
  "{bangkok_start}", "{bangkok_end}", "{duration_minutes}", "{organizer_mailbox}", "{teams_join_link}"
] as const;

export type InterviewInvitationVariables = Record<(typeof INTERVIEW_INVITATION_VARIABLES)[number], string>;

export function normalizeInterviewInvitationVariables(value: string) { return value.replace(/\$([a-z_]+)/g, "{$1}"); }

export function validateInterviewInvitationTemplate(value: string) {
  const invalid = new Set<string>(); const normalized = normalizeInterviewInvitationVariables(value);
  for (const token of normalized.match(/\{[a-z_]+\}/g) ?? []) if (!(INTERVIEW_INVITATION_VARIABLES as readonly string[]).includes(token)) invalid.add(token);
  if (/[{}]/.test(normalized.replace(/\{[a-z_]+\}/g, ""))) invalid.add("{}");
  return [...invalid];
}

export function resolveInterviewInvitationTemplate(value: string, variables: InterviewInvitationVariables) {
  return normalizeInterviewInvitationVariables(value).replace(/\{[a-z_]+\}/g, (token) => variables[token as keyof InterviewInvitationVariables] ?? token);
}

export function invitationLanguageForUi(language: Language): RejectionLetterLanguage { return language === "th" ? "th" : "en"; }
