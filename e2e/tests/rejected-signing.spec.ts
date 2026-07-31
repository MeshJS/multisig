// Phase 2 item 3: Rejected wallet signing.
//
// Proves the app handles a wallet that refuses to sign:
//   - signTx rejection during proposal → no pending transaction is created,
//     the user sees an error toast, and the form stays usable.
//   - signTx rejection during approval → no signature is added, the pending
//     transaction is untouched, and the user sees an error toast.
//
// Both tests run against a throwaway 2-of-3 wallet created via tRPC over the
// CI signer addresses, never against the bootstrap ring wallets: the approval
// test intentionally leaves a transaction pending mid-test, and ring-transfer
// legs fail fast when their wallet has pending rows. The throwaway wallet is
// unfunded — the UTxO fetch is mocked and nothing ever reaches the chain
// (threshold is never met, so no broadcast path executes).

import { test, expect } from "../fixtures/authFixture";
import { loadContext } from "../helpers/contextLoader";
import { mockTxFlowReads } from "../helpers/phase3Mocks";
import {
  createThrowawayWallet,
  getPendingTransactionsRest,
  trpcMutate,
  type PendingTransaction,
} from "../helpers/apiHelpers";
import type { Page } from "@playwright/test";

const FAKE_UTXO_TX_HASH = "1".repeat(64);

// Serve one fake 5 ADA UTxO for every address the page asks about. The specs
// never broadcast, so the UTxO does not need to exist on-chain; page 2+ must
// return [] so BlockfrostProvider's pagination loop terminates.
async function mockAllUtxos(page: Page, walletAddress: string): Promise<void> {
  await page.route("**/addresses/*/utxos**", async (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        pageNumber === 1
          ? [
              {
                address: walletAddress,
                tx_hash: FAKE_UTXO_TX_HASH,
                output_index: 0,
                amount: [{ unit: "lovelace", quantity: "5000000" }],
                data_hash: null,
                inline_datum: null,
                reference_script_hash: null,
              },
            ]
          : [],
      ),
    });
  });
}

// Replaces the CIP-30 bridge's signTx with a rejecting stub on the live page.
// The injected wallet mock resolves window.__ci_signTx at call time, so this
// takes effect for the next signing attempt without a reload.
async function makeSignTxReject(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__ci_signTx = () =>
      Promise.reject(
        new Error("MeshCI mock: user declined to sign the transaction"),
      );
  });
}

async function openNewTransactionForm(
  page: Page,
  walletId: string,
  recipientAddress: string,
): Promise<void> {
  await page.goto(`/wallets/${walletId}/transactions/new`);
  await page.waitForSelector(
    '[data-testid="utxo-selector"][data-loaded="true"]',
    { timeout: 60_000 },
  );
  await page.getByTestId("recipient-address-input-0").fill(recipientAddress);
  await page.getByTestId("amount-input-0").fill("1");
  await expect(page.getByText("Input UTxOs (1)")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId("create-transaction-button")).toBeEnabled();
}

function countRequests(page: Page, urlFragment: string): () => number {
  let count = 0;
  page.on("request", (request) => {
    if (request.url().includes(urlFragment)) count += 1;
  });
  return () => count;
}

test.describe("rejected wallet signing", () => {
  test("signTx rejection during proposal creates no pending transaction", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E reject-propose ${Date.now()}-${test.info().workerIndex}`,
    );
    await mockAllUtxos(page, wallet.address);

    const createTransactionRequests = countRequests(
      page,
      "transaction.createTransaction",
    );

    await openNewTransactionForm(page, wallet.walletId, ctx.signerAddresses[2]!);
    await makeSignTxReject(page);
    await page.getByTestId("create-transaction-button").click();

    // The rejection surfaces as a destructive toast titled "Error" and the
    // form recovers: loading clears, no redirect to the transactions page.
    await expect(page.getByText("Error", { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId("create-transaction-button")).toBeEnabled({
      timeout: 30_000,
    });
    await expect(page).toHaveURL(
      new RegExp(`/wallets/${wallet.walletId}/transactions/new$`),
    );

    // signTx rejected before the mutation, so it must never have been sent
    // and nothing may be pending — in the UI or the database.
    expect(createTransactionRequests()).toBe(0);
    expect(
      await getPendingTransactionsRest(
        page,
        wallet.walletId,
        ctx.signerAddresses[0]!,
      ),
    ).toEqual([]);

    await page.goto(`/wallets/${wallet.walletId}/transactions`);
    await expect(page.locator('[data-testid^="tx-card-"]')).toHaveCount(0);
  });

  test("signTx rejection during approval adds no signature", async ({
    page,
    authenticateAs,
  }) => {
    test.setTimeout(240_000);
    const ctx = loadContext();

    await authenticateAs(page, 0);
    const wallet = await createThrowawayWallet(
      page,
      ctx,
      `E2E reject-approve ${Date.now()}-${test.info().workerIndex}`,
    );
    await mockAllUtxos(page, wallet.address);

    // Signer 0 proposes for real (bridge signs with the mnemonic). Threshold
    // is 2-of-3, so the transaction stays pending and nothing is broadcast.
    await openNewTransactionForm(page, wallet.walletId, ctx.signerAddresses[2]!);
    const createTransactionResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("transaction.createTransaction") &&
        response.request().method() === "POST",
      { timeout: 90_000 },
    );
    await page.getByTestId("create-transaction-button").click();
    const createTransactionResponse = await createTransactionResponsePromise;
    expect(
      createTransactionResponse.ok(),
      `createTransaction failed ${createTransactionResponse.status()}: ${await createTransactionResponse.text().catch(() => "")}`,
    ).toBe(true);

    await expect(page).toHaveURL(
      new RegExp(`/wallets/${wallet.walletId}/transactions$`),
      { timeout: 30_000 },
    );

    // Resolve the transaction ID from the REST API, not the rendered card:
    // right after creation the card may still show the optimistic React Query
    // entry whose ID is a client-side `temp-...` placeholder.
    let pendingBefore: PendingTransaction | undefined;
    const restDeadline = Date.now() + 30_000;
    while (Date.now() < restDeadline) {
      const pending = await getPendingTransactionsRest(
        page,
        wallet.walletId,
        ctx.signerAddresses[0]!,
      );
      if (pending.length === 1) {
        pendingBefore = pending[0];
        break;
      }
      await page.waitForTimeout(2_000);
    }
    if (!pendingBefore) {
      throw new Error(
        "Proposed transaction never appeared in /api/v1/pendingTransactions",
      );
    }
    const transactionId = pendingBefore.id;

    try {
      expect(pendingBefore.signedAddresses).toEqual([ctx.signerAddresses[0]!]);
      expect(pendingBefore.state).toBe(0);

      // Signer 1 opens the pending transaction but their wallet refuses to sign.
      await authenticateAs(page, 1);
      const updateTransactionRequests = countRequests(
        page,
        "transaction.updateTransaction",
      );
      await page.goto(`/wallets/${wallet.walletId}/transactions`);
      const signButton = page.locator(
        `[data-testid="sign-button-${transactionId}"]`,
      );
      await expect(signButton).toBeVisible({ timeout: 30_000 });

      // The pending card's token-flow section mounts lazily on first open;
      // its chain reads (resolving input provenance) are mocked.
      await mockTxFlowReads(page, wallet.address);
      await page.getByTestId(`tx-flow-toggle-${transactionId}`).click();
      await expect(
        page.getByTestId(`tx-flow-canvas-${transactionId}`),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.getByTestId(`tx-flow-node-txp:${transactionId}`),
      ).toBeVisible({ timeout: 30_000 });
      // Collapse again so the sign flow below is unaffected.
      await page.getByTestId(`tx-flow-toggle-${transactionId}`).click();

      await makeSignTxReject(page);
      await signButton.click();

      await expect(
        page.getByText("Error", { exact: true }).first(),
      ).toBeVisible({ timeout: 60_000 });
      // The card recovers: the signing action is still offered, not consumed.
      await expect(signButton).toBeEnabled({ timeout: 30_000 });

      // No update mutation fired and the DB record is unchanged: still only
      // the proposer's signature, nobody marked as rejected, still pending.
      expect(updateTransactionRequests()).toBe(0);
      const afterReject = await getPendingTransactionsRest(
        page,
        wallet.walletId,
        ctx.signerAddresses[1]!,
      );
      const pendingAfter = afterReject.find((tx) => tx.id === transactionId);
      expect(pendingAfter?.signedAddresses).toEqual([ctx.signerAddresses[0]!]);
      expect(pendingAfter?.rejectedAddresses ?? []).toEqual([]);
      expect(pendingAfter?.state).toBe(0);
    } finally {
      // Remove the intentionally-stranded pending transaction so reruns start
      // clean even though the wallet itself is throwaway.
      await trpcMutate(page, "transaction.deleteTransaction", {
        transactionId,
      }).catch(() => {});
    }
  });
});
