import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? "test-results",
  globalSetup: "./global-setup.ts",
  timeout: 120_000,
  retries: 0,
  reporter: [
    [
      "html",
      {
        open: "never",
        outputFolder: process.env.PLAYWRIGHT_HTML_REPORT ?? "playwright-report",
      },
    ],
    ["line"],
  ],
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
