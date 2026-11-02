import { expect, test } from "@playwright/test";
import { enrichCandidates, enrichRequisitions } from "../../src/lib/data";
import { buildLegacyWelcomeSummary } from "./support/legacy-welcome-summary";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

const banner = (page: import("@playwright/test").Page) => page.locator("[data-home-banner]");

test("Welcome summary matches the complete model beyond the bootstrap window", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter", now: new Date("2026-07-24T05:00:00.000Z") });
  const seed = mock.data.requisitions.find(row => row.status !== "filled" && row.status !== "cancel");
  const seedOffer = mock.data.offers[0];
  if (!seed || !seedOffer) throw new Error("Expected requisition and offer fixtures");
  const insertedIds: string[] = [];
  for (let index = 0; index < 1_001; index += 1) {
    const docId = `REQ-WELCOME-${String(index).padStart(4, "0")}`;
    insertedIds.push(docId);
    mock.data.requisitions.push({
      ...seed,
      doc_id: docId,
      position: `Welcome summary fixture ${index}`,
      site: "HQ",
      person_in_charge: "Alice",
      status: "ongoing",
      head_count: 1,
      pr_approved_date: index === 0 ? "2026-07-01" : "2026-06-01",
      is_priority: false
    });
  }
  mock.data.offers.push({ ...seedOffer, offer_id: "WELCOME-SUMMARY-OFFER", doc_id: insertedIds[0], accepted_date: "2026-07-12", first_working_date: "2026-08-01", start_confirmation: "scheduled" });

  await page.goto("/home?lang=en");
  await expectWorkspaceReady(page);
  const dialog = page.getByRole("dialog", { name: "Welcome back" });
  const call = () => mock.rpcCalls.find(row => row.endpoint === "app_home_welcome_summary_v1");
  await expect.poll(() => call()?.response).not.toBeUndefined();

  const expected = buildLegacyWelcomeSummary(
    enrichRequisitions(mock.data), enrichCandidates(mock.data), mock.data.offers,
    mock.data.requisition_logs, mock.data.profile, "2026-07-24"
  );
  expect(call()?.response).toEqual(expected);
  expect(expected.openRequisitions).toBeGreaterThan(1_000);
  expect(expected.filledThisMonth).toBeGreaterThan(0);
  expect(expected.responsibleVacancyTotal).toBeGreaterThan(0);
  await expect(dialog.getByText(expected.openRequisitions.toLocaleString("en-US"), { exact: true })).toBeVisible();
  expect(mock.restReads.some(read => ["requisitions", "candidates", "offers", "recruitment_logs"].includes(read.table))).toBe(false);
});

test("Welcome summary shows loading instead of zero metrics while the RPC is delayed", async ({ page }) => {
  const delayed = await installMockSupabase(page, { role: "admin_recruiter", welcomeSummaryDelayMs: 500 });
  await page.goto("/home?lang=en");
  await expectWorkspaceReady(page);
  const dialog = page.getByRole("dialog", { name: "Welcome back" });
  await expect(dialog.getByRole("status")).toBeVisible();
  await expect(dialog.getByText("0", { exact: true })).toHaveCount(0);
  await expect.poll(() => delayed.rpcCalls.find(row => row.endpoint === "app_home_welcome_summary_v1")?.response).not.toBeUndefined();
  await expect(dialog.getByRole("status")).toHaveCount(0);
});

test("Welcome summary retries a failed RPC without rendering zero metrics", async ({ page }) => {
  const retry = await installMockSupabase(page, { role: "admin_recruiter", welcomeSummaryFailureOnce: true });
  await page.goto("/home?lang=en");
  await expectWorkspaceReady(page);
  const retryDialog = page.getByRole("dialog", { name: "Welcome back" });
  await expect(retryDialog.getByRole("alert")).toBeVisible();
  await expect(retryDialog.getByText("0", { exact: true })).toHaveCount(0);
  await retryDialog.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => retry.rpcCalls.filter(row => row.endpoint === "app_home_welcome_summary_v1" && row.response).length).toBe(1);
  await expect(retryDialog.getByRole("alert")).toHaveCount(0);
});

test("Home banner uses the returned header scope and retries a failed aggregate", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter", homeBannerSummaryFailureOnce: true });
  await page.goto("/home?lang=en");
  await expectWorkspaceReady(page);
  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcomeDialog.isVisible()) await welcomeDialog.getByRole("button", { name: "Close" }).last().click();
  const homeBanner = banner(page);
  await expect(homeBanner.getByRole("alert")).toBeVisible();
  await expect(homeBanner.getByRole("button", { name: "Retry" })).toBeVisible();
  await homeBanner.getByRole("button", { name: "Retry" }).click();
  await expect.poll(() => mock.rpcCalls.filter(row => row.endpoint === "app_home_banner_summary_v1" && row.response).length).toBe(1);
  await expect(homeBanner.getByRole("alert")).toHaveCount(0);

  const header = page.locator("[data-app-header-actions]");
  await header.getByRole("button", { name: "Site", exact: true }).click();
  await header.getByRole("listbox", { name: "Site", exact: true }).getByRole("option", { name: "KT1", exact: true }).click();
  await expect.poll(() => mock.rpcCalls.some(row => row.endpoint === "app_home_banner_summary_v1" && (row.payload.p_scope as Record<string, unknown>)?.headerSite === "KT1" && row.response)).toBe(true);

  const latest = mock.rpcCalls.filter(row => row.endpoint === "app_home_banner_summary_v1").at(-1)!;
  const response = latest.response as { monthlyFillCapacity: number; monthlyFilledCount: number };
  const scopedReqs = enrichRequisitions(mock.data).filter(row => row.site === "KT1");
  const reqs = scopedReqs.filter(row => row.status !== "cancel");
  const docIds = new Set(scopedReqs.map(row => row.doc_id));
  const expected = {
    monthlyFillCapacity: reqs.reduce((sum, row) => sum + row.head_count, 0),
    monthlyFilledCount: mock.data.offers.filter(offer => docIds.has(offer.doc_id) && offer.accepted_date?.startsWith("2026-07")).length
  };
  expect(latest.payload.p_scope).toEqual({ headerSite: "KT1", headerPic: "", priorityOnly: false });
  expect(response).toEqual(expected);
  await expect(homeBanner.getByRole("status")).toHaveCount(0);
});
