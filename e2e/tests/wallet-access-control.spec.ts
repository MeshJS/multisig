// Phase 2 item 4: Wallet access control.
//
// Proves page guards match wallet authorization:
//   - A signer can open the wallet pages of a wallet they belong to.
//   - An authenticated non-member gets FORBIDDEN from wallet.getWallet and the
//     wallet pages never render wallet content (the app keeps the loading
//     skeleton and exposes nothing).
//   - Unauthenticated direct navigation falls back to the public landing page.
//   - The denial survives a browser reload.
//
// The non-member is a real derived preprod address (the standard all-zero
// entropy test mnemonic) with a valid injected session cookie — i.e. a fully
// authenticated user who simply is not a signer of the target wallet.

import { test, expect } from "../fixtures/authFixture";
import { loadContext, getWallet } from "../helpers/contextLoader";
import { buildCip30MockScript } from "../helpers/cip30Mock";
import {
  buildWalletSessionToken,
  WALLET_SESSION_COOKIE,
} from "../helpers/authSession";
import { buildRestToken } from "../helpers/apiHelpers";
import type { Page, Response } from "@playwright/test";

// Standard BIP-39 test vector (all-zero entropy): valid checksum, derives a
// real preprod address that is not a signer of any bootstrap wallet.
const NON_MEMBER_MNEMONIC = [...Array(23).fill("abandon"), "art"].join(" ");

async function deriveNonMemberAddress(): Promise<string> {
  const { MeshWallet } = await import("@meshsdk/core");
  const wallet = new MeshWallet({
    networkId: 0,
    key: { type: "mnemonic", words: NON_MEMBER_MNEMONIC.split(" ") },
  });
  await wallet.init();
  return wallet.getChangeAddress();
}

// Mirrors authFixture's CI path for an arbitrary address: injects the CIP-30
// mock (with inert bridge stubs — no signing ever happens here), seeds Mesh's
// persisted connection so auto-connect resolves useAddress on every load, and
// installs a valid non-Secure session cookie for the address.
async function setupSessionFor(page: Page, address: string): Promise<void> {
  const jwtSecret = process.env.CI_JWT_SECRET!;
  const { Address } = await import("@meshsdk/core-cst");
  const addressHex = Address.fromBech32(address).toBytes().toString();

  await page.addInitScript({
    content:
      `
      window.__ci_getUtxos = async function() { return []; };
      window.__ci_signTx = function() { return Promise.reject(new Error("signing not supported in access-control spec")); };
      window.__ci_signData = function() { return Promise.reject(new Error("signing not supported in access-control spec")); };
      window.__ci_submitTx = async function() { return "${"0".repeat(64)}"; };
      try { localStorage.setItem("mesh-wallet-persist", JSON.stringify({ walletName: "meshci" })); } catch (e) {}
      ` +
      buildCip30MockScript({
        walletName: "meshci",
        usedAddresses: [addressHex],
        changeAddress: addressHex,
        rewardAddresses: [],
      }),
  });

  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  await page.context().clearCookies({ name: WALLET_SESSION_COOKIE });
  await page.context().addCookies([
    {
      name: WALLET_SESSION_COOKIE,
      value: buildWalletSessionToken(address, jwtSecret),
      url: appUrl,
      httpOnly: true,
      sameSite: "Lax",
      secure: false,
      expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    },
  ]);
}

function waitForGetWallet(page: Page): Promise<Response> {
  return page.waitForResponse(
    (response) => response.url().includes("wallet.getWallet"),
    { timeout: 60_000 },
  );
}

// Navigates and waits for the wallet.getWallet round-trip so absence
// assertions run after the app has actually resolved (and denied) the query.
async function gotoAndAwaitGetWallet(page: Page, path: string): Promise<string> {
  const responsePromise = waitForGetWallet(page);
  await page.goto(path);
  const response = await responsePromise;
  return response.text().catch(() => "");
}

async function expectNoWalletContent(page: Page): Promise<void> {
  await expect(page.getByText("Signers", { exact: true })).toHaveCount(0);
  await expectNoWalletActions(page);
}

// Narrower variant for the public landing fallback, whose marketing copy
// legitimately contains the word "Signers".
async function expectNoWalletActions(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "Deposit Funds" })).toHaveCount(0);
  await expect(page.getByTestId("create-transaction-button")).toHaveCount(0);
  await expect(page.locator('[data-testid^="tx-card-"]')).toHaveCount(0);
}

test.describe("wallet access control", () => {
  test("authenticated signer can open wallet pages they belong to", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();
    const wallet = getWallet(ctx, "legacy");

    await authenticateAs(page, 0);

    // Wallet detail (info) page renders the signer list.
    await page.goto(`/wallets/${wallet.walletId}`);
    await expect(page.getByText("Signers", { exact: true }).first()).toBeVisible(
      { timeout: 60_000 },
    );

    // Transactions page renders the balance card actions.
    await page.goto(`/wallets/${wallet.walletId}/transactions`);
    await expect(
      page.getByRole("button", { name: "Deposit Funds" }).first(),
    ).toBeVisible({ timeout: 60_000 });

    // New transaction page renders the form for a member.
    await page.goto(`/wallets/${wallet.walletId}/transactions/new`);
    await expect(page.getByTestId("create-transaction-button")).toBeVisible({
      timeout: 60_000,
    });

    // Info route renders the same guarded content.
    await page.goto(`/wallets/${wallet.walletId}/info`);
    await expect(page.getByText("Signers", { exact: true }).first()).toBeVisible(
      { timeout: 60_000 },
    );
  });

  test("authenticated non-member cannot open wallet pages", async ({ page }) => {
    test.skip(
      !process.env.CI_JWT_SECRET,
      "CI_JWT_SECRET is required to mint a session for a non-member address",
    );
    test.setTimeout(240_000);
    const ctx = loadContext();
    const wallet = getWallet(ctx, "legacy");
    const nonMember = await deriveNonMemberAddress();
    expect(ctx.signerAddresses).not.toContain(nonMember);

    await setupSessionFor(page, nonMember);

    // Wallet detail: the server denies the wallet query and the page never
    // shows wallet content.
    const getWalletBody = await gotoAndAwaitGetWallet(
      page,
      `/wallets/${wallet.walletId}`,
    );
    expect(getWalletBody).toMatch(/FORBIDDEN|Not a signer|UNAUTHORIZED/);
    await expectNoWalletContent(page);

    // The denial holds across every guarded wallet route.
    for (const path of [
      `/wallets/${wallet.walletId}/transactions`,
      `/wallets/${wallet.walletId}/transactions/new`,
      `/wallets/${wallet.walletId}/info`,
      `/wallets/${wallet.walletId}/staking`,
      `/wallets/${wallet.walletId}/governance`,
    ]) {
      await gotoAndAwaitGetWallet(page, path);
      await expectNoWalletContent(page);
    }

    // REST surface agrees: pending transactions are not readable either.
    const restResponse = await page.request.get(
      `/api/v1/pendingTransactions?walletId=${encodeURIComponent(wallet.walletId)}&address=${encodeURIComponent(nonMember)}`,
      { headers: { Authorization: `Bearer ${buildRestToken(nonMember)}` } },
    );
    expect(
      restResponse.ok(),
      `expected pendingTransactions to deny non-member, got ${restResponse.status()}`,
    ).toBe(false);

    // Protection persists after a reload.
    const reloadResponsePromise = waitForGetWallet(page);
    await page.reload();
    await reloadResponsePromise;
    await expectNoWalletContent(page);
  });

  test("unauthenticated direct navigation does not expose wallet pages", async ({
    page,
    injectWallet,
  }) => {
    test.setTimeout(120_000);
    const ctx = loadContext();
    const wallet = getWallet(ctx, "legacy");

    // Wallet extension present but no session cookie and no persisted
    // connection: the layout falls back to the public landing view (with the
    // Connect Wallet entry point) instead of rendering the guarded wallet
    // page. Without any injected wallet the header shows the UTXOS onboarding
    // button instead, so inject the mock to model a logged-out extension user.
    await injectWallet(page, 0);
    await page.goto(`/wallets/${wallet.walletId}/transactions`);
    await expect(
      page.getByRole("button", { name: /connect wallet/i }).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expectNoWalletActions(page);

    // Still protected after a reload.
    await page.reload();
    await expect(
      page.getByRole("button", { name: /connect wallet/i }).first(),
    ).toBeVisible({ timeout: 60_000 });
    await expectNoWalletActions(page);
  });
});
