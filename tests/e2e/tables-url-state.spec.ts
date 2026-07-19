import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("requisition table search and advanced filters persist in URL", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/requisitions");
  await expectWorkspaceReady(page);

  await page.getByPlaceholder("Search records").fill("Engineer");
  await expect(page.getByRole("cell", { name: "REQ-HQ-1", exact: true })).toBeVisible();
  await expect(page.getByText("REQ-KT1-1")).toHaveCount(0);
  await expect(page).toHaveURL(/reqSearch=Engineer/);

  await page.getByRole("button", { name: "Advanced Filters" }).click();
  await page.getByLabel("Filter Owner").fill("Alice");
  await expect(page).toHaveURL(/reqFilters=/);
  await page.reload();
  await expectWorkspaceReady(page);
  await expect(page.getByPlaceholder("Search records")).toHaveValue("Engineer");
  await expect(page.getByLabel("Filter Owner")).toHaveValue("Alice");
});

test("record tables use a shared scroll viewport with frozen desktop headers", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.setViewportSize({ width: 1280, height: 600 });

  for (const route of ["/requisitions", "/candidates", "/offers"]) {
    await page.goto(route);
    await expectWorkspaceReady(page);
    const viewport = page.locator(".table-scroll");
    await expect(viewport).toHaveCSS("overflow-y", "auto");
    await expect(viewport.locator("thead")).toHaveCSS("position", "sticky");
  }
});
