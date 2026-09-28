import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

async function expectNoDocumentOverflow(page: Page, route = page.url()) {
  const result = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    offenders: Array.from(document.querySelectorAll<HTMLElement>("body *"))
      .filter((element) => element.getBoundingClientRect().right > window.innerWidth + 1)
      .slice(0, 5)
      .map((element) => ({ className: element.className, right: Math.round(element.getBoundingClientRect().right), tag: element.tagName }))
  }));
  expect(result.documentWidth, `${route}: ${JSON.stringify(result.offenders)}`).toBeLessThanOrEqual(result.viewportWidth);
}

async function expectMinimumTarget(locator: Locator, pixels = 44) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(pixels);
  expect(box!.height).toBeGreaterThanOrEqual(pixels);
}

const phoneViewports = [
  { width: 390, height: 844 },
  { width: 360, height: 800 }
] as const;

for (const viewport of phoneViewports) {
  const size = `${viewport.width}x${viewport.height}`;

  test(`phone Home ${size} keeps exactly two summaries without an embedded work queue`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installMockSupabase(page, { role: "admin_recruiter" });
    await page.goto("/home");
    await expectWorkspaceReady(page);

    const workPanel = page.getByRole("heading", { name: "Today's Work" }).locator("xpath=ancestor::section[1]");
    const visibleSummaryRows = workPanel.locator("p:visible").filter({ hasText: /^(Open requisition|Urgent items|Aging candidates|Sourcing gaps)$/ });
    await expect(visibleSummaryRows).toHaveCount(2);
    await expect(workPanel.locator("p:visible", { hasText: /^Open requisition$/ })).toBeVisible();
    await expect(workPanel.locator("p:visible", { hasText: /^Urgent items$/ })).toBeVisible();

    // Today's Work ends after its metrics; the derived urgent count remains live.
    await expect(workPanel.locator("[data-home-scroll-section]")).toHaveCount(0);
    await expectNoDocumentOverflow(page, `/home at ${size}`);
  });

  test(`phone Candidates ${size} shows requested metadata with 44px triage targets`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installMockSupabase(page, { role: "admin_recruiter" });
    await page.goto("/candidates");
    await expectWorkspaceReady(page);

    await expect(page.getByRole("heading", { name: "Candidates" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "New Candidate", exact: true })).toBeVisible();
    const card = page.locator("article", { hasText: "Pat Phone" });
    for (const label of ["Candidate ID", "Group", "Owner", "Last Touch"]) {
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(card.getByText("C-PHONE", { exact: true })).toBeVisible();
    await expect(card.getByText("Engineer", { exact: true })).toBeVisible();
    await expect(card.getByText("Alice", { exact: true })).toBeVisible();
    await expect(card.locator('[data-tag-appearance="soft"]')).toBeVisible();
    const triageControls = page.locator('button[aria-pressed][class*="min-h-11"]:visible');
    await expect(triageControls).toHaveCount(7);
    for (const triage of await triageControls.all()) {
      await expectMinimumTarget(triage);
    }
    const detailButton = card.getByRole("button", { name: /View candidate detail for Pat Phone/ });
    await expectMinimumTarget(detailButton);
    await expectNoDocumentOverflow(page, `/candidates at ${size}`);
    await detailButton.click();
    const detail = page.getByRole("dialog", { name: /C-PHONE.*Pat Phone/ });
    await expect(detail.locator('[data-tag-appearance="soft"]')).toHaveCount(2);
  });

  test(`phone Requisitions ${size} shows requested metadata and retained actions`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await installMockSupabase(page, { role: "admin_recruiter" });
    await page.goto("/requisitions");
    await expectWorkspaceReady(page);

    await expect(page.getByRole("heading", { name: "Requisitions" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "New Requisition" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Status", exact: true })).toBeVisible();
    const card = page.locator("article", { hasText: "REQ-HQ-1" });
    for (const label of ["Requisition ID", "Department", "Request Type", "Owner", "Readiness", "Age", "SLA"]) {
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(card.getByText("Operations", { exact: true })).toBeVisible();
    await expect(card.getByText("Alice", { exact: true })).toBeVisible();
    await expectMinimumTarget(card.getByRole("button", { name: /View requisition detail for .*REQ-HQ-1/ }));
    await expectNoDocumentOverflow(page, `/requisitions at ${size}`);
  });
}

test("Thai candidate cards retain localized metadata and soft status semantics", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMockSupabase(page, { role: "admin_recruiter", language: "th" });
  await page.goto("/candidates?lang=th");
  const card = page.locator("article", { hasText: "Pat Phone" });
  await expect(card.getByText("รหัสผู้สมัคร", { exact: true })).toBeVisible();
  await expect(card.getByText("อัปเดตล่าสุด", { exact: true })).toBeVisible();
  await expect(card.locator('[data-tag-appearance="soft"]')).toBeVisible();
});

test("desktop shared table consumers contain wide data and keep sticky, keyboard-reachable viewports", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installMockSupabase(page, { role: "admin_recruiter" });

  for (const route of ["/candidates", "/requisitions", "/offers", "/pipeline", "/sourcing?sourcingWeek=2026-07-06"]) {
    await page.goto(route);
    await expectWorkspaceReady(page);
    if (route === "/pipeline") await page.getByRole("button", { name: "Table", exact: true }).click();
    if (route.startsWith("/sourcing")) await page.getByRole("button", { name: "Lifecycle history", exact: true }).click();
    const viewport = page.locator(".table-scroll:visible").first();
    await expect(viewport).toHaveCSS("overflow-x", "auto");
    await expect(viewport.locator("thead")).toHaveCSS("position", "sticky");
    expect(await viewport.evaluate((element) => element.clientWidth <= element.parentElement!.clientWidth)).toBe(true);
    const viewportBounds = await viewport.evaluate((element) => ({
      clientRight: document.documentElement.clientWidth,
      rect: element.getBoundingClientRect().toJSON()
    }));
    expect(viewportBounds.rect.right, `${route}: ${JSON.stringify(viewportBounds)}`).toBeLessThanOrEqual(viewportBounds.clientRight);
    expect(await viewport.locator('button, a, input, select, [tabindex="0"]').count()).toBeGreaterThan(0);
    const firstControl = viewport.locator("button, input, select").first();
    await firstControl.focus();
    await expect(firstControl).toBeFocused();
    if (route === "/candidates") {
      await page.getByRole("button", { name: "Advanced Filters" }).click();
      const ownerFilter = viewport.getByLabel("Filter Owner");
      await ownerFilter.focus();
      await expect(ownerFilter).toBeFocused();
      await ownerFilter.click();
      const ownerDetails = ownerFilter.locator("xpath=ancestor::details[1]");
      await expect(ownerDetails).toHaveAttribute("open", "");
      const ownerPopup = ownerDetails.getByText("Select all", { exact: true });
      const popupGeometry = await ownerPopup.evaluate((element) => ({
        popup: element.getBoundingClientRect().toJSON(),
        summary: element.closest("details")!.querySelector("summary")!.getBoundingClientRect().toJSON(),
        viewport: element.closest(".table-scroll")!.getBoundingClientRect().toJSON()
      }));
      expect(popupGeometry.popup.height, JSON.stringify(popupGeometry)).toBeGreaterThan(0);
      expect(Math.min(popupGeometry.popup.bottom, popupGeometry.viewport.bottom) - Math.max(popupGeometry.popup.top, popupGeometry.viewport.top), JSON.stringify(popupGeometry)).toBeGreaterThan(0);
    }
    await expectNoDocumentOverflow(page, route);
  }
});
