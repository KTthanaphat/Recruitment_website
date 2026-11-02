import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("empty bootstrap still displays linked counts and lazy requisition details with retry", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  let previewReads = 0, failPreview = true;
  await page.route("**/rest/v1/requisitions?**", async route => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("doc_id")) return route.fulfill({ status: 200, contentType: "application/json", headers: { "content-range": "0-0/0" }, body: "[]" });
    previewReads++;
    if (failPreview) return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Preview unavailable" }) });
    return route.fallback();
  });
  await page.goto("/workspace?lang=en");
  await expectWorkspaceReady(page);
  const group = page.getByRole("button", { name: /Engineer, GRP-ENG/ }).locator("xpath=ancestor::*[self::tr or self::article][1]");
  const ids = new Set(mock.data.document_groups.filter(row => row.group_id === "GRP-ENG").map(row => row.doc_id));
  const trigger = group.getByRole("button", { name: new RegExp(`Linked requisitions: ${ids.size} requisition`) });
  await expect(trigger).toBeVisible();
  expect(previewReads).toBe(0);
  await trigger.focus();
  const preview = page.getByTestId("workspace-requisition-preview");
  await expect(preview.getByRole("alert")).toBeVisible();
  failPreview = false;
  await preview.getByRole("button", { name: "Retry", exact: true }).click();
  for (const id of ids) await expect(preview).toContainText(id);
  await expect(preview.getByRole("button")).toHaveCount(ids.size);
});

test("workspace candidate cards load from their selected group without bootstrap people", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  mock.excludeBootstrapCandidate("C-PHONE");
  await page.goto("/workspace?lang=en&type=group&id=GRP-ENG&section=pipeline");
  await expectWorkspaceReady(page);
  const card = page.getByRole("button", { name: /^Pat Phone C-PHONE/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByRole("dialog")).toContainText("Pat Phone");
  const calls = mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "pipeline_stage");
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(call => (call.payload.p_filters as Record<string, unknown>).groupId === "GRP-ENG")).toBe(true);
});
