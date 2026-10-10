// Phase 2 (failure/access coverage): API-level helpers shared by the
// rejected-signing and wallet-access-control specs.
//
// - trpcMutate(): calls a tRPC mutation directly through the page's request
//   context (shares the mesh_wallet_session cookie), bypassing the UI. Used to
//   create throwaway wallets and clean up pending transactions.
// - createThrowawayWallet(): registers a fresh 2-of-3 wallet over the CI signer
//   addresses. Rejection tests create pending transactions and must never do
//   that on the bootstrap ring wallets — a leftover pending row would trip
//   ring-transfer's expectNoPendingTransactions() on a parallel worker.
// - getPendingTransactionsRest(): REST read of pending transactions, mirroring
//   the ring-transfer spec's verification path.

import type { Page } from "@playwright/test";
import jwt from "jsonwebtoken";
import type { CIBootstrapContext } from "./contextLoader";
const { sign } = jwt;

export type PendingTransaction = {
  id: string;
  signedAddresses?: string[];
  rejectedAddresses?: string[];
  state?: number;
};

export type ThrowawayWallet = {
  walletId: string;
  /** Script (enterprise) address the app derives for this wallet. */
  address: string;
};

/**
 * Calls a tRPC mutation via the page's cookie-authenticated request context.
 * Input is wrapped in the superjson batch envelope the app's tRPC client uses.
 */
export async function trpcMutate<T = unknown>(
  page: Page,
  procedure: string,
  input: unknown,
): Promise<T> {
  const response = await page.request.post(`/api/trpc/${procedure}?batch=1`, {
    headers: { "content-type": "application/json" },
    data: JSON.stringify({ "0": { json: input } }),
  });
  const body = await response.text();
  if (!response.ok()) {
    throw new Error(`${procedure} failed ${response.status()}: ${body}`);
  }
  type TrpcResultItem = {
    result?: { data?: { json?: T } };
    error?: unknown;
  };
  const parsed = JSON.parse(body) as TrpcResultItem | TrpcResultItem[];
  const item = Array.isArray(parsed) ? parsed[0] : parsed;
  if (item?.error) {
    throw new Error(`${procedure} error: ${JSON.stringify(item.error)}`);
  }
  return item?.result?.data?.json as T;
}

/**
 * Builds the same 2-of-3 atLeast native script buildWallet derives for a
 * legacy wallet (payment key hashes in signer order, no stake credential),
 * so the returned address matches what the app will display and query.
 */
export async function buildTwoOfThreeScript(
  signerAddresses: string[],
): Promise<{ scriptCbor: string; address: string }> {
  const { deserializeAddress, serializeNativeScript } = await import(
    "@meshsdk/core"
  );
  const nativeScript = {
    type: "atLeast" as const,
    required: 2,
    scripts: signerAddresses.map((address) => ({
      type: "sig" as const,
      keyHash: deserializeAddress(address).pubKeyHash,
    })),
  };
  const { scriptCbor, address } = serializeNativeScript(
    nativeScript,
    undefined,
    0,
  );
  if (!scriptCbor) {
    throw new Error("serializeNativeScript returned no scriptCbor");
  }
  return { scriptCbor, address };
}

/**
 * Creates an isolated legacy 2-of-3 wallet over the CI signer addresses via
 * tRPC. The wallet needs no funding: specs that use it mock the UTxO fetch,
 * and nothing is ever broadcast (threshold is never reached).
 *
 * With `withStakeKeys` the wallet also registers the CI signers' stake
 * addresses, which classifies it as an SDK wallet in the app (role-2 keys):
 * the staking and governance pages can then derive a stake address and
 * staking script for it. The returned `address` is still the payment-only
 * enterprise address; SDK wallets render their canonical stakeable address
 * instead, so UTxO mocks for those specs must match any address.
 */
export async function createThrowawayWallet(
  page: Page,
  ctx: CIBootstrapContext,
  name: string,
  options: { withStakeKeys?: boolean } = {},
): Promise<ThrowawayWallet> {
  const signers = ctx.signerAddresses.slice(0, 3);
  if (signers.length < 3) {
    throw new Error("Bootstrap context must provide at least 3 signer addresses");
  }
  let signersStakeKeys: string[] | null = null;
  if (options.withStakeKeys) {
    const stakeAddresses = (ctx.signerStakeAddresses ?? []).slice(0, 3);
    if (stakeAddresses.length < 3) {
      throw new Error(
        "Bootstrap context must provide 3 signer stake addresses (schemaVersion 3) for withStakeKeys",
      );
    }
    signersStakeKeys = stakeAddresses;
  }
  const { scriptCbor, address } = await buildTwoOfThreeScript(signers);
  const wallet = await trpcMutate<{ id: string }>(page, "wallet.createWallet", {
    name,
    description: "Throwaway wallet for Playwright failure-path coverage",
    signersAddresses: signers,
    signersDescriptions: ["Signer 1", "Signer 2", "Signer 3"],
    signersStakeKeys,
    signersDRepKeys: null,
    numRequiredSigners: 2,
    scriptCbor,
    type: "atLeast",
  });
  if (!wallet?.id) {
    throw new Error(`createWallet returned no wallet id: ${JSON.stringify(wallet)}`);
  }
  return { walletId: wallet.id, address };
}

/** Signs a short-lived REST bearer token for /api/v1 endpoints. */
export function buildRestToken(address: string): string {
  const jwtSecret = process.env.CI_JWT_SECRET;
  if (!jwtSecret) {
    throw new Error("CI_JWT_SECRET must be set to call /api/v1 endpoints");
  }
  return sign({ address }, jwtSecret, { expiresIn: "1h" });
}

export async function getPendingTransactionsRest(
  page: Page,
  walletId: string,
  signerAddress: string,
): Promise<PendingTransaction[]> {
  const response = await page.request.get(
    `/api/v1/pendingTransactions?walletId=${encodeURIComponent(walletId)}&address=${encodeURIComponent(signerAddress)}`,
    { headers: { Authorization: `Bearer ${buildRestToken(signerAddress)}` } },
  );
  if (!response.ok()) {
    throw new Error(
      `pendingTransactions failed ${response.status()}: ${await response.text().catch(() => "")}`,
    );
  }
  return (await response.json()) as PendingTransaction[];
}
