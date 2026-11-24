import { defineConfig } from "@playwright/test";

// Exercise the production scroll controller in a real browser without needing
// the wallet runtime, a database, or chain credentials.
export default defineConfig({
  testDir: "./scroll-restoration",
  outputDir: "../ci-artifacts/scroll-restoration",
  use: {
    headless: true,
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    },
  },
});
