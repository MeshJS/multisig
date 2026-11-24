import { createHash } from "node:crypto";
import { test as authTest } from "./authFixture";

// Independent browser cases represent independent clients. Avoid exhausting a
// shared localhost IP budget in a fast matrix run; keep each case rate-limited.
// This is deliberately unavailable against deployed/remote environments.
export const test = authTest.extend({
  page: async ({ page }, use) => {
    try {
      await use(page);
    } finally {
      // Only after the test ends, discard late errors from background mocks as
      // their page closes. "wait" races with overlapping handlers in Playwright
      // 1.60 and can release a route before its fetch/fulfill completes:
      // https://github.com/microsoft/playwright/issues/43878
      // Errors during the test itself still fail normally.
      await page.unrouteAll({ behavior: "ignoreErrors" });
    }
  },
  context: async ({ context }, use, info) => {
    if (process.env.RESOURCE_ACCEPTANCE_LOCAL === "1") {
      const host = new URL(process.env.APP_URL ?? "http://localhost:3100")
        .hostname;
      if (!["localhost", "127.0.0.1"].includes(host))
        throw new Error("Local resource fixture requires localhost");
      const id = createHash("sha256")
        .update(`${info.testId}:${info.retry}:${process.pid}`)
        .digest();
      await context.setExtraHTTPHeaders({
        "x-forwarded-for": `127.${id[0]}.${id[1]}.${id[2]}`,
      });
    }
    await use(context);
  },
});
export { expect } from "@playwright/test";
