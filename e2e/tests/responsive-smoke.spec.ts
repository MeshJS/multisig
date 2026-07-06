// Phase 2 item 5: Responsive smoke tests.
//
// Catches layout regressions on common mobile viewports for the core screens:
// wallet list, wallet detail, transaction list, new transaction form, and the
// wallet connect entry point. Each test asserts that the critical controls
// are visible/reachable and that the document does not overflow horizontally
// (wide content must scroll inside its own container, not the page).
//
// These are pure-UI checks against the bootstrap legacy wallet — no signing,
// no transaction creation, no chain writes. The new-transaction test mocks
// the UTxO fetch so it stays deterministic and off-chain.

import { test, expect } from "../fixtures/authFixture";
import { loadContext, getWallet } from "../helpers/contextLoader";
import type { Page } from "@playwright/test";

const VIEWPORTS = [
  { name: "iPhone SE (375x667)", width: 375, height: 667 },
  { name: "Pixel 7 (412x915)", width: 412, height: 915 },
];

const SMALL_UTXO = {
  tx_hash: "1".repeat(64),
  output_index: 0,
  amount: [{ unit: "lovelace", quantity: "3000000" }],
  data_hash: null,
  inline_datum: null,
  reference_script_hash: null,
};

async function mockUtxos(page: Page): Promise<void> {
  await page.route("**/addresses/*/utxos**", async (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pageNumber === 1 ? [SMALL_UTXO] : []),
    });
  });
}

async function expectNoHorizontalOverflow(
  page: Page,
  label: string,
): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    scrollWidth,
    `${label}: document overflows horizontally (scrollWidth ${scrollWidth}px > viewport ${clientWidth}px)`,
  ).toBeLessThanOrEqual(clientWidth + 1);
}

for (const viewport of VIEWPORTS) {
  test.describe(`responsive smoke @ ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("wallet list shows primary actions without overflow", async ({
      page,
      authenticateAs,
    }) => {
      await authenticateAs(page, 0);
      await page.goto("/wallets");
      await expect(
        page.getByRole("link", { name: "New Wallet" }),
      ).toBeVisible({ timeout: 60_000 });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
      await expectNoHorizontalOverflow(page, "wallet list");
    });

    test("wallet detail shows signer content without overflow", async ({
      page,
      authenticateAs,
    }) => {
      const ctx = loadContext();
      const wallet = getWallet(ctx, "legacy");
      await authenticateAs(page, 0);
      await page.goto(`/wallets/${wallet.walletId}`);
      await expect(
        page.getByText("Signers", { exact: true }).first(),
      ).toBeVisible({ timeout: 60_000 });
      await expectNoHorizontalOverflow(page, "wallet detail");
    });

    test("transaction list shows balance actions without overflow", async ({
      page,
      authenticateAs,
    }) => {
      const ctx = loadContext();
      const wallet = getWallet(ctx, "legacy");
      await authenticateAs(page, 0);
      await page.goto(`/wallets/${wallet.walletId}/transactions`);
      const depositButton = page
        .getByRole("button", { name: "Deposit Funds" })
        .first();
      await expect(depositButton).toBeVisible({ timeout: 60_000 });
      // Primary actions must be reachable, though New Transaction may be
      // disabled until the balance loads.
      await expect(
        page.getByRole("button", { name: "New Transaction" }).first(),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, "transaction list");
    });

    test("new transaction form is usable without overflow", async ({
      page,
      authenticateAs,
    }) => {
      const ctx = loadContext();
      const wallet = getWallet(ctx, "legacy");
      await authenticateAs(page, 0);
      await mockUtxos(page);
      await page.goto(`/wallets/${wallet.walletId}/transactions/new`);
      await page.waitForSelector(
        '[data-testid="utxo-selector"][data-loaded="true"]',
        { timeout: 60_000 },
      );

      // Below the sm breakpoint the desktop recipient table is hidden and the
      // mobile card layout must expose the address input instead.
      await expect(
        page.locator('input[placeholder="addr1... or $handle"]:visible').first(),
      ).toBeVisible();

      // The primary action is reachable by scrolling the page vertically.
      const createButton = page.getByTestId("create-transaction-button");
      await createButton.scrollIntoViewIfNeeded();
      await expect(createButton).toBeVisible();

      await expectNoHorizontalOverflow(page, "new transaction form");
    });

    test("wallet connect entry point works without overflow", async ({
      page,
      injectWallet,
    }) => {
      // Unauthenticated: no session cookie, only the injected CIP-30 mock.
      await injectWallet(page, 0);
      await page.goto("/");
      const connectButton = page
        .getByRole("button", { name: /connect wallet/i })
        .first();
      await expect(connectButton).toBeVisible({ timeout: 60_000 });
      await expectNoHorizontalOverflow(page, "landing page");

      // The connect dropdown opens and lists the injected wallet.
      await connectButton.click();
      await expect(page.locator('[role="menu"]')).toBeVisible({
        timeout: 10_000,
      });
      await expect(
        page.getByRole("menuitem", { name: "MeshCI" }),
      ).toBeVisible({ timeout: 10_000 });
      await expectNoHorizontalOverflow(page, "connect wallet menu");
    });
  });
}
