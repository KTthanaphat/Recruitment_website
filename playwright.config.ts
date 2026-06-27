import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry"
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: "pnpm dev",
    url: process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000
  }
});
