import { expect, test } from "@playwright/test";
import { dailyWelcomeMessage, recruitmentDailyMessages } from "../../src/lib/daily-messages";
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
  await expect(tablist.getByRole("tab").nth(4)).toHaveAccessibleName("New Hire Confirmation");
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
  await expect(page.getByRole("tablist", { name: "Recruitment record categories" }).getByRole("tab", { name: "New Hire Confirmation" })).toHaveCount(0);
});

test("home calendar shows filtered unresolved estimates and opens candidate detail", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const scheduledPhoneScreen = mock.data.recruitment_logs.find((log) => log.candidate_id === "C-PHONE");
  if (!scheduledPhoneScreen) throw new Error("Expected the phone-screen calendar fixture.");
  mock.data.recruitment_logs.push({
    ...scheduledPhoneScreen,
    log_id: 999,
    recruitment_process: "HR Interview",
    stage_instance_id: "00000000-0000-4000-8000-000000000999",
    estimated_action_date: "2026-07-20"
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/home");
  await expectWorkspaceReady(page);

  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcomeDialog.isVisible()) await welcomeDialog.getByRole("button", { name: "Close" }).last().click();

  const workHeading = page.getByRole("heading", { name: "Today's Work" });
  const calendarHeading = page.getByRole("heading", { name: "Recruitment Calendar" });
  const recordsHeading = page.getByRole("heading", { name: "Recruitment Records" });
  const workPanel = workHeading.locator("xpath=ancestor::section[1]");
  const calendar = calendarHeading.locator("xpath=ancestor::section[1]");
  const workBox = await workPanel.boundingBox();
  const calendarBox = await calendar.boundingBox();
  const recordsBox = await recordsHeading.boundingBox();
  expect(workBox?.x ?? 0).toBeLessThan(calendarBox?.x ?? 0);
  expect(calendarBox?.width ?? 0).toBeGreaterThan((workBox?.width ?? 0) * 2.5);
  expect(Math.abs((workBox?.y ?? 0) - (calendarBox?.y ?? 0))).toBeLessThan(12);
  expect(Math.abs((workBox?.height ?? 0) - (calendarBox?.height ?? 0))).toBeLessThan(2);
  expect(calendarBox?.y ?? 0).toBeLessThan(recordsBox?.y ?? 0);

  await expect(calendar.getByText("July 2026", { exact: true })).toBeVisible();
  await expect(page.getByText("Last touch > 7 days", { exact: true })).toBeVisible();
  await expect(page.getByText("Groups needing updates", { exact: true })).toBeVisible();
  const patPhoneEvent = calendar.getByRole("button", { name: "Open Pat Phone, Stage event, 25/07/2026" });
  await expect(patPhoneEvent).toBeVisible();
  await expect(calendar.getByRole("button", { name: /Open Avery Aging.*Overdue/ })).toBeVisible();
  await expect(calendar.getByRole("button", { name: /Finn Failed/ })).toHaveCount(0);
  await patPhoneEvent.click();
  await expect(page.getByRole("dialog", { name: /C-PHONE/ })).toBeVisible();
  await page.getByRole("dialog", { name: /C-PHONE/ }).getByRole("button", { name: "Close" }).click();

  await calendar.getByRole("button", { name: "Show all 3 events on 20/07/2026" }).click();
  const dayEventsDialog = page.getByRole("dialog", { name: "Events for 20/07/2026" });
  await expect(dayEventsDialog).toBeVisible();
  await expect(dayEventsDialog.getByText("Avery Aging", { exact: true })).toBeVisible();
  await expect(dayEventsDialog.getByText("Olivia Offer Pass", { exact: true })).toBeVisible();
  await expect(dayEventsDialog.getByText("Pending details:", { exact: false }).first()).toBeVisible();
  await expect(dayEventsDialog.getByRole("button", { name: "Edit", exact: true })).toHaveCount(2);
  await dayEventsDialog.getByRole("button", { name: "Edit", exact: true }).first().click();
  const pendingDialog = page.getByRole("dialog", { name: "Edit Pending Details" });
  await expect(pendingDialog).toBeVisible();
  await pendingDialog.getByRole("button", { name: "Cancel" }).click();

  await calendar.getByRole("button", { name: "Next month" }).click();
  await expect(calendar.getByText("August 2026", { exact: true })).toBeVisible();
  await expect(calendar.getByRole("button", { name: /Open Hana HR/ })).toBeVisible();
  await calendar.getByRole("button", { name: "Today" }).click();
  await expect(calendar.getByText("July 2026", { exact: true })).toBeVisible();

  const siteFilter = page.locator("[data-app-header-actions]").getByLabel("Site", { exact: true });
  await siteFilter.click();
  await page.getByRole("listbox", { name: "Site" }).getByRole("option", { name: "KT2", exact: true }).click();
  await expect(calendar.getByText("No recruitment events in this month.")).toBeVisible();

  await page.setViewportSize({ width: 1024, height: 800 });
  const normalWorkBox = await workPanel.boundingBox();
  const normalCalendarBox = await calendar.boundingBox();
  expect(normalWorkBox?.x ?? 0).toBeLessThan(normalCalendarBox?.x ?? 0);
  expect(normalCalendarBox?.width ?? 0).toBeGreaterThan((normalWorkBox?.width ?? 0) * 2.5);

  await page.setViewportSize({ width: 360, height: 800 });
  await expect(calendar.locator('[data-recruitment-calendar="mobile"]')).toBeVisible();
  await expect(calendar.locator('[data-recruitment-calendar="desktop"]')).toBeHidden();
  const mobileWorkBox = await workPanel.boundingBox();
  const mobileCalendarBox = await calendar.boundingBox();
  expect(mobileWorkBox?.y ?? 0).toBeLessThan(mobileCalendarBox?.y ?? 0);
});

test("home calendar distinguishes due, confirmed, future, and no-show start-work events", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const baseOffer = mock.data.offers[1];
  mock.data.offers = [
    { ...baseOffer, offer_id: 21, candidate_id: "C-OFFER-PASS", first_working_date: "2026-07-20", start_confirmation: null },
    { ...baseOffer, offer_id: 22, candidate_id: "C-PHONE", first_working_date: "2026-07-21", start_confirmation: "started" },
    { ...baseOffer, offer_id: 23, candidate_id: "C-HR", first_working_date: "2026-07-25", start_confirmation: null },
    { ...baseOffer, offer_id: 24, candidate_id: "C-LINE", first_working_date: "2026-07-22", start_confirmation: "did_not_start" }
  ];
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const calendar = page.getByRole("heading", { name: "Recruitment Calendar" }).locator("xpath=ancestor::section[1]");
  const due = calendar.getByRole("button", { name: /Open Olivia Offer Pass.*Start confirmation pending/ });
  const confirmed = calendar.getByRole("button", { name: /Open Pat Phone.*Started work confirmed/ });
  const future = calendar.getByRole("button", { name: /Open Hana HR, Start working/ });
  await expect(due).toBeVisible();
  await expect(confirmed).toBeVisible();
  await expect(future).toBeVisible();
  await expect(calendar.getByRole("button", { name: /Liam Line.*Start working/ })).toHaveCount(0);
  await expect(due).toHaveClass(/bg-\[#FFF8F7\]/);
  await expect(confirmed).toHaveClass(/bg-\[#F2FBF5\]/);
  await due.click();
  const candidateDetail = page.getByRole("dialog", { name: /C-OFFER-PASS/ });
  await expect(candidateDetail.getByText("New hire confirmation due")).toHaveCount(1);
  await candidateDetail.getByRole("button", { name: "Confirm start" }).click();
  await expect(page.getByRole("dialog", { name: "New Hire Confirmation" })).toBeVisible();
  await page.getByRole("dialog", { name: "New Hire Confirmation" }).getByRole("button", { name: "Cancel" }).click();
  await page.setViewportSize({ width: 360, height: 800 });
  await calendar.locator('[data-recruitment-calendar="mobile"] button[aria-label^="21/07/2026"]').click();
  await expect(calendar.getByRole("button", { name: /Open Pat Phone.*Started work confirmed/ })).toBeVisible();
});

test("welcome popup uses monthly accepted vacancies with bilingual weekday messages", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter", language: "en" });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const weekday = await page.evaluate(() => new Date().getDay());
  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  await expect(welcomeDialog).toContainText(englishHighWorkloadMessages[weekday]);
  await expect(welcomeDialog).toContainText("Monthly filled vacancy ratio");
  await expect(welcomeDialog).toContainText("1/13 vacancies accepted this month");
  await expect(welcomeDialog).toContainText("7%");

  const thaiPage = await page.context().newPage();
  await installMockSupabase(thaiPage, { role: "admin_recruiter", language: "th" });
  await thaiPage.goto("/home");
  const thaiHeader = thaiPage.locator("[data-app-header-actions]");
  await expect(thaiHeader).toBeVisible();
  await expect(thaiHeader.getByRole("button", { name: "EN", exact: true })).toBeVisible();
  await expect(thaiPage.locator("[role='dialog']")).not.toContainText(englishHighWorkloadMessages[weekday]);
  await expect(thaiPage.locator("[role='dialog']")).toContainText("อัตราเติมตำแหน่งรายเดือน");
  await expect(thaiPage.locator("[role='dialog']")).toContainText("1/13 อัตราที่ตอบรับในเดือนนี้");
  await expect(thaiPage.locator("[role='dialog']")).toContainText("7%");
  await thaiPage.close();
});

test("welcome popup counts only valid accepted offers in the current Bangkok month", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const baseOffer = mock.data.offers[1];
  mock.data.offers.push(
    { ...baseOffer, offer_id: 3, candidate_id: "C-MONTH-START", doc_id: "REQ-HQ-1", accepted_date: "2026-07-01" },
    { ...baseOffer, offer_id: 4, candidate_id: "C-MONTH-TODAY", doc_id: "REQ-HQ-1", accepted_date: "2026-07-24" },
    { ...baseOffer, offer_id: 5, candidate_id: "C-PRIOR-MONTH", doc_id: "REQ-HQ-1", accepted_date: "2026-06-30" },
    { ...baseOffer, offer_id: 6, candidate_id: "C-FUTURE", doc_id: "REQ-HQ-1", accepted_date: "2026-07-25" },
    { ...baseOffer, offer_id: 7, candidate_id: "C-MISSING", doc_id: "REQ-HQ-1", accepted_date: null },
    { ...baseOffer, offer_id: 8, candidate_id: "C-MALFORMED", doc_id: "REQ-HQ-1", accepted_date: "2026-07-40" }
  );

  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  await expect(welcomeDialog).toContainText("3/13 vacancies accepted this month");
  await expect(welcomeDialog).toContainText("23%");
});

test("monthly fill rate keeps recruiter scope and existing CSV threshold bands", async ({ page }) => {
  await installMockSupabase(page, { role: "site_recruiter" });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  await expect(welcomeDialog).toContainText("1/3 vacancies accepted this month");
  await expect(welcomeDialog).toContainText("33%");

  const friday = new Date("2026-07-24T05:00:00.000Z");
  for (const ratio of [0, 0.33, 0.66]) {
    const expected = recruitmentDailyMessages
      .filter((row) => row.day === "Fri" && row.filledMin <= ratio)
      .sort((a, b) => b.filledMin - a.filledMin)[0].en.replace(/\{name\}/g, "Alice");
    expect(dailyWelcomeMessage({ language: "en", ratio, name: "Alice", date: friday, fallback: "fallback" })).toBe(expected);
  }
});

test("sourcing work board opens a selected-week applicant record", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  await expect(page.getByText("Weekly work", { exact: true })).toBeVisible();
  const firstGroup = page.locator("article").filter({ hasText: "GRP-ENG" }).first();
  await expect(firstGroup.getByText(/Needs recording|Recorded/, { exact: true })).toBeVisible();
  await firstGroup.getByRole("button", { name: /Record applicants|Edit record/ }).click();
  await expect(page.getByRole("dialog", { name: /Record|Edit applicants/ })).toBeVisible();
  await expect(page.getByPlaceholder("Not recorded").first()).toBeVisible();
  await page.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Lifecycle history" }).click();
  await expect(page.getByRole("button", { name: "Sort Week" })).toBeVisible();
  await page.getByRole("button", { name: "Advanced filters" }).click();
  await expect(page.getByLabel("Filter Group ID")).toBeVisible();
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
