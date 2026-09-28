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

test("home keeps role-aware metrics without the critical work list", async ({ page }) => {
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
  await expect(header.getByLabel("Site", { exact: true })).toHaveCSS("background-color", "rgb(248, 250, 253)");
  await expect(header.getByLabel("Person in Charge", { exact: true })).toHaveCSS("background-color", "rgb(248, 250, 253)");
  expect(siteBox?.x ?? 0).toBeLessThan(ownerBox?.x ?? 0);
  expect(ownerBox?.x ?? 0).toBeLessThan(languageBox?.x ?? 0);
  expect(languageBox?.x ?? 0).toBeLessThan(refreshBox?.x ?? 0);

  await expect(page.getByText("Today's Work")).toBeVisible();
  await expect(page.getByText("Urgent items").last()).toBeVisible();
  await expect(page.getByText("Aging candidates").last()).toBeVisible();
  const workPanel = page.getByRole("heading", { name: "Today's Work" }).locator("xpath=ancestor::section[1]");
  expect(await workPanel.locator("p.tabular-nums").evaluateAll((values) => values.every((value) => value.classList.contains("text-navy")))).toBe(true);
  await expect(workPanel.locator("[data-home-divider], [data-home-scroll-section]")).toHaveCount(0);
  await expect(workPanel.getByText("Urgent items").last()).toBeVisible();
});

test("home groups recruitment records into ordered role-aware tabs", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/home");
  await expectWorkspaceReady(page);

  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcomeDialog.isVisible()) await welcomeDialog.getByRole("button", { name: "Close" }).last().click();

  const tablist = page.getByRole("tablist", { name: "Recruitment record categories" });
  await expect(tablist.getByRole("tab")).toHaveCount(5);
  await expect(tablist.getByRole("tab").nth(0)).toHaveAccessibleName(/Open [Hh]eadcount/);
  await expect(tablist.getByRole("tab").nth(1)).toHaveAccessibleName("Candidate Pipeline");
  await expect(tablist.getByRole("tab").nth(2)).toHaveAccessibleName("Sourcing Updates");
  await expect(tablist.getByRole("tab").nth(3)).toHaveAccessibleName("Data Quality");
  await expect(tablist.getByRole("tab").nth(4)).toHaveAccessibleName("New Hire Confirmation");
  await expect(tablist.getByRole("tab", { name: "Open Headcount" })).toHaveAttribute("aria-selected", "true");

  const panel = page.getByRole("tabpanel");
  const recordList = panel.locator("[data-home-record-list]");
  await expect(recordList).toHaveCSS("overflow-y", "auto");
  const headcountSort = panel.getByLabel("Sort open headcount");
  await expect(headcountSort).toHaveValue("oldest");
  await expect(headcountSort.locator("option")).toHaveCount(3);
  await expect(headcountSort.locator("option").nth(0)).toHaveText("Oldest first");
  await expect(headcountSort.locator("option").nth(1)).toHaveText("Most open demand");
  await expect(headcountSort.locator("option").nth(2)).toHaveText("Position A–Z");
  await expect(panel.getByRole("link", { name: "View all requisitions" })).toHaveCount(0);
  await expect(panel.locator("[data-open-requisition-count]")).toHaveText(/\d+ open requisitions?/);
  await expect(panel.locator("[data-home-record-header]")).toContainText("Remaining Vac.");
  await expect(panel.locator("[data-home-record-header]")).toContainText("Age/SLA");
  await expect(panel.getByRole("button", { name: /View detail: REQ-/ })).toHaveCount(0);
  await expect(panel.locator("[data-home-requisition-row]").first().getByRole("button", { name: /Open requisition:/ })).toBeVisible();
  await expect(panel.locator("[data-home-requisition-row]").first()).toContainText("REQ-HQ-1");
  await expect(panel.locator("[data-home-requisition-row]").first()).toContainText(/\d+d\/30d/);
  await expect(panel.locator("[data-home-requisition-row]").first()).toContainText(/\d+d overdue/);
  await headcountSort.selectOption("position");
  await expect(panel.locator("[data-home-requisition-row]").first()).toContainText("REQ-KT2-1");
  await headcountSort.selectOption("oldest");
  await expect(panel.locator("[data-home-requisition-row]").first()).toContainText("REQ-HQ-1");
  const requisitionLink = panel.locator("[data-home-requisition-row]").first().getByRole("button", { name: /Open requisition:/ });
  await requisitionLink.focus();
  await expect(requisitionLink).toBeFocused();
  await requisitionLink.click();
  const requisitionDetail = page.getByRole("dialog", { name: /Engineer/ });
  await expect(requisitionDetail).toContainText("REQ-HQ-1");
  await requisitionDetail.getByRole("button", { name: "Close" }).click();

  await tablist.getByRole("tab", { name: "Candidate Pipeline" }).click();
  await expect(panel).toContainText("Pat Phone");
  const openPhone = panel.getByRole("button", { name: "Open candidate: Pat Phone" });
  await expect(openPhone).toBeVisible();
  await openPhone.click();
  const phoneDetail = page.getByRole("dialog", { name: /C-PHONE/ });
  await expect(phoneDetail).toBeVisible();
  await phoneDetail.getByRole("button", { name: "Close" }).click();
  const siteFilter = page.locator("[data-app-header-actions]").getByLabel("Site", { exact: true });
  await siteFilter.click();
  await page.getByRole("listbox", { name: "Site" }).getByRole("option", { name: "KT2", exact: true }).click();
  await tablist.getByRole("tab", { name: "Open headcount" }).click();
  await expect(panel.locator("[data-open-requisition-count]")).toHaveText(/\d+ open requisitions?/);
  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await recordList.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await recordList.locator("[data-home-requisition-row]").evaluateAll((rows) => rows.every((row) => row.scrollWidth <= row.clientWidth))).toBe(true);
  }
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(() => recordList.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await recordList.evaluate((element) => getComputedStyle(element).maxHeight)).toBe("none");
  expect(await recordList.evaluate((element) => getComputedStyle(element).overflowY)).toBe("visible");
  expect((await panel.locator("[data-home-requisition-row]").first().getByRole("button", { name: /Open requisition:/ }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

  await installMockSupabase(page, { role: "viewer" });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  await expect(page.getByRole("tablist", { name: "Recruitment record categories" }).getByRole("tab", { name: "New Hire Confirmation" })).toHaveCount(0);
});

test("Home record identities truncate without page overflow on narrow phones", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const longName = "Patricia Candidate With a Very Long Name for a Narrow Phone Display";
  const longPosition = "Senior Veterinary Laboratory Quality Assurance Specialist";
  const candidate = mock.data.candidates.find((row) => row.candidate_id === "C-PHONE");
  const requisition = mock.data.requisitions.find((row) => row.doc_id === "REQ-HQ-1");
  if (!candidate || !requisition) throw new Error("Expected Home identity fixtures.");
  candidate.name = longName;
  requisition.position = longPosition;
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcomeDialog.isVisible()) await welcomeDialog.getByRole("button", { name: "Close" }).last().click();
  const panel = page.getByRole("tabpanel");
  const requisitionPosition = panel.locator("[data-home-requisition-row]").filter({ hasText: longPosition }).locator("button span").first();
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(requisitionPosition).toBeVisible();
    await expect(requisitionPosition).toHaveCSS("text-overflow", "ellipsis");
    await expect(requisitionPosition.locator("xpath=..")).toHaveAttribute("title", new RegExp(longPosition));
    expect(await requisitionPosition.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.getByRole("tab", { name: "Candidate Pipeline" }).click();
  const candidateRow = panel.locator("[data-home-candidate-row]").filter({ hasText: longName });
  await expect(candidateRow.getByText(longName, { exact: true })).toBeVisible();
  const candidateName = candidateRow.getByText(longName, { exact: true });
  await expect(candidateName).toHaveCSS("text-overflow", "ellipsis");
  expect(await candidateRow.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect((await candidateRow.getByRole("button", { name: `Open candidate: ${longName}` }).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("home sourcing records use the sourcing work-board scope for the selected week", async ({ page }) => {
  await installMockSupabase(page, { role: "site_recruiter" });
  await page.goto("/home?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);

  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcomeDialog.isVisible()) await welcomeDialog.getByRole("button", { name: "Close" }).last().click();

  const tablist = page.getByRole("tablist", { name: "Recruitment record categories" });
  await tablist.getByRole("tab", { name: "Sourcing Updates" }).click();
  const homeRecords = page.getByRole("tabpanel");
  const openSourcing = homeRecords.getByRole("link", { name: "GRP-TECH - Technician" }).first();
  await expect(openSourcing).toBeVisible();
  await expect(openSourcing).toHaveAttribute("href", /\/workspace\?.*type=group.*id=GRP-TECH/);
  await page.setViewportSize({ width: 360, height: 800 });
  expect((await openSourcing.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await expect(homeRecords.getByText("GRP-TECH - Technician", { exact: true })).toBeVisible();
  await expect(homeRecords.getByText("GRP-KT1-PEER - Line Technician", { exact: true })).toBeVisible();
  await expect(homeRecords.getByText("GRP-HQ-BOB - Recruitment Coordinator", { exact: true })).toBeVisible();
  await expect(homeRecords.getByText("GRP-ENG - Engineer", { exact: true })).toHaveCount(0);

  await page.goto("/sourcing?sourcingWeek=2026-07-06");
  await expectWorkspaceReady(page);
  await expect(page.locator("article").filter({ hasText: "GRP-TECH" }).first()).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "GRP-KT1-PEER" }).first()).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "GRP-HQ-BOB" }).first()).toBeVisible();
  await expect(page.locator("article").filter({ hasText: "GRP-ENG" })).toHaveCount(0);
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
  expect(workBox?.height ?? 0).toBeLessThan(calendarBox?.height ?? 0);
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
  expect(mobileCalendarBox?.y ?? 0).toBeLessThan(mobileWorkBox?.y ?? 0);
});

test("Today's Events shows a single row and an empty state under site scope", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const pending = mock.data.recruitment_logs.find((log) => log.candidate_id === "C-PHONE" && log.result === null);
  if (!pending) throw new Error("Expected a pending calendar fixture.");
  const longName = "Patricia Candidate With a Very Long Name for Today Events";
  const eventCandidate = mock.data.candidates.find((row) => row.candidate_id === "C-PHONE");
  if (!eventCandidate) throw new Error("Expected a candidate fixture.");
  eventCandidate.name = longName;
  const remark = "Latest pending event remark with enough detail to require responsive truncation and full-text access";
  pending.remark = remark;
  const today = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  });
  mock.data.recruitment_logs.splice(0, mock.data.recruitment_logs.length, { ...pending, log_id: 999, estimated_action_date: today });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcomeDialog.isVisible()) await welcomeDialog.getByRole("button", { name: "Close" }).last().click();
  const todaysEvents = page.locator("[data-todays-events]");
  await expect(todaysEvents.locator("[data-today-event-row]")).toHaveCount(1);
  await expect(todaysEvents).toContainText("C-PHONE");
  await expect(todaysEvents).toContainText("Awaiting");
  await expect(todaysEvents).not.toContainText("Awaiting outcome");
  await expect(todaysEvents.locator("[data-today-event-row]").getByText(remark)).toHaveAttribute("title", remark);
  const candidateLink = todaysEvents.getByRole("button", { name: `Open candidate: ${longName}` });
  await expect(candidateLink).toHaveAttribute("title", longName);
  await expect(candidateLink).toHaveCSS("text-overflow", "ellipsis");
  for (const width of [768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await todaysEvents.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(todaysEvents.locator("[data-today-event-row]").getByText(remark)).toHaveCSS("text-overflow", "ellipsis");
    const titleBox = await todaysEvents.getByRole("heading", { name: "Today's Events" }).boundingBox();
    const dateBox = await todaysEvents.getByText("July 24, 2026", { exact: true }).boundingBox();
    expect(Math.abs((titleBox?.y ?? 0) - (dateBox?.y ?? 0))).toBeLessThan(12);
  }
  await candidateLink.focus();
  await expect(candidateLink).toBeFocused();
  await candidateLink.click();
  await expect(page.getByRole("dialog", { name: /C-PHONE/ })).toBeVisible();
  await page.getByRole("dialog", { name: /C-PHONE/ }).getByRole("button", { name: "Close" }).click();

  const siteFilter = page.locator("[data-app-header-actions]").getByLabel("Site", { exact: true });
  await siteFilter.click();
  await page.getByRole("listbox", { name: "Site" }).getByRole("option", { name: "KT2", exact: true }).click();
  await expect(todaysEvents.locator("[data-today-event-row]")).toHaveCount(0);
  await expect(todaysEvents.getByText("No recruitment events for this date.")).toBeVisible();
});

test("Today's Events labels an unconfirmed start due today", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const offer = mock.data.offers.find((row) => row.candidate_id === "C-OFFER-PASS");
  if (!offer) throw new Error("Expected an accepted offer fixture.");
  mock.data.recruitment_logs.splice(0, mock.data.recruitment_logs.length);
  offer.first_working_date = "2026-07-24";
  offer.start_confirmation = null;
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcomeDialog.isVisible()) await welcomeDialog.getByRole("button", { name: "Close" }).last().click();
  const todaysEvents = page.locator("[data-todays-events]");
  await expect(todaysEvents.getByText("Candidate", { exact: true })).toBeVisible();
  await expect(todaysEvents.getByText("Event context", { exact: true })).toBeVisible();
  await expect(todaysEvents.getByText("Site / owner", { exact: true })).toBeVisible();
  await expect(todaysEvents.getByText("Remark", { exact: true })).toBeVisible();
  await expect(todaysEvents.getByText("Action", { exact: true })).toHaveCount(0);
  await expect(todaysEvents.locator("[data-today-event-row]")).toHaveCount(1);
  await expect(todaysEvents.locator("[data-today-event-row]")).toContainText("Due today");
  await expect(todaysEvents.locator("[data-today-event-row]")).toContainText("C-OFFER-PASS");
  await expect(todaysEvents.locator("[data-today-event-row]").getByText("—")).toBeVisible();
});

test("Today's Events stays on Bangkok today while the calendar month changes", async ({ page }) => {
  const mock = await installMockSupabase(page, { role: "admin_recruiter" });
  const pending = mock.data.recruitment_logs.find((log) => log.candidate_id === "C-PHONE" && log.result === null);
  if (!pending) throw new Error("Expected a pending calendar fixture.");
  const today = await page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${value("year")}-${value("month")}-${value("day")}`;
  });
  mock.data.recruitment_logs.push({ ...pending, log_id: 999, estimated_action_date: today });
  mock.data.recruitment_logs.push({ ...pending, log_id: 1200, estimated_action_date: "2026-07-25" });
  for (let round = 2; round <= 8; round += 1) {
    mock.data.recruitment_logs.push({ ...pending, log_id: 1000 + round, round, estimated_action_date: today });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/home");
  await expectWorkspaceReady(page);
  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcomeDialog.isVisible()) await welcomeDialog.getByRole("button", { name: "Close" }).last().click();
  const calendar = page.getByRole("heading", { name: "Recruitment Calendar" }).locator("xpath=ancestor::section[1]");
  const todaysEvents = page.locator("[data-todays-events]");
  await expect(todaysEvents.getByRole("heading", { name: "Today's Events" })).toBeVisible();
  const todayRow = todaysEvents.locator("[data-today-event-row]").filter({ hasText: "Pat Phone" }).first();
  await expect(todayRow).toContainText("Phone Screen");
  await expect(todayRow).toContainText("Awaiting");
  await expect(todayRow).toContainText("C-PHONE");
  await expect(todayRow).toContainText("HQ");
  await expect(todaysEvents).toContainText("July 24, 2026");
  await expect(todayRow.getByRole("button", { name: "Open candidate: Pat Phone" })).toBeVisible();
  const todayRows = todaysEvents.locator("[data-today-event-row]");
  const todayEventHeader = todaysEvents.locator("[data-today-event-header]");
  await expect(todayEventHeader).toBeVisible();
  await expect(todayRows).toHaveCount(8);
  const boundedTodayList = todaysEvents.locator("div.grid.overflow-y-auto");
  expect(await boundedTodayList.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
  await todaysEvents.scrollIntoViewIfNeeded();
  await boundedTodayList.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(todayEventHeader).toBeInViewport();
  for (const width of [768, 1024]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await todaysEvents.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await todayRows.evaluateAll((rows) => rows.every((row) => row.scrollWidth <= row.clientWidth))).toBe(true);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  const todayChip = calendar.locator('[data-recruitment-calendar="desktop"]').getByRole("button", { name: /Open Pat Phone, Stage event, 24\/07\/2026/ }).first();
  await expect(todayChip).toHaveAttribute("title", /Stage event.*\d{2}\/\d{2}\/\d{4}/);
  await expect(todayChip.locator("strong")).toHaveText("Pat Phone");
  await expect(todayChip.locator("svg")).toHaveCount(1);
  expect((await todayChip.innerText()).trim()).toBe("Pat Phone");
  await calendar.getByRole("button", { name: "Next month" }).click();
  await expect(todayRow).toBeVisible();
  await page.clock.setSystemTime(new Date("2026-07-25T05:00:00.000Z"));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(todaysEvents).toContainText("July 25, 2026");
  await expect(todaysEvents.locator("[data-today-event-row]")).toHaveCount(2);
  await expect(todaysEvents.locator("[data-today-event-row]").filter({ hasText: "C-PHONE" })).not.toHaveCount(0);
  await expect(calendar.getByText("August 2026", { exact: true })).toBeVisible();
  const siteFilter = page.locator("[data-app-header-actions]").getByLabel("Site", { exact: true });
  await siteFilter.click();
  await page.getByRole("listbox", { name: "Site" }).getByRole("option", { name: "KT2", exact: true }).click();
  await expect(todaysEvents.getByText("No recruitment events for this date.")).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(todaysEvents).toBeHidden();
  await expect(calendar.locator('[data-recruitment-calendar="mobile"] [data-mobile-selected-agenda]')).toBeVisible();
  for (const width of [390, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  const records = page.getByRole("tabpanel");
  const sort = records.getByLabel("Sort open headcount");
  await expect(sort.locator("option").nth(0)).toHaveText("Oldest first");
  await sort.selectOption("demand");
  await expect(sort).toHaveValue("demand");
  const tabs = page.getByRole("tablist");
  await tabs.getByRole("tab", { name: /Candidate Pipeline/ }).focus();
  await page.keyboard.press("End");
  await expect(tabs.getByRole("tab", { name: /New Hire Confirmation/ })).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tabs.getByRole("tab", { name: /Open [Hh]eadcount/ })).toBeFocused();
  const tabColumns = [
    { tab: "Candidate Pipeline", column: "Progress" },
    { tab: "Sourcing Updates", column: "Open vacancies" },
    { tab: "Data Quality", column: "Severity" },
    { tab: "New Hire Confirmation", column: "Confirmation action" }
  ];
  for (const { tab, column } of tabColumns) {
    await tabs.getByRole("tab", { name: new RegExp(tab) }).click();
    await expect(page.locator("[data-home-record-list]")).toBeVisible();
    await expect(page.locator("[data-home-record-header]")).toContainText(column);
    if (tab !== "Candidate Pipeline") {
      await expect(page.locator("[data-home-record-header] > span")).toHaveCount(6);
      await expect(page.locator("[data-home-record-header]")).toHaveCSS("position", "sticky");
    }
    for (const width of [360, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (width >= 768) await expect(page.locator("[data-home-record-header]")).toBeVisible();
      else await expect(page.locator("[data-home-record-header]")).toBeHidden();
    }
  }
  await page.getByRole("tab", { name: /Open [Hh]eadcount/ }).click();
  const thaiPage = await page.context().newPage();
  await installMockSupabase(thaiPage, { role: "admin_recruiter", language: "th" });
  await thaiPage.goto("/home");
  await expect(thaiPage.locator("[data-app-header-actions]")).toBeVisible();
  const thaiWelcome = thaiPage.getByRole("dialog", { name: "ยินดีต้อนรับกลับ" });
  if (await thaiWelcome.isVisible()) await thaiWelcome.getByRole("button", { name: "ปิด" }).last().click();
  await expect(thaiPage.getByRole("heading", { name: "กิจกรรมวันนี้" })).toBeVisible();
  await expect(thaiPage.getByLabel("เรียงอัตราคงค้าง").locator("option").nth(1)).toHaveText("จำนวนอัตราคงค้างมากที่สุด");
  await expect(thaiPage.getByRole("tabpanel").locator("[data-home-record-header]")).toContainText("อัตราคงค้าง");
  await expect(thaiPage.getByRole("tab", { name: "ยืนยันการเริ่มงานใหม่" })).toBeVisible();
  await thaiPage.close();
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
  const welcomeDialog = page.getByRole("dialog", { name: "Welcome back" });
  if (await welcomeDialog.isVisible()) await welcomeDialog.getByRole("button", { name: "Close" }).last().click();
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
  await candidateDetail.getByRole("button", { name: "Confirm start" }).last().click();
  await expect(page.getByRole("dialog", { name: "New Hire Confirmation" })).toBeVisible();
  await page.getByRole("dialog", { name: "New Hire Confirmation" }).getByRole("button", { name: "Cancel" }).click();
  await candidateDetail.getByRole("button", { name: "Close" }).click();
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
  await expect(page.getByTestId("audit-table-viewport")).toBeVisible();
  await expect(page.getByTestId("audit-table-viewport").locator("article").first()).toContainText("Pipeline");
  await expect(page.getByTestId("audit-table-viewport").locator("article").first()).toContainText("16");
  await expect(page.getByRole("status")).toContainText("audit events");
  await expect(page.getByTestId("audit-table-viewport").locator("article").first()).toContainText("changed fields");
  const changes = page.getByLabel("View field changes for recruitment_logs 16");
  await changes.click();
  await expect(changes).toHaveAttribute("aria-expanded", "true");
  const diffId = await changes.getAttribute("aria-controls");
  if (!diffId) throw new Error("Missing Audit disclosure target");
  const diff = page.locator(`#${diffId}`);
  await expect(diff.getByText("candidate_id")).toBeVisible();
  await page.setViewportSize({ width: 768, height: 800 });
  expect((await diff.boundingBox())?.width ?? 0).toBeGreaterThan(500);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(page.getByRole("dialog", { name: "Filters" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open candidate" })).toBeVisible();
});
