import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("RecordModal requisition status selects a database row beyond bootstrap", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const template = mock.data.requisitions.find(row => row.status === "ongoing");
  if (!template) throw new Error("An ongoing requisition fixture is required.");
  const targetId = "REQ-STATUS-LATE-Z";
  for (let index = 0; index < 55; index += 1) {
    mock.data.requisitions.push({ ...template, doc_id: `REQ-STATUS-LATE-A${String(index).padStart(3, "0")}`, position: `Status lookup ${index}`, site: "KT1", person_in_charge: "Nina" });
  }
  mock.data.requisitions.push({ ...template, doc_id: targetId, position: "Cancelled target", status: "cancel", site: "KT1", person_in_charge: "Nina" });

  await page.goto("/requisitions");
  await expectWorkspaceReady(page);
  await page.locator("[data-table-toolbar]").getByRole("button", { name: "Status", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Requisition Status" });
  const search = dialog.getByRole("textbox", { name: "Search requisitions" });
  await search.fill("REQ-STATUS-LATE");
  await expect.poll(() => mock.rpcCalls.some(call => call.endpoint === "app_recruitment_list_count_v1" && call.payload.p_entity === "requisitions" && call.payload.p_search === "REQ-STATUS-LATE" && call.response === 56)).toBe(true);
  const firstPage = mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "requisitions" && call.payload.p_search === "REQ-STATUS-LATE").at(-1);
  expect((firstPage?.response as { items?: Array<{ doc_id: string }> } | undefined)?.items?.some(row => row.doc_id === targetId)).toBe(false);
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect.poll(() => (mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "requisitions" && call.payload.p_search === "REQ-STATUS-LATE").at(-1)?.response as { items?: Array<{ doc_id: string }> } | undefined)?.items?.some(row => row.doc_id === targetId)).toBe(true);
  const picker = dialog.getByRole("button", { name: "Doc ID", exact: true });
  await picker.click();
  await page.getByRole("option", { name: new RegExp(targetId) }).click();
  await expect(picker).toContainText(targetId);
  await expect(dialog.locator('select[name="status"]')).toHaveValue("cancel");
  await dialog.getByRole("button", { name: "Review changes", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Confirm Save" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "Save changes", exact: true }).click();
  expect(mock.rpcCalls.findLast(call => call.endpoint === "app_insert_requisition_log")?.payload).toMatchObject({ doc_id: targetId });
});

test("new group links a searched eligible requisition and keeps subsequent choices on its site", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const template = mock.data.requisitions.find(row => row.status === "ongoing");
  if (!template) throw new Error("An ongoing requisition fixture is required.");
  const targetId = "REQ-GROUP-LATE-Z";
  for (let index = 0; index < 55; index += 1) {
    mock.data.requisitions.push({ ...template, doc_id: `REQ-GROUP-LATE-A${String(index).padStart(3, "0")}`, position: `Group lookup ${index}`, site: "KT1", person_in_charge: "Nina" });
  }
  mock.data.requisitions.push({ ...template, doc_id: targetId, position: "Target group requisition", site: "KT1", person_in_charge: "Nina" });
  mock.data.requisitions.push({ ...template, doc_id: "REQ-GROUP-KT10", position: "Other site role", site: "KT10", person_in_charge: "Nina" });

  await page.goto("/workspace");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: "New", exact: true }).click();
  await page.getByRole("menuitem", { name: "New Group", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create Group" });
  const search = dialog.getByRole("textbox", { name: "Search requisitions" });
  await search.fill("REQ-GROUP-LATE");
  await expect.poll(() => mock.rpcCalls.some(call => call.endpoint === "app_recruitment_list_count_v1" && call.payload.p_entity === "requisitions" && call.payload.p_search === "REQ-GROUP-LATE" && call.response === 56)).toBe(true);
  const firstPage = mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "requisitions" && call.payload.p_search === "REQ-GROUP-LATE").at(-1);
  expect((firstPage?.response as { items?: Array<{ doc_id: string }> } | undefined)?.items?.some(row => row.doc_id === targetId)).toBe(false);
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect.poll(() => mock.rpcCalls.some(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "requisitions" && call.payload.p_search === "REQ-GROUP-LATE" && (call.payload.p_filters as { unmatchedOnly?: boolean }).unmatchedOnly === true && (call.response as { items?: Array<{ doc_id: string }> } | undefined)?.items?.some(row => row.doc_id === targetId))).toBe(true);
  const picker = dialog.getByRole("button", { name: "Doc ID", exact: true });
  await picker.click();
  await page.getByRole("option", { name: new RegExp(targetId) }).click();
  await dialog.getByRole("button", { name: "Add requisition", exact: true }).click();
  await expect(dialog.locator('input[name="doc_ids"]')).toHaveValue(targetId);
  await search.fill("REQ-GROUP-KT10");
  await expect.poll(() => mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_count_v1" && call.payload.p_entity === "requisitions" && call.payload.p_search === "REQ-GROUP-KT10").at(-1)?.response).toBe(0);
  const filtered = mock.rpcCalls.filter(call => call.endpoint === "app_recruitment_list_v1" && call.payload.p_entity === "requisitions" && call.payload.p_search === "REQ-GROUP-KT10").at(-1);
  expect((filtered?.payload.p_filters as { headerSite?: string } | undefined)?.headerSite).toBe("KT1");
  await picker.click();
  await expect(page.getByRole("option", { name: /REQ-GROUP-KT10/ })).toHaveCount(0);
});
