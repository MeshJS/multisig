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
import jwt from "jsonwebtoken";
const { sign } = jwt;

const LOVELACE = Number(process.env.CI_TRANSFER_LOVELACE ?? "2000000");
// The new-transaction form amount input expects ADA (lovelace / 1_000_000)
const ADA_AMOUNT = String(LOVELACE / 1_000_000);
const MIN_SOURCE_LOVELACE = LOVELACE + 500_000;

const LEGS: Array<{ name: string; srcType: CIWalletType; dstType: CIWalletType }> = [
  { name: "legacy → hierarchical", srcType: "legacy",       dstType: "hierarchical" },
  { name: "hierarchical → sdk",    srcType: "hierarchical", dstType: "sdk"          },
  { name: "sdk → legacy",          srcType: "sdk",          dstType: "legacy"       },
];

type BlockfrostUtxo = {
  tx_hash?: string;
  output_index?: number;
  amount?: Array<{ unit: string; quantity: string }>;
  address?: string;
  data_hash?: string | null;
  inline_datum?: string | null;
  reference_script_hash?: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchBlockfrostUtxos(address: string): Promise<BlockfrostUtxo[]> {
  const apiKey = process.env.CI_BLOCKFROST_PREPROD_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CI_BLOCKFROST_PREPROD_API_KEY must be set");
  }

  const response = await fetch(
    `https://cardano-preprod.blockfrost.io/api/v0/addresses/${encodeURIComponent(address)}/utxos?count=100&order=desc`,
    {
      headers: {
        project_id: apiKey,
      },
    },
  );

  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(
      `Blockfrost UTxO fetch failed ${response.status}: ${await response.text().catch(() => "")}`,
    );
  }
  return (await response.json()) as BlockfrostUtxo[];
}

function totalLovelace(utxos: BlockfrostUtxo[]): number {
  return utxos.reduce((sum, utxo) => {
    const lovelace = utxo.amount?.find((asset) => asset.unit === "lovelace");
    return sum + Number(lovelace?.quantity ?? 0);
  }, 0);
}

async function waitForSpendableUtxos(
  address: string,
  minLovelace: number,
  timeoutMs = 180_000,
): Promise<BlockfrostUtxo[]> {
  const deadline = Date.now() + timeoutMs;
  let lastBalance = 0;

  while (Date.now() < deadline) {
    const utxos = await fetchBlockfrostUtxos(address).catch(() => []);
    lastBalance = totalLovelace(utxos);
    if (utxos.length > 0 && lastBalance >= minLovelace) {
      return utxos;
    }
    await sleep(10_000);
  }

  throw new Error(
    `Wallet ${address} did not expose spendable UTxOs >= ${minLovelace} lovelace after ${timeoutMs}ms; last balance was ${lastBalance}`,
  );
}

async function mockBrowserUtxoFetch(
  page: Page,
  address: string,
  utxos: BlockfrostUtxo[],
  diagnostics: string[],
): Promise<void> {
  const encodedAddress = encodeURIComponent(address);
  const addressPath = `/addresses/${encodedAddress}/utxos`;
  const rawAddressPath = `/addresses/${address}/utxos`;

  await page.unroute("**/addresses/*/utxos**").catch(() => {});
  await page.route("**/addresses/*/utxos**", async (route) => {
    const url = new URL(route.request().url());
    diagnostics.push(`utxo route saw ${url.href}`);
    if (
      url.pathname === addressPath ||
      url.pathname === rawAddressPath ||
      url.pathname.endsWith(addressPath) ||
      url.pathname.endsWith(rawAddressPath)
    ) {
      diagnostics.push(`utxo route fulfilled ${url.href} with ${utxos.length} utxos`);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(utxos),
      });
      return;
    }

    await route.fallback();
  });
}

async function waitForUtxoSelectorLoaded(
  page: Page,
  newTransactionUrl: string,
  diagnostics: string[],
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    diagnostics.push(`loading new transaction page attempt ${attempt}`);
    await page.goto(newTransactionUrl);
    await page.waitForLoadState("networkidle", { timeout: 60_000 }).catch(() => {});

    const loaded = await page
      .waitForSelector('[data-testid="utxo-selector"][data-loaded="true"]', {
        timeout: 60_000,
      })
      .then(() => true)
      .catch(() => false);

    if (loaded) {
      diagnostics.push(`utxo selector loaded on attempt ${attempt}`);
      return;
    }

    const state = await page
      .evaluate(() => {
        const selector = document.querySelector('[data-testid="utxo-selector"]');
        return {
          href: window.location.href,
          selectorExists: !!selector,
          selectorLoaded: selector?.getAttribute("data-loaded") ?? null,
          bodyText: document.body.innerText.slice(0, 2000),
        };
      })
      .catch((error) => ({ evaluateError: String(error) }));
    diagnostics.push(`attempt ${attempt} page state: ${JSON.stringify(state)}`);
  }

  throw new Error(
    `UTxO selector did not finish loading after 3 page loads\n${diagnostics.join("\n")}`,
  );
}

async function waitForSelectedInputUtxos(
  page: Page,
  diagnostics: string[],
): Promise<void> {
  const selectedCount = await page
    .waitForFunction(
      () => {
        const match = document.body.innerText.match(/Input UTxOs \((\d+)\)/);
        const count = match ? Number(match[1]) : 0;
        return count > 0 ? count : false;
      },
      { timeout: 30_000 },
    )
    .then((handle) => handle.jsonValue() as Promise<number>)
    .catch(async () => {
      await page
        .getByRole("button", { name: /select multisig utxos/i })
        .click({ timeout: 2_000 })
        .catch(() => {});

      const state = await page
        .evaluate(() => ({
          href: window.location.href,
          bodyText: document.body.innerText.slice(0, 4000),
        }))
        .catch((error) => ({ evaluateError: String(error) }));

      throw new Error(
        `No input UTxOs were selected before submit.\n${diagnostics.join("\n")}\npage state: ${JSON.stringify(state)}`,
      );
    });

  diagnostics.push(`input utxos selected=${selectedCount}`);
}

async function getPendingTransactions(
  page: Page,
  walletId: string,
  signerAddress: string,
): Promise<Array<{ id: string }>> {
  const jwtSecret = process.env.CI_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("CI_JWT_SECRET must be set to verify pending transactions");
  }
  const token = sign({ address: signerAddress }, jwtSecret, { expiresIn: "1h" });
  const resp = await page.request.get(
    `/api/v1/pendingTransactions?walletId=${encodeURIComponent(walletId)}&address=${encodeURIComponent(signerAddress)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );
  if (!resp.ok()) {
    throw new Error(
      `pendingTransactions failed ${resp.status()}: ${await resp.text().catch(() => "")}`,
    );
  }
  return (await resp.json()) as Array<{ id: string }>;
}

async function expectNoPendingTransactions(
  page: Page,
  walletId: string,
  signerAddress: string,
): Promise<void> {
  const transactions = await getPendingTransactions(page, walletId, signerAddress);
  if (transactions.length > 0) {
    throw new Error(
      `Wallet ${walletId} has ${transactions.length} pending transaction(s) before this leg: ${transactions
        .map((transaction) => transaction.id)
        .join(", ")}. Reset the Playwright stack with docker compose -f docker-compose.playwright.yml --env-file .env.playwright down -v --remove-orphans, then rerun bootstrap.`,
    );
  }
}

// Poll /api/v1/pendingTransactions until the given tx ID is no longer listed,
// indicating the broadcast was accepted and the DB record updated.
async function waitForTxCleared(
  page: Page,
  walletId: string,
  signerAddress: string,
  txId: string,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const transactions = await getPendingTransactions(page, walletId, signerAddress);
    if (!transactions.some((t) => t.id === txId)) return;
    await page.waitForTimeout(5_000);
  }
  throw new Error(
    `Transaction ${txId} still pending in wallet ${walletId} after ${timeoutMs}ms`,
  );
}

test.describe.serial("ring transfer", () => {
  for (const leg of LEGS) {
    test(`ring transfer: ${leg.name}`, async ({ page, authenticateAs }) => {
      test.setTimeout(600_000);

      const ctx = loadContext();
      const srcWallet = getWallet(ctx, leg.srcType);
      const dstWallet = getWallet(ctx, leg.dstType);
      const diagnostics: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") {
          diagnostics.push(`browser console ${message.type()}: ${message.text()}`);
        }
      });
      page.on("pageerror", (error) => {
        diagnostics.push(`browser pageerror: ${error.message}`);
      });

      // ── Step 1: Proposer (signer 0) creates the transaction ───────────────
      await authenticateAs(page, 0);
      await expectNoPendingTransactions(
        page,
        srcWallet.walletId,
        ctx.signerAddresses[0]!,
      );

      const sourceUtxos = await waitForSpendableUtxos(
        srcWallet.walletAddress,
        MIN_SOURCE_LOVELACE,
      );
      diagnostics.push(
        `source ${srcWallet.walletAddress} visible utxos=${sourceUtxos.length} lovelace=${totalLovelace(sourceUtxos)}`,
      );
      await mockBrowserUtxoFetch(
        page,
        srcWallet.walletAddress,
        sourceUtxos,
        diagnostics,
      );
      await waitForUtxoSelectorLoaded(
        page,
        `/wallets/${srcWallet.walletId}/transactions/new`,
        diagnostics,
      );

      // Fill first recipient row (index 0)
      await page.fill(`[data-testid="recipient-address-input-0"]`, dstWallet.walletAddress);
      await page.fill(`[data-testid="amount-input-0"]`, ADA_AMOUNT);
      await waitForSelectedInputUtxos(page, diagnostics);

      // The layout re-checks the wallet session on every full-page navigation.
      // If the WalletAuthModal appears (session check returned unauthorized), wait for
      // it to auto-close — with autoAuthorize=true and the wallet mock connected it
      // signs and closes within a few seconds.  waitForFunction returns immediately
      // when no dialog is present so this adds negligible delay in the happy path.
      await page.waitForFunction(
        () => document.querySelectorAll('[role="dialog"][data-state="open"]').length === 0,
        { timeout: 30_000 },
      ).catch(() => {});

      // Submit — the hook calls activeWallet.signTx (bridges to meshSign) then
      // calls createTransaction tRPC mutation and redirects to transactions page.
      const createTransactionResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/trpc/transaction.createTransaction") &&
          response.request().method() === "POST",
        { timeout: 90_000 },
      );
      await page.click('[data-testid="create-transaction-button"]');

      const createTransactionResponse = await createTransactionResponsePromise;
      expect(
        createTransactionResponse.ok(),
        `createTransaction failed ${createTransactionResponse.status()}: ${await createTransactionResponse.text().catch(() => "")}`,
      ).toBe(true);

      const transactionsUrl = `/wallets/${srcWallet.walletId}/transactions`;
      await page.goto(transactionsUrl);
      await expect(page).toHaveURL(new RegExp(`/wallets/${srcWallet.walletId}/transactions$`));
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
      const updateTransactionResponsePromise = page.waitForResponse(
        (response) =>
          response.url().includes("/api/trpc/transaction.updateTransaction") &&
          response.request().method() === "POST",
        { timeout: 90_000 },
      );
      await page.click(`[data-testid="sign-button-${transactionId}"]`);

      // Wait for the broadcast success indicator (appears when submitTxWithScriptRecovery succeeds)
      await page.waitForSelector('[data-testid="tx-broadcast-success"]', {
        timeout: 90_000,
      });

      const updateTransactionResponse = await updateTransactionResponsePromise;
      expect(
        updateTransactionResponse.ok(),
        `updateTransaction failed ${updateTransactionResponse.status()}: ${await updateTransactionResponse.text().catch(() => "")}`,
      ).toBe(true);

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
      await waitForTxCleared(
        page,
        srcWallet.walletId,
        ctx.signerAddresses[1]!,
        transactionId,
        60_000,
      );
    });
  }
});
