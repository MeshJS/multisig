import { test, expect } from "../fixtures/authFixture";
import { getWallet, loadContext } from "../helpers/contextLoader";
import type { Page } from "@playwright/test";

const SMALL_UTXO = {
  tx_hash: "1".repeat(64),
  output_index: 0,
  amount: [{ unit: "lovelace", quantity: "3000000" }],
  data_hash: null,
  inline_datum: null,
  reference_script_hash: null,
};

async function mockUtxos(page: Page, address: string): Promise<void> {
  const encodedAddress = encodeURIComponent(address);
  await page.route("**/addresses/*/utxos**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.includes(`/addresses/${encodedAddress}/utxos`) ||
      url.pathname.includes(`/addresses/${address}/utxos`)
    ) {
      const pageNumber = Number(url.searchParams.get("page") ?? "1");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(pageNumber === 1 ? [SMALL_UTXO] : []),
      });
      return;
    }

    await route.fallback();
  });
}

async function expectValidation(page: Page, message: RegExp): Promise<void> {
  await expect(page.getByText(message).first()).toBeVisible();
  await expect(page.getByTestId("create-transaction-button")).toBeDisabled();
}

test("new transaction form validates recipients, amounts, and selected UTxOs", async ({
  page,
  authenticateAs,
}) => {
  const ctx = loadContext();
  const sourceWallet = getWallet(ctx, "legacy");
  const destinationWallet = getWallet(ctx, "sdk");

  await authenticateAs(page, 0);
  await mockUtxos(page, sourceWallet.walletAddress);

  await page.goto(`/wallets/${sourceWallet.walletId}/transactions/new`);
  await page.waitForSelector('[data-testid="utxo-selector"][data-loaded="true"]', {
    timeout: 30_000,
  });

  await expectValidation(page, /address is required/i);

  await page.getByTestId("recipient-address-input-0").fill("not-a-cardano-address");
  await page.getByTestId("amount-input-0").fill("1");
  await expectValidation(page, /address is invalid/i);

  await page.getByTestId("recipient-address-input-0").fill(destinationWallet.walletAddress);
  await page.getByTestId("amount-input-0").fill("0");
  await expectValidation(page, /amount must be greater than zero/i);

  await page.getByTestId("amount-input-0").fill("-1");
  await expectValidation(page, /amount must be greater than zero/i);

  await page.getByTestId("amount-input-0").fill("999");
  await expectValidation(page, /exceeds the selected UTxO balance/i);

  await page.getByTestId("amount-input-0").fill("1");
  await expect(page.getByText("Input UTxOs (1)")).toBeVisible();
  await expect(page.getByTestId("create-transaction-button")).toBeEnabled();

  await page.getByRole("button", { name: /add recipient/i }).click();
  await expect(page.locator('[data-testid^="recipient-address-input-"]:not([data-testid*="mobile"])')).toHaveCount(2);
  await expectValidation(page, /Recipient 2: address is required/i);

  await page.locator("tbody tr").nth(1).locator("button").last().click();
  await expect(page.locator('[data-testid^="recipient-address-input-"]:not([data-testid*="mobile"])')).toHaveCount(1);
  await expect(page.getByTestId("create-transaction-button")).toBeEnabled();
});
