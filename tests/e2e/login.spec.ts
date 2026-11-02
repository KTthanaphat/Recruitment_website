import { expect, test } from "@playwright/test";

test("login page renders", async ({ page }) => {
  const cssResponses: number[]=[];
  page.on("response",response=>{if(response.url().includes(".css"))cssResponses.push(response.status());});
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Recruitment Tracking" })).toBeVisible();
  await expect(page.getByText("เข้าสู่ระบบด้วยบัญชี Recruitment Tracking")).toBeVisible();
  await expect(page.getByRole("button", { name: "EN" })).toBeVisible();
  expect(cssResponses.length).toBeGreaterThan(0);
  expect(cssResponses.every(status=>status===200)).toBe(true);
});

test("protected workspace does not show operational empty state while unavailable", async ({ page }) => {
  await page.goto("/requisitions");
  await expect(page.getByText("No records match the current filters.")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Recruitment Tracking|Supabase configuration required|Sign In Required|Checking Session|Loading Recruitment Records|ต้องเข้าสู่ระบบ|กำลังตรวจสอบเซสชัน|กำลังโหลดข้อมูลสรรหา/ })
  ).toBeVisible();
});
