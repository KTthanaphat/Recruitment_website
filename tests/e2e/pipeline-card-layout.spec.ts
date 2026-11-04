import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

for (const variant of ["main", "workspace", "phone"] as const) {
  test(variant + " pipeline card wraps the application's group above metadata and opens its journey", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: variant === "phone" ? 390 : 1440, height: 900 });
    const { data } = await installMockSupabase(page, { role: "admin_recruiter" });
    const longName = "Production Engineering ฝ่ายวิศวกรรมการผลิต " + "LongUnbrokenGroupName".repeat(8);
    for (const group of data.position_groups) group.group_position = longName;
    await page.goto(variant === "main" ? "/pipeline" : "/workspace?type=group&id=GRP-ENG&section=pipeline");
    await expectWorkspaceReady(page);
    const identity = variant === "phone"
      ? page.locator("[data-workspace-pipeline-stages] button").filter({ has: page.locator("strong", { hasText: "Pat Phone" }) })
      : page.locator('[data-candidate-id="C-PHONE"]:visible button').filter({ has: page.locator("strong", { hasText: "Pat Phone" }) }).first();
    if (variant === "phone") {
      const stage = page.locator("[data-workspace-pipeline-stages] details").filter({ has: page.getByText("Pat Phone", { exact: true }) });
      await stage.locator("summary").click();
    }
    await expect(identity).toBeVisible();
    const groupLine = identity.getByText(longName, { exact: true });
    await expect(groupLine).toBeVisible();
    const layout = await identity.evaluate(element => {
      const name = element.querySelector("strong")!;
      const group = name.nextElementSibling!;
      const metadata = group.nextElementSibling!;
      return { nameBottom: name.getBoundingClientRect().bottom, groupTop: group.getBoundingClientRect().top, groupBottom: group.getBoundingClientRect().bottom, metadataTop: metadata.getBoundingClientRect().top, width: element.clientWidth, scroll: element.scrollWidth, metadata: metadata.textContent };
    });
    expect(layout.groupTop).toBeGreaterThanOrEqual(layout.nameBottom);
    expect(layout.metadataTop).toBeGreaterThanOrEqual(layout.groupBottom);
    expect(layout.scroll).toBeLessThanOrEqual(layout.width + 1);
    expect(layout.metadata).not.toContain(longName);
    await identity.screenshot({ path: testInfo.outputPath(variant + "-card.png") });
    await identity.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").first()).toBeVisible();
    await expect(page).toHaveURL(/detailId=C-PHONE/);
  });
}

test("blank group names show a placeholder without extra detail reads", async ({ page }) => {
  const { data } = await installMockSupabase(page);
  for (const group of data.position_groups) group.group_position = "   ";
  await page.goto("/pipeline"); await expectWorkspaceReady(page);
  const identity = page.locator('[data-candidate-id="C-PHONE"]:visible button').filter({ has: page.locator("strong", { hasText: "Pat Phone" }) }).first();
  await expect(identity.getByText("—", { exact: true })).toBeVisible();
});
