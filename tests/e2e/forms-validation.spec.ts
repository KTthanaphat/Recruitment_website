import { expect, test } from "@playwright/test";
import { expectWorkspaceReady, installMockSupabase } from "./support/mock-supabase";

test("candidate creation form enforces required fields before review", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/candidates");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Candidate" });
  await expect(dialog).toBeVisible();
  await page.getByRole("button", { name: "Review changes" }).click();
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toHaveCount(0);

  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("QA Candidate");
  await dialog.getByLabel("Phone No.").fill("0812345678");
  await dialog.getByLabel("Group ID").selectOption("DG-HQ-ENG");
  await dialog.getByLabel("Channel").selectOption("Facebook");
  await dialog.getByLabel("First Contact Date").fill("2026-05-31");

  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toBeVisible();
});

test("candidate identity fields guide Thai input and reject an invalid mobile number", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter", language: "th" });
  await page.goto("/candidates");
  await expectWorkspaceReady(page);
  await page.getByRole("button", { name: /ใหม่|New/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("ชื่อ")).toHaveAttribute("placeholder", "โปรดใส่ชื่อจริง นามสกุล (เช่น จริงใจ กล้าหาญ)");
  await expect(dialog.getByLabel("เบอร์โทร")).toHaveAttribute("placeholder", "โปรดหมายเลขโทรศัพท์ 10 หลัก (เช่น 0941231234)");
  await expect(dialog.getByLabel("ชื่อเล่น")).toBeVisible();
  await dialog.getByLabel("ชื่อ").fill("จริงใจ กล้าหาญ");
  await dialog.getByLabel("ชื่อเล่น").fill("ใจดี");
  await dialog.getByLabel("เบอร์โทร").fill("812345678");
  await dialog.getByRole("button", { name: /ตรวจสอบ|Review/ }).click();
  await expect(page.getByText("เบอร์โทรต้องเป็นตัวเลข 10 หลักและขึ้นต้นด้วย 0")).toBeVisible();
});

test("candidate reference name is required only for Referral channel", async ({ page }) => {
  await installMockSupabase(page, { role: "admin_recruiter" });
  await page.goto("/candidates");
  await expectWorkspaceReady(page);

  await page.getByRole("button", { name: "New" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Candidate" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Reference Name")).toHaveCount(0);

  await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Referral Candidate");
  await dialog.getByLabel("Phone No.").fill("0899999999");
  await dialog.getByLabel("Group ID").selectOption("DG-HQ-ENG");
  await dialog.getByLabel("First Contact Date").fill("2026-06-02");
  await dialog.getByLabel("Channel").selectOption("Referral");
  await expect(dialog.getByLabel("Reference Name")).toBeVisible();

  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toHaveCount(0);

  await dialog.getByLabel("Reference Name").fill("Khun Ref");
  await dialog.getByRole("button", { name: "Review changes" }).click();
  await expect(page.getByRole("dialog", { name: "Confirm Save" })).toBeVisible();
});
