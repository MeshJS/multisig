import type { PrismaClient } from "@prisma/client";
import type { BlockfrostProvider } from "@meshsdk/core";

import type { AssetMetadataMap } from "@/components/common/token-flow/format";
import { parseProposalId } from "@/lib/governance";
import { ballotTitleMap } from "@/lib/governance/proposal-titles";
import { fetchProposalMetadataWithFallback } from "@/lib/governance/proposalMetadata";
import type { ProposalDetails } from "@/types/governance";
import { cachedGetAssetMetadata } from "@/utils/blockchain-cache";

/**
 * Lookups that turn on-chain identifiers into the words a human recognises:
 * asset tickers and decimals, pool names, proposal titles. Every one is
 * best-effort with a cap and a budget — a slow registry must degrade the card
 * to raw identifiers, never fail the review.
 */

const MAX_ASSET_LOOKUPS = 20;
const MAX_POOL_LOOKUPS = 5;
const MAX_TITLE_LOOKUPS = 10;
const GOV_BALLOT_TYPE = 1;

type BlockfrostAsset = {
  asset_name?: string | null;
  policy_id?: string;
  metadata?: { ticker?: string | null; name?: string | null; decimals?: number | null } | null;
  onchain_metadata?: { name?: string | null } | null;
};

function withBudget<T>(promise: Promise<T>, budgetMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), budgetMs);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function hexToAscii(hex: string): string {
  try {
    const text = Buffer.from(hex, "hex").toString("utf8");
    return /^[\x20-\x7e]+$/.test(text) ? text : "";
  } catch {
    return "";
  }
}

export type ResolvedAssetMetadata = {
  /** Display metadata; unknown decimals default to 0 here. */
  metadata: AssetMetadataMap;
  /**
   * Registered decimals, or undefined when the token registry has none —
   * kept apart from the display default so a display→base conversion can
   * refuse to guess a token's scale.
   */
  decimalsFor: (unit: string) => number | undefined;
};

export async function resolveAssetMetadata(
  provider: BlockfrostProvider,
  units: string[],
  network: number,
  opts: { budgetMs?: number } = {},
): Promise<ResolvedAssetMetadata> {
  const metadata: AssetMetadataMap = {};
  const known = new Map<string, number>();
  const targets = [...new Set(units)].slice(0, MAX_ASSET_LOOKUPS);
  await Promise.all(
    targets.map(async (unit) => {
      const info = await withBudget(
        cachedGetAssetMetadata(provider, unit, network) as Promise<BlockfrostAsset | null>,
        opts.budgetMs ?? 4000,
        null,
      );
      const policyId = unit.slice(0, 56);
      const assetNameHex = info?.asset_name ?? unit.slice(56);
      const ascii = hexToAscii(assetNameHex ?? "");
      const decimals = info?.metadata?.decimals;
      if (typeof decimals === "number") known.set(unit, decimals);
      metadata[unit] = {
        policyId,
        assetName:
          info?.onchain_metadata?.name || info?.metadata?.name || ascii || assetNameHex || unit,
        ticker: info?.metadata?.ticker || ascii || "",
        decimals: typeof decimals === "number" ? decimals : 0,
        image: "",
      };
    }),
  );
  return { metadata, decimalsFor: (unit) => known.get(unit) };
}

/** Bech32 pool id → "[TICKER] Name", mirroring `usePoolNames`. */
export async function resolvePoolNames(
  provider: BlockfrostProvider,
  poolIds: string[],
  opts: { budgetMs?: number } = {},
): Promise<(poolId: string) => string | undefined> {
  const names = new Map<string, string>();
  await Promise.all(
    [...new Set(poolIds)].slice(0, MAX_POOL_LOOKUPS).map(async (poolId) => {
      const metadata = await withBudget(
        provider.get(`/pools/${poolId}/metadata`) as Promise<
          { name?: string | null; ticker?: string | null } | null
        >,
        opts.budgetMs ?? 4000,
        null,
      );
      const name = metadata?.name?.trim();
      const ticker = metadata?.ticker?.trim();
      const label = ticker && name ? `[${ticker}] ${name}` : name || (ticker ? `[${ticker}]` : "");
      if (label) names.set(poolId, label);
    }),
  );
  return (poolId) => names.get(poolId);
}

/**
 * "txHash#index" → proposal title. The wallet's own ballots first (they
 * store titles next to each item, zero network cost), then Blockfrost with
 * the IPFS gateway fallback under a shared budget.
 */
export async function resolveProposalTitles(
  db: PrismaClient,
  provider: BlockfrostProvider,
  walletId: string,
  proposalIds: string[],
  opts: { budgetMs?: number } = {},
): Promise<(proposalId: string) => string | undefined> {
  const ids = [...new Set(proposalIds)];
  if (ids.length === 0) return () => undefined;

  let titles = new Map<string, string>();
  try {
    const ballots = await db.ballot.findMany({
      where: { walletId, type: GOV_BALLOT_TYPE },
      orderBy: { createdAt: "desc" },
      select: { items: true, itemDescriptions: true },
    });
    titles = ballotTitleMap(ballots);
  } catch {
    // Ballot rows are a courtesy source; fall through to the chain.
  }

  const missing = ids.filter((id) => !titles.has(id)).slice(0, MAX_TITLE_LOOKUPS);
  const budgetMs = opts.budgetMs ?? 5000;
  await Promise.all(
    missing.map(async (id) => {
      let parsed: { txHash: string; certIndex: number };
      try {
        parsed = parseProposalId(id);
      } catch {
        return;
      }
      const metadata = await withBudget(
        fetchProposalMetadataWithFallback({
          provider,
          proposal: {
            tx_hash: parsed.txHash,
            cert_index: parsed.certIndex,
            governance_type: "",
          },
          fetchDetails: async () =>
            (await provider
              .get(`/governance/proposals/${parsed.txHash}/${parsed.certIndex}`)
              .catch(() => null)) as ProposalDetails | null,
        }),
        budgetMs,
        null,
      );
      const title = metadata?.json_metadata?.body?.title?.trim();
      if (title && title !== "Metadata could not be loaded.") titles.set(id, title);
    }),
  );

  return (proposalId) => titles.get(proposalId);
}
