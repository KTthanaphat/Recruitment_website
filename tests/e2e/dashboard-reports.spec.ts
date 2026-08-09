import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("dashboard report uses calendar views, persists its month, and keeps expandable sections", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/dashboard?reportView=pim&reportMonth=2026-07&details=open&funnel=open");
  await expectWorkspaceReady(page);

  await expect(page.getByRole("heading", { name: "Vacancy Waterfall" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Requisitions Active in Selected Period/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Recruitment Pipeline Health in Selected Range/ })).toBeVisible();
  await expect(page.getByText("Selected date range: 01/07/2026 - 31/07/2026")).toBeVisible();
  await expect(page.getByLabel("Metric view")).toHaveValue("pim");
  await expect(page.getByLabel("Report month")).toHaveValue("2026-07");
  await expect(page.getByRole("heading", { name: "Recruitment Pipeline Health" })).toBeVisible();

  await page.getByLabel("Report month").fill("2026-06");
  await expect(page).toHaveURL(/reportMonth=2026-06/);
  await expect(page.getByText("Selected date range: 01/06/2026 - 30/06/2026")).toBeVisible();

  await page.getByLabel("Metric view").selectOption("custom");
  await expect(page.getByLabel("Start Date").first()).toHaveValue("2026-06-01");
  await expect(page.getByLabel("End Date").first()).toHaveValue("2026-06-30");
  await page.getByLabel("Start Date").first().fill("2026-07-15");
  await page.getByLabel("End Date").first().fill("2026-07-10");
  await expect(page.getByText("Choose a start date on or before the end date.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export PDF" }).first()).toBeDisabled();
  await page.getByLabel("End Date").first().fill("2026-07-31");
  await expect(page).toHaveURL(/reportView=custom/);
  await expect(page).toHaveURL(/start=2026-07-15/);
  await expect(page).toHaveURL(/end=2026-07-31/);
});

test("dashboard active-period vacancy follows PR date and resolved close date", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const base = mock.data.requisitions[0];
  const added = (docId: string, position: string, status: "ongoing" | "filled" | "cancel", prDate: string | null, headCount: number) => ({
    ...base,
    doc_id: docId,
    position,
    status,
    pr_approved_date: prDate,
    head_count: headCount,
    created_at: "2026-05-01T00:00:00",
    updated_at: "2026-05-01T00:00:00"
  });
  mock.data.requisitions.push(
    added("REQ-CLOSED-BEFORE", "Closed Before Period", "filled", "2026-05-01", 2),
    added("REQ-CLOSED-IN", "Closed In Period", "filled", "2026-05-01", 3),
    added("REQ-ACCEPTED-FALLBACK", "Accepted Fallback", "filled", "2026-05-01", 4),
    added("REQ-NO-CLOSE-DATE", "No Close Date", "filled", "2026-05-01", 1),
    added("REQ-FUTURE-PR", "Future PR", "ongoing", "2026-07-01", 1),
    added("REQ-CANCELLED", "Cancelled", "cancel", "2026-05-01", 1),
    added("REQ-MISSING-PR", "Missing PR", "ongoing", null, 1)
  );
  mock.data.requisition_logs.push(
    { log_id: 1, doc_id: "REQ-CLOSED-BEFORE", log_date: "2026-05-31", status: "filled", remark: null, created_at: "2026-05-31T00:00:00" },
    { log_id: 2, doc_id: "REQ-CLOSED-IN", log_date: "2026-06-15", status: "filled", remark: null, created_at: "2026-06-15T00:00:00" }
  );
  mock.data.offers.push({
    ...mock.data.offers[1],
    offer_id: 3,
    candidate_id: "C-ACCEPTED-FALLBACK",
    doc_id: "REQ-ACCEPTED-FALLBACK",
    accepted_date: "2026-06-20"
  });

  await page.goto("/dashboard?reportView=pim&reportMonth=2026-06&details=open");
  await expectWorkspaceReady(page);

  await expect(page.getByText("Eligible vacancies", { exact: true })).toBeVisible();
  await expect(page.getByText("Closed In Period", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Accepted Fallback", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("No Close Date", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Closed Before Period", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Future PR", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Cancelled", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Missing PR", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Vacancy Waterfall" })).toBeVisible();
});

test("dashboard active-period labels localize and fit at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter", language: "th" });
  await page.goto("/dashboard?reportView=mtd&reportMonth=2026-06");
  await expect(page.locator("[data-app-header-actions]")).toBeVisible();
  await expect(page.getByText("อัตราที่เข้าเกณฑ์", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("home records use tabbed vertical panels while work queue keeps contained overflow", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/home");
  await expectWorkspaceReady(page);

  await page.getByRole("dialog", { name: "Welcome Back" }).getByRole("button", { name: "Close", exact: true }).last().click();
  const pipelineTab = page.getByRole("tab", { name: /Candidate Pipeline/ });
  await pipelineTab.click();
  await expect(pipelineTab).toHaveAttribute("aria-selected", "true");
  const tabPanel = page.getByRole("tabpanel");
  await expect(tabPanel).toBeVisible();
  await expect(tabPanel).toHaveCSS("overflow-y", "auto");
  await expect(tabPanel.getByText("Pat Phone")).toBeVisible();
  await expect(tabPanel.getByText("Tina Test")).toBeVisible();
  await expect(page.getByRole("button", { name: /Show all .* pipeline items/ })).toHaveCount(0);

  const workScroller = page.locator('[data-home-scroll-section="Today\'s Work"]');
  await expect(workScroller).toBeVisible();
  await expect(workScroller).toHaveCSS("overflow-x", "auto");
  await expect(page.getByRole("button", { name: /Show all .* data quality issues/ })).toHaveCount(0);
});
