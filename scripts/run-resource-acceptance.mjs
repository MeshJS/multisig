// Resource acceptance is off-chain. Start a production server before this runner.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";

const local = process.argv.includes("--local");
const env = { ...process.env };
if (fs.existsSync(".env.playwright")) {
  const settings = dotenv.parse(fs.readFileSync(".env.playwright"));
  for (const [key, value] of Object.entries(settings)) env[key] ??= value;
}
if (local) {
  env.RESOURCE_ACCEPTANCE_LOCAL = "1";
  env.APP_URL = process.env.APP_URL ?? "http://localhost:3100";
  if (!["localhost", "127.0.0.1"].includes(new URL(env.APP_URL).hostname)) {
    throw new Error("--local only supports a localhost production server");
  }
  // Match the local server cookie secret, without copying or printing secrets.
  env.CI_JWT_SECRET = dotenv.parse(fs.readFileSync(".env")).JWT_SECRET;
  env.CI_CONTEXT_PATH =
    process.env.CI_CONTEXT_PATH ??
    path.resolve("ci-artifacts/ci-wallet-context.json");
}
if (!env.CI_JWT_SECRET) {
  throw new Error("Resource acceptance requires CI_JWT_SECRET for the non-signing session fixture");
}
const chromium = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!env.PLAYWRIGHT_CHROMIUM_EXECUTABLE && fs.existsSync(chromium))
  env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = chromium;
env.PLAYWRIGHT_OUTPUT_DIR = path.resolve("ci-artifacts/resource-acceptance");
env.PLAYWRIGHT_HTML_REPORT = path.resolve(
  "ci-artifacts/resource-acceptance-report",
);
const run = (args) => {
  const result = spawnSync(
    process.execPath,
    ["node_modules/@playwright/test/cli.js", ...args],
    { env, stdio: "inherit" },
  );
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(["test", "--config=e2e/public-resources.config.ts", "--workers=1"]);
run([
  "test",
  "--config=e2e/playwright.config.ts",
  "connected-resources.spec.ts",
  "onboarding.spec.ts",
  "overview-profile-layout.spec.ts",
  "tasks-assets-layout.spec.ts",
  "resource-acceptance.spec.ts",
  "responsive-smoke.spec.ts",
  "--workers=1",
]);
