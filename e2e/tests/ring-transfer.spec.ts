// Phase 4: Full browser-driven ring transfer test.
//
// Three sequential legs share the same preprod wallets and run in order to
// avoid UTxO conflicts.  Each leg:
//   1. Proposer (signer 0) creates the transaction via the UI — the proposer
//      auto-signs during creation (1 of 2 required signatures).
//   2. Signer 1 opens the transactions page and clicks "Approve & Sign" —
//      this reaches the 2-of-3 threshold and triggers an on-chain broadcast.
//   3. Test asserts the tx-broadcast-success indicator appears and the card
//      disappears from pending.

import { test, expect } from "../fixtures/authFixture";
import { loadContext, getWallet } from "../helpers/contextLoader";
import type { CIWalletType } from "../helpers/contextLoader";
import type { Page } from "@playwright/test";

const LOVELACE = Number(process.env.CI_TRANSFER_LOVELACE ?? "2000000");
// The new-transaction form amount input expects ADA (lovelace / 1_000_000)
const ADA_AMOUNT = String(LOVELACE / 1_000_000);

const LEGS: Array<{ name: string; srcType: CIWalletType; dstType: CIWalletType }> = [
  { name: "legacy → hierarchical", srcType: "legacy",       dstType: "hierarchical" },
  { name: "hierarchical → sdk",    srcType: "hierarchical", dstType: "sdk"          },
  { name: "sdk → legacy",          srcType: "sdk",          dstType: "legacy"       },
];

// Poll /api/v1/pendingTransactions until the given tx ID is no longer listed,
// indicating the broadcast was accepted and the DB record updated.
async function waitForTxCleared(
  page: Page,
  walletId: string,
  txId: string,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await page.request.get(
      `/api/v1/pendingTransactions?walletId=${walletId}`,
    );
    if (resp.ok()) {
      const data = (await resp.json()) as { transactions?: Array<{ id: string }> };
      if (!data.transactions?.some((t) => t.id === txId)) return;
    }
    await page.waitForTimeout(5_000);
  }
  throw new Error(
    `Transaction ${txId} still pending in wallet ${walletId} after ${timeoutMs}ms`,
  );
}

test.describe.serial("ring transfer", () => {
  for (const leg of LEGS) {
    test(`ring transfer: ${leg.name}`, async ({ page, authenticateAs }) => {
      const ctx = loadContext();
      const srcWallet = getWallet(ctx, leg.srcType);
      const dstWallet = getWallet(ctx, leg.dstType);

      // ── Step 1: Proposer (signer 0) creates the transaction ───────────────
      await authenticateAs(page, 0);

      await page.goto(`/wallets/${srcWallet.walletId}/transactions/new`);
      // networkidle captures the blockfrost UTxO fetch that goes through /api/blockfrost/...
      await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});

      // Wait for the UTxO selector to finish auto-loading and auto-selecting UTxOs
      await page.waitForSelector('[data-testid="utxo-selector"][data-loaded="true"]', {
        timeout: 60_000,
      });

      // Fill first recipient row (index 0)
      await page.fill(`[data-testid="recipient-address-input-0"]`, dstWallet.walletAddress);
      await page.fill(`[data-testid="amount-input-0"]`, ADA_AMOUNT);

      // Submit — the hook calls activeWallet.signTx (bridges to meshSign) then
      // calls createTransaction tRPC mutation and redirects to transactions page.
      await page.click('[data-testid="create-transaction-button"]');

      await page.waitForURL(`**/${srcWallet.walletId}/transactions`, {
        timeout: 90_000,
      });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

      // Extract the newly created transaction's ID from the first pending tx card
      const txCard = page.locator('[data-testid^="tx-card-"]').first();
      await txCard.waitFor({ state: "visible", timeout: 30_000 });
      const cardTestId = await txCard.getAttribute("data-testid");
      const transactionId = cardTestId!.replace("tx-card-", "");
      expect(transactionId).toBeTruthy();

      // ── Step 2: Signer 1 signs → broadcast (threshold 2-of-3 now met) ─────
      await authenticateAs(page, 1);

      await page.goto(`/wallets/${srcWallet.walletId}/transactions`);
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

      // Confirm the tx card is still pending (proposer signed, threshold not yet met)
      await page.waitForSelector(`[data-testid="tx-card-${transactionId}"]`, {
        timeout: 20_000,
      });

      // Sign — this will call signTx(), reach the 2-of-3 threshold, submit on-chain,
      // and set broadcastDone=true which renders the tx-broadcast-success indicator.
      await page.click(`[data-testid="sign-button-${transactionId}"]`);

      // Wait for the broadcast success indicator (appears when submitTxWithScriptRecovery succeeds)
      await page.waitForSelector('[data-testid="tx-broadcast-success"]', {
        timeout: 90_000,
      });

      // The pending tx card should be removed once the updateTransaction mutation
      // invalidates getPendingTransactions and the list refetches.
      await page
        .waitForSelector(`[data-testid="tx-card-${transactionId}"]`, {
          state: "detached",
          timeout: 30_000,
        })
        .catch(() => {
          // If the card hasn't detached yet, also poll the REST API as a fallback
        });

      // REST-level verification — confirms the DB record is no longer pending
      await waitForTxCleared(page, srcWallet.walletId, transactionId, 60_000);
    });
  }
});
