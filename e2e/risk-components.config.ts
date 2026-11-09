import { defineConfig, devices } from "@playwright/test";

// Isolated production-component browser tests: no app server, auth, keys or chain.
export default defineConfig({
  testDir: "./risk-components",
  testMatch: "*.spec.ts",
  outputDir: "../ci-artifacts/risk-components/results",
  timeout: 30_000,
  workers: 1,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
  },
});
