import { defineConfig } from "@playwright/test";

// Public documentation checks need no chain bootstrap, wallet keys, or database fixtures.
export default defineConfig({
  testDir: "./tests",
  testMatch: "public-resources.spec.ts",
  outputDir: "../ci-artifacts/resource-tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.APP_URL ?? "http://localhost:3000",
    headless: true,
    screenshot: "only-on-failure",
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
  },
});
