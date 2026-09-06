import { expect, test } from "@playwright/test";
import { normalizeRejectionLetterVariables, resolveLetterTemplate, validateLetterTemplate } from "../../src/lib/rejection-letter";

test("rejection letter formats use brace variables and still resolve legacy formats", () => {
  const variables = { "{candidate_name}": "Avery", "{candidate_email}": "avery@example.com", "{failed_stage}": "Phone Screen", "{failed_outcome_date}": "6 Sep 2026", "{position_group}": "Analyst", "{site}": "HQ", "{recruiter_name}": "Alice", "{current_date}": "6 Sep 2026" };
  expect(normalizeRejectionLetterVariables("Dear $candidate_name")).toBe("Dear {candidate_name}");
  expect(resolveLetterTemplate("Dear {candidate_name}", variables)).toBe("Dear Avery");
  expect(resolveLetterTemplate("Dear $candidate_name", variables)).toBe("Dear Avery");
  expect(validateLetterTemplate("Dear {candidate_name}")).toEqual([]);
  expect(validateLetterTemplate("Dear {unknown_variable}")).toEqual(["{unknown_variable}"]);
});
