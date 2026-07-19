import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

const englishHighWorkloadMessages = [
  "Happy Sunday! There is still quite a lot of work coming in during the holiday.",
  "Happy Monday, Khun Alice!",
  "Happy Tuesday! The workload is still fairly high",
  "Happy Wednesday! We’ve reached the middle of the week.",
  "Happy Thursday! The weekend is getting closer",
  "Happy Friday! There are still many positions left as we wrap up the week.",
  "Happy Saturday! To everyone working today and handling a high number of positions"
];

test("home shows role-aware prioritized work queue", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/home");
  await expectWorkspaceReady(page);

  const header = page.locator("[data-app-header-actions]");
  await expect(header.getByLabel("Site", { exact: true })).toBeVisible();
  await expect(header.getByLabel("Person in Charge", { exact: true })).toBeVisible();
  await expect(header.getByText("Site", { exact: true })).toHaveCount(0);
  await expect(header.getByText("Person in Charge", { exact: true })).toHaveCount(0);
  await expect(header.getByRole("button", { name: "Clear" })).toHaveCount(0);
  await expect(page.getByText("Work Queue", { exact: true })).toHaveCount(0);

  const siteBox = await header.getByLabel("Site", { exact: true }).boundingBox();
  const ownerBox = await header.getByLabel("Person in Charge", { exact: true }).boundingBox();
  const languageBox = await header.getByRole("button", { name: "TH" }).boundingBox();
  const refreshBox = await header.getByRole("button", { name: "Refresh" }).boundingBox();
  await expect(header.getByLabel("Site", { exact: true })).toHaveCSS("background-color", "rgb(232, 240, 255)");
  await expect(header.getByLabel("Person in Charge", { exact: true })).toHaveCSS("background-color", "rgb(232, 240, 255)");
  expect(siteBox?.x ?? 0).toBeLessThan(ownerBox?.x ?? 0);
  expect(ownerBox?.x ?? 0).toBeLessThan(languageBox?.x ?? 0);
  expect(languageBox?.x ?? 0).toBeLessThan(refreshBox?.x ?? 0);

  await expect(page.getByText("Today's Work")).toBeVisible();
  await expect(page.getByText("Urgent items")).toBeVisible();
  await expect(page.getByText("Aging candidates")).toBeVisible();
  await expect(page.getByRole("button", { name: /Avery Aging/ }).first()).toBeVisible();
});

test("home groups recruitment records into ordered role-aware tabs", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/home");
  await expectWorkspaceReady(page);

  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcomeDialog.isVisible()) await welcomeDialog.getByRole("button", { name: "Close" }).last().click();

  const tablist = page.getByRole("tablist", { name: "Recruitment record categories" });
  await expect(tablist.getByRole("tab")).toHaveCount(5);
  await expect(tablist.getByRole("tab").nth(0)).toHaveAccessibleName("Open Headcount");
  await expect(tablist.getByRole("tab").nth(1)).toHaveAccessibleName("Candidate Pipeline");
  await expect(tablist.getByRole("tab").nth(2)).toHaveAccessibleName("Sourcing Updates");
  await expect(tablist.getByRole("tab").nth(3)).toHaveAccessibleName("Data Quality");
  await expect(tablist.getByRole("tab").nth(4)).toHaveAccessibleName("Recent Activity");
  await expect(tablist.getByRole("tab", { name: "Open Headcount" })).toHaveAttribute("aria-selected", "true");

  const panel = page.getByRole("tabpanel");
  await expect(panel).toHaveCSS("overflow-y", "auto");
  expect(await panel.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter((value) => value.endsWith("px")).length)).toBeGreaterThan(1);

  await tablist.getByRole("tab", { name: "Candidate Pipeline" }).click();
  await expect(panel).toContainText("Pat Phone");
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(() => panel.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").filter((value) => value.endsWith("px")).length)).toBe(1);

  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("tablist", { name: "Recruitment record categories" }).getByRole("tab", { name: "Recent Activity" })).toHaveCount(0);
});

test("welcome popup uses bilingual daily CSV messages by weekday and filled ratio", async ({ page }) => {
  const weekday = new Date().getDay();

  await installMockSupabase(page, { role: "admin_recruiter", language: "en" });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  await expect(page.locator("[role='dialog']")).toContainText(englishHighWorkloadMessages[weekday]);

  const thaiPage = await page.context().newPage();
  await installMockSupabase(thaiPage, { role: "admin_recruiter", language: "th" });
  await thaiPage.goto("/home");
  const thaiHeader = thaiPage.locator("[data-app-header-actions]");
  await expect(thaiHeader).toBeVisible();
  await expect(thaiHeader.getByRole("button", { name: "EN", exact: true })).toBeVisible();
  await expect(thaiPage.locator("[role='dialog']")).not.toContainText(englishHighWorkloadMessages[weekday]);
  await expect(thaiPage.locator("[role='dialog']")).toContainText("8%");
  await thaiPage.close();
});

test("sourcing shows weekly health and can copy previous week", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const firstGroup = page.locator("form").filter({ hasText: "GRP-ENG" }).first();
  await expect(firstGroup.getByText("Previous week", { exact: true })).toBeVisible();
  await expect(firstGroup.getByText("Trend", { exact: true })).toBeVisible();
  await firstGroup.getByRole("button", { name: "More actions for sourcing group GRP-ENG" }).click();
  await firstGroup.getByRole("menuitem", { name: "Copy Previous Week" }).click();
  await expect(firstGroup.getByLabel("Applicants").first()).toHaveValue("8");
});

test("offers show status, requisition impact, and quick links", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/offers");
  await expectWorkspaceReady(page);

  await expect(page.getByText("Offer Status")).toBeVisible();
  await expect(page.getByRole("cell", { name: "0/2 accepted - 2 open", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "View offer candidate detail for Owen Offer" }).click();
  await expect(page.getByRole("dialog", { name: /C-OFFER/ })).toBeVisible();
});

test("audit filters records and shows readable field diff", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/audit");
  await expectWorkspaceReady(page);

  await page.getByLabel("Entity", { exact: true }).fill("recruitment_logs");
  await expect(page.getByText("Recruitment Logs - 16")).toBeVisible();
  await page.getByText("Field changes").click();
  await expect(page.getByText("candidate_id")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open candidate" })).toBeVisible();
});
