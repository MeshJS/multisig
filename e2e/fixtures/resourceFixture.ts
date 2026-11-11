import { createHash } from "node:crypto";
import { test as authTest } from "./authFixture";

// Independent browser cases represent independent clients. Avoid exhausting a
// shared localhost IP budget in a fast matrix run; keep each case rate-limited.
// This is deliberately unavailable against deployed/remote environments.
export const test = authTest.extend({
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
