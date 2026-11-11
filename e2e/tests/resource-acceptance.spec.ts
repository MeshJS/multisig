import { test, expect } from "../fixtures/resourceFixture";
import {
  mockNavigationWallets,
  WALLET_NAME,
} from "../helpers/navigationWallet";
import { resourceLinks } from "../../src/data/learn-help";

for (const width of [375, 1280]) {
  test.describe(`resource journeys ${width}px`, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: width === 375 });
    for (const state of ["signed-out", "empty", "selected"] as const) {
      test(`all resources work for ${state}`, async ({
        page,
        authenticateAs,
      }) => {
        test.setTimeout(180_000);
        if (state !== "signed-out") await authenticateAs(page, 0);
        const wallet = await mockNavigationWallets(page, state === "empty");
        let signingCalls = 0;
        await page.exposeFunction("__unexpectedResourceSigning", () => {
          signingCalls++;
          throw new Error("Resource navigation must not sign");
        });
        await page.addInitScript(() => {
          for (const name of [
            "__ci_signData",
            "__ci_signTx",
            "__ci_submitTx",
          ]) {
            (window as any)[name] = (window as any).__unexpectedResourceSigning;
          }
        });
        const origin =
          state === "selected"
            ? `/wallets/${wallet.walletId}`
            : state === "empty"
              ? "/wallets"
              : "/getting-started";
        await page.goto(origin);
        if (state === "selected")
          await expect(
            page.getByRole("heading", { name: WALLET_NAME, exact: true }),
          ).toBeVisible();
        const before = (await page.context().cookies()).find(
          (c) => c.name === "mesh_wallet_session",
        )?.value;
        let authRequests = 0;
        page.on("request", (r) => {
          if (
            r.url().includes("getNonce") ||
            (r.url().includes("/api/auth/wallet-session") &&
              r.method() === "POST")
          )
            authRequests++;
        });
        for (const { label, href } of Object.values(resourceLinks)) {
          let link;
          if (width < 768) {
            await page
              .getByRole("button", { name: "Open navigation menu" })
              .tap();
            link = page
              .getByRole("dialog", { name: "Navigation Menu" })
              .getByRole("link", { name: label, exact: true });
            await link.scrollIntoViewIfNeeded();
            await link.tap();
          } else {
            const nav = page.getByRole("navigation", {
              name: "Main navigation",
            });
            await expect(
              nav
                .or(
                  page.getByRole("button", {
                    name: "Learn & Help",
                    exact: true,
                  }),
                )
                .first(),
            ).toBeVisible();
            if (await nav.isVisible())
              link = nav.getByRole("link", { name: label, exact: true });
            else {
              await page
                .getByRole("button", { name: "Learn & Help", exact: true })
                .click();
              link = page.getByRole("menuitem", { name: label, exact: true });
            }
            await link.click();
          }
          await expect
            .poll(() => new URL(page.url()).pathname + new URL(page.url()).hash)
            .toBe(href);
          await expect(page.locator("#main-content")).toBeVisible();
          if (width < 768)
            await expect(
              page.getByRole("dialog", { name: "Navigation Menu" }),
            ).toBeHidden();
        }
        await page.goBack();
        await expect(page).toHaveURL(/\/roadmap\/graph$/);
        await page.goForward();
        await expect(page).toHaveURL(/\/vault$/);
        await page.reload();
        await expect(page.locator("#main-content")).toBeVisible();
        await page.goto("/?from=acceptance#connect-mcp");
        await expect(page).toHaveURL(/\/docs\/mcp\?from=acceptance$/);
        await page.goto(origin);
        if (state === "selected")
          await expect(
            page.getByRole("heading", { name: WALLET_NAME, exact: true }),
          ).toBeVisible();
        if (state === "empty")
          await expect(
            page.getByRole("link", { name: "Create Your First Wallet" }),
          ).toBeVisible();
        expect(
          (await page.context().cookies()).find(
            (c) => c.name === "mesh_wallet_session",
          )?.value,
        ).toBe(before);
        expect(authRequests).toBe(0);
        expect(signingCalls).toBe(0);
      });
    }
  });
}
