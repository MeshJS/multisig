import fs from "fs";

const REQUIRED_ENV_VARS = [
  "CI_MNEMONIC_1",
  "CI_MNEMONIC_2",
  "CI_MNEMONIC_3",
  "CI_BLOCKFROST_PREPROD_API_KEY",
] as const;

async function globalSetup() {
  const contextPath = process.env.CI_CONTEXT_PATH;
  if (!contextPath) {
    throw new Error("CI_CONTEXT_PATH must be set before running Playwright tests");
  }

  const missing = REQUIRED_ENV_VARS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const raw = fs.readFileSync(contextPath, "utf8");
  const ctx = JSON.parse(raw) as { wallets?: Array<{ type: string }> };
  const wallets = ctx.wallets ?? [];

  for (const type of ["legacy", "hierarchical", "sdk"] as const) {
    if (!wallets.some((w) => w.type === type)) {
      throw new Error(`Bootstrap context is missing a ${type} wallet`);
    }
  }

  // Cache parsed context so tests can read it without re-hitting disk.
  process.env.CI_CONTEXT_JSON = raw;
}

export default globalSetup;
