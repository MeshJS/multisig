// Phase 3 (product-area browser coverage): shared browser-side mocks for the
// staking, governance, proxy, bot, and notification specs.
//
// These specs run against throwaway wallets that are never funded, so every
// chain read the pages perform is intercepted in the browser:
//   - address UTxOs   -> one large fake UTxO, echoing whatever address the
//                        page asked about (SDK wallets render their canonical
//                        stakeable address, which the specs never compute)
//   - account state   -> deterministic staking state (active / inactive)
//   - governance      -> fixed proposal list + metadata, no registered DRep
//   - stake pool list -> empty (specs enter the pool id manually)
//
// Nothing is ever broadcast: the throwaway wallets have a 2-of-3 threshold and
// only signer 0 ever signs, so proposals stay pending and are deleted in
// cleanup.

import type { Page } from "@playwright/test";
import { loadContext, type CIBootstrapContext } from "./contextLoader";
import {
  getPendingTransactionsRest,
  type PendingTransaction,
} from "./apiHelpers";

export const FAKE_UTXO_TX_HASH = "3".repeat(64);

/**
 * Serves one fake UTxO for every address the page asks about, echoing the
 * requested address back so the UTxO always matches the address the app
 * queried (throwaway SDK wallets display a stakeable address the spec never
 * derives). Page 2+ returns [] so BlockfrostProvider pagination terminates.
 *
 * The default 600 ADA covers the DRep registration deposit (500 ADA), the
 * stake registration deposit (2 ADA), and fees for every Phase 3 proposal.
 */
export async function mockWalletUtxos(
  page: Page,
  options: { lovelace?: string } = {},
): Promise<void> {
  const lovelace = options.lovelace ?? "600000000";
  await page.route(/\/addresses\/[^/]+\/utxos/, async (route) => {
    const url = new URL(route.request().url());
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    const segments = url.pathname.split("/");
    const address = decodeURIComponent(
      segments[segments.indexOf("addresses") + 1] ?? "",
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        pageNumber === 1
          ? [
              {
                address,
                tx_hash: FAKE_UTXO_TX_HASH,
                output_index: 0,
                amount: [{ unit: "lovelace", quantity: lovelace }],
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

/**
 * Mocks the Blockfrost `/accounts/{stakeAddress}` read the staking page uses.
 * `active: false` exposes the RegisterAndDelegate action; `active: true`
 * exposes Delegate + Deregister instead.
 */
export async function mockAccountState(
  page: Page,
  options: { active: boolean; poolId?: string | null; rewards?: string },
): Promise<void> {
  await page.route(/\/accounts\/[^/]+$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stake_address: "mocked",
        active: options.active,
        pool_id: options.poolId ?? null,
        controlled_amount: "600000000",
        rewards_sum: options.rewards ?? "0",
        withdrawals_sum: "0",
        reserves_sum: "0",
        treasury_sum: "0",
        drep_id: null,
      }),
    });
  });
}

/** Mocks `/pools/extended` so PoolSelector renders without live Blockfrost. */
export async function mockPoolList(page: Page): Promise<void> {
  await page.route(/\/pools\/extended/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify([]),
    });
  });
}

export const MOCK_PROPOSAL_TX_HASH = "4".repeat(64);
export const MOCK_PROPOSAL_TITLE = "CI Mock Proposal";

/**
 * Mocks the governance reads the governance page performs:
 *   - `/governance/proposals?...`         -> a single mock info action
 *   - `/governance/proposals/{tx}/{idx}`  -> minimal details
 *   - `.../metadata`                      -> metadata carrying MOCK_PROPOSAL_TITLE
 *   - `/governance/dreps/...`             -> 404, i.e. the wallet DRep is not
 *                                            registered (Register enabled,
 *                                            Update/Retire disabled)
 */
export async function mockGovernanceState(page: Page): Promise<void> {
  await page.route(/\/governance\/(proposals|dreps)/, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    if (path.includes("/governance/dreps")) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ status_code: 404, error: "Not Found", message: "" }),
      });
      return;
    }

    if (path.endsWith("/metadata")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tx_hash: MOCK_PROPOSAL_TX_HASH,
          cert_index: 0,
          governance_type: "info_action",
          hash: "0".repeat(64),
          url: "https://example.com/ci-mock-proposal.jsonld",
          bytes: "",
          json_metadata: {
            body: {
              title: MOCK_PROPOSAL_TITLE,
              abstract: "Mock proposal served by the Playwright governance spec.",
              motivation: "",
              rationale: "",
              references: [],
            },
            authors: [],
          },
        }),
      });
      return;
    }

    // Details for a single proposal: /governance/proposals/{tx_hash}/{cert_index}
    if (/\/governance\/proposals\/[^/]+\/\d+$/.test(path)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          tx_hash: MOCK_PROPOSAL_TX_HASH,
          cert_index: 0,
          governance_type: "info_action",
          governance_description: { tag: "InfoAction" },
          deposit: "100000000",
          return_address: "stake_test1mocked",
          expiration: 999,
          id: `gov_action1${"q".repeat(50)}`,
        }),
      });
      return;
    }

    // Proposal list: page 1 has the mock proposal, later pages are empty.
    const pageNumber = Number(url.searchParams.get("page") ?? "1");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        pageNumber === 1
          ? [
              {
                tx_hash: MOCK_PROPOSAL_TX_HASH,
                cert_index: 0,
                governance_type: "info_action",
                ratified_epoch: null,
                enacted_epoch: null,
                dropped_epoch: null,
                expired_epoch: null,
                expiration: 999,
              },
            ]
          : [],
      ),
    });
  });
}

/**
 * Resolves the stake pool id (hex) for staking specs: prefer the bootstrap
 * context (written by scripts/ci bootstrap from CI_STAKE_POOL_ID_HEX), fall
 * back to the env var directly, and normalize a bech32 `pool1...` value to
 * hex so either form works.
 */
export async function resolveStakePoolHex(
  ctx: CIBootstrapContext,
): Promise<string> {
  const raw = (ctx.stakePoolIdHex ?? process.env.CI_STAKE_POOL_ID_HEX ?? "").trim();
  if (!raw) {
    throw new Error(
      "CI_STAKE_POOL_ID_HEX must be set (env or bootstrap context) for the staking spec",
    );
  }
  if (raw.startsWith("pool1")) {
    const { deserializePoolId } = await import("@meshsdk/core");
    return deserializePoolId(raw);
  }
  return raw;
}

/**
 * Polls the REST pending-transactions endpoint until exactly one transaction
 * is pending for the wallet, then returns it. Mirrors the rejected-signing
 * spec: right after creation the rendered card may still be the optimistic
 * `temp-...` React Query entry, so the DB id must come from the API.
 */
export async function waitForSinglePendingTransaction(
  page: Page,
  walletId: string,
  signerAddress: string,
  timeoutMs = 30_000,
): Promise<PendingTransaction> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Transient request failures (socket hang up under load) just mean
    // "poll again" — only the deadline is fatal.
    const pending = await getPendingTransactionsRest(
      page,
      walletId,
      signerAddress,
    ).catch(() => null);
    if (pending?.length === 1) return pending[0]!;
    await page.waitForTimeout(2_000);
  }
  throw new Error(
    "Proposed transaction never appeared in /api/v1/pendingTransactions",
  );
}

export { loadContext };
