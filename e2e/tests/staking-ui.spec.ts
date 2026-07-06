// Phase 3 item 6: Staking UI.
//
// Proves the SDK staking page works in the browser without touching the chain:
//   - the page loads staking state and gates actions on pool selection
//   - inactive stake exposes RegisterAndDelegate; active stake exposes
//     Delegate + Deregister
//   - proposing a register+delegate certificate creates a pending transaction
//
// Runs against a throwaway 2-of-3 wallet created with the CI signers' stake
// keys (the app classifies it as an SDK wallet, so the staking page can derive
// a stake address and staking script). The wallet is unfunded: UTxOs and the
// account state are mocked, and the 2-of-3 threshold means the certificate
// proposal stays pending — nothing is broadcast. The stranded pending row is
// deleted in cleanup so reruns and parallel workers stay clean.

import { test, expect } from "../fixtures/authFixture";
import { loadContext } from "../helpers/contextLoader";
import { createThrowawayWallet, trpcMutate } from "../helpers/apiHelpers";
import {
  mockWalletUtxos,
  mockAccountState,
  mockPoolList,
  resolveStakePoolHex,
  waitForSinglePendingTransaction,
} from "../helpers/phase3Mocks";

test.describe("staking UI", () => {
  test("staking page gates actions on pool selection and account state", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();
    const poolHex = await resolveStakePoolHex(ctx);

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E staking-gates ${Date.now()}-${test.info().workerIndex}`,
      { withStakeKeys: true },
    );
    await mockWalletUtxos(page);
    await mockPoolList(page);
    await mockAccountState(page, { active: false });

    await page.goto(`/wallets/${wallet.walletId}/staking`);

    // Staking info loads from the mocked account state.
    await expect(page.getByRole("heading", { name: "Staking Info", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Inactive", { exact: true })).toBeVisible();

    // No staking actions are offered until a pool is chosen.
    await expect(page.getByRole("heading", { name: "Staking Actions" })).toHaveCount(0);

    const poolInput = page.getByPlaceholder("Enter pool ID");
    await poolInput.fill(poolHex);
    await expect(page.getByText("Selected Pool ID:")).toBeVisible();

    // Inactive stake: only the combined register+delegate action is offered.
    await expect(page.getByRole("heading", { name: "Staking Actions" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "RegisterAndDelegate" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Deregister" })).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Delegate", exact: true }),
    ).toHaveCount(0);
  });

  test("active stake exposes delegate and deregister actions", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();
    const poolHex = await resolveStakePoolHex(ctx);

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E staking-active ${Date.now()}-${test.info().workerIndex}`,
      { withStakeKeys: true },
    );
    await mockWalletUtxos(page);
    await mockPoolList(page);
    await mockAccountState(page, { active: true, poolId: poolHex });

    await page.goto(`/wallets/${wallet.walletId}/staking`);
    await expect(page.getByRole("heading", { name: "Staking Info", exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Active", { exact: true })).toBeVisible();

    await page.getByPlaceholder("Enter pool ID").fill(poolHex);

    await expect(page.getByRole("heading", { name: "Staking Actions" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Delegate", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Deregister" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "RegisterAndDelegate" }),
    ).toHaveCount(0);
  });

  test("register & delegate certificate proposal creates a pending transaction", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();
    const poolHex = await resolveStakePoolHex(ctx);

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E staking-propose ${Date.now()}-${test.info().workerIndex}`,
      { withStakeKeys: true },
    );
    await mockWalletUtxos(page);
    await mockPoolList(page);
    await mockAccountState(page, { active: false });

    await page.goto(`/wallets/${wallet.walletId}/staking`);
    await expect(page.getByRole("heading", { name: "Staking Info", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByPlaceholder("Enter pool ID").fill(poolHex);

    // The action card's UTxO selector must auto-select the mocked UTxO before
    // the certificate transaction can be built.
    await page.waitForSelector(
      '[data-testid="utxo-selector"][data-loaded="true"]',
      { timeout: 60_000 },
    );

    const createTransactionResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("transaction.createTransaction") &&
        response.request().method() === "POST",
      { timeout: 120_000 },
    );
    await page.getByRole("button", { name: "RegisterAndDelegate" }).click();
    const createTransactionResponse = await createTransactionResponsePromise;
    expect(
      createTransactionResponse.ok(),
      `createTransaction failed ${createTransactionResponse.status()}: ${await createTransactionResponse.text().catch(() => "")}`,
    ).toBe(true);

    await expect(page.getByText("Stake Registered & Delegated").first()).toBeVisible({
      timeout: 30_000,
    });

    const pending = await waitForSinglePendingTransaction(
      page,
      wallet.walletId,
      ctx.signerAddresses[0]!,
    );
    try {
      // Only the proposer signed; 2-of-3 keeps the certificate pending.
      expect(pending.signedAddresses).toEqual([ctx.signerAddresses[0]!]);
      expect(pending.state).toBe(0);
    } finally {
      await trpcMutate(page, "transaction.deleteTransaction", {
        transactionId: pending.id,
      }).catch(() => {});
    }
  });
});
