import { setTimeout as delay } from "node:timers/promises";
import { test, expect } from "../fixtures/resourceFixture";

test("resource fixture tears down overlapping route handlers", async ({
  page,
}) => {
  let started = 0;
  let allStarted!: () => void;
  const pending = new Promise<void>((resolve) => {
    allStarted = resolve;
  });

  await page.route("http://resource-fixture.invalid/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/") {
      await route.fulfill({ contentType: "text/html", body: "<h1>Ready</h1>" });
      return;
    }
    if (++started === 2) allStarted();
    // Finish one handler while fixture teardown is still waiting for the other.
    // Playwright 1.60's unrouteAll({ behavior: "wait" }) releases the second
    // request early, causing its eventual fulfill to throw "already handled".
    await delay(pathname === "/fast" ? 100 : 500);
    await route.fulfill({ json: { pathname } });
  });

  await page.goto("http://resource-fixture.invalid/");
  await expect(page.getByRole("heading", { name: "Ready" })).toBeVisible();
  await page.evaluate(() => {
    void Promise.allSettled([fetch("/fast"), fetch("/slow")]);
  });
  await pending;
  // Deliberately finish with both handlers in flight, like a wallet page whose
  // UI assertions pass while background tRPC reads are still pending.
  expect(started).toBe(2);
});
