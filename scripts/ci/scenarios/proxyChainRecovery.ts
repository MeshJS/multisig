import { PrismaClient, type Proxy as DbProxy } from "@prisma/client";
import { BlockfrostProvider, type UTxO } from "@meshsdk/core";
import { deriveProxyScripts } from "../../../src/lib/server/proxyTxBuilders";
import type { UtxoRef } from "../../../src/lib/server/proxyUtxos";
import type { CIBootstrapContext, CIWalletType } from "../framework/types";
import { getWalletByType } from "./steps/helpers";

type ProxyRecoveryRow = Pick<
  DbProxy,
  "id" | "walletId" | "proxyAddress" | "authTokenId" | "paramUtxo" | "isActive"
>;

type ProxyRecoveryCreateData = {
  walletId: string;
  proxyAddress: string;
  authTokenId: string;
  paramUtxo: string;
  description: string;
  isActive: true;
};

type ProxyRecoveryDb = {
  wallet: {
    findUnique: (args: {
      where: { id: string };
      select: { id: true };
    }) => Promise<{ id: string } | null>;
  };
  proxy: {
    findFirst: (args: {
      where: { authTokenId: string };
      select: Record<keyof ProxyRecoveryRow, true>;
    }) => Promise<ProxyRecoveryRow | null>;
    create: (args: {
      data: ProxyRecoveryCreateData;
      select: Record<keyof ProxyRecoveryRow, true>;
    }) => Promise<ProxyRecoveryRow>;
    update: (args: {
      where: { id: string };
      data: { walletId: string; isActive: true };
      select: Record<keyof ProxyRecoveryRow, true>;
    }) => Promise<ProxyRecoveryRow>;
  };
  $transaction?: <T>(fn: (tx: ProxyRecoveryDb) => Promise<T>) => Promise<T>;
};

export type ProxyChainRecoveryProvider = {
  fetchAddressUTxOs: (address: string) => Promise<UTxO[]>;
  get: (path: string) => Promise<unknown>;
};

type AssetHistoryEntry = {
  tx_hash?: string;
  action?: string;
};

type TxUtxoEntry = {
  tx_hash?: string;
  output_index?: number;
};

type TxUtxosResponse = {
  inputs?: TxUtxoEntry[];
};

export type ProxyChainRecoverySkipReason =
  | "candidate-cap-exceeded"
  | "asset-history-fetch-error"
  | "no-mint-transaction"
  | "tx-utxos-fetch-error"
  | "no-derived-match"
  | "already-current-active";

export type ProxyChainRecoveryResult = {
  walletType: CIWalletType;
  walletId: string;
  walletAddress: string;
  recovered: Array<{
    proxyId: string;
    action: "created" | "reactivated" | "reattached";
    fromWalletId: string | null;
    authTokenId: string;
    proxyAddress: string;
    paramUtxo: UtxoRef;
    mintTxHash: string;
    dRepId: string;
    proxyUtxoCount?: number;
  }>;
  skipped: Array<{
    assetUnit: string;
    reason: ProxyChainRecoverySkipReason;
    detail?: string;
  }>;
};

const DEFAULT_MAX_CANDIDATES = 25;
const ASSET_HISTORY_PAGE_SIZE = 100;

const proxySelect: Record<keyof ProxyRecoveryRow, true> = {
  id: true,
  walletId: true,
  proxyAddress: true,
  authTokenId: true,
  paramUtxo: true,
  isActive: true,
};

let defaultDb: PrismaClient | undefined;

function getDefaultDb(): PrismaClient {
  defaultDb ??= new PrismaClient();
  return defaultDb;
}

function createDefaultProvider(networkId: 0 | 1): ProxyChainRecoveryProvider {
  const apiKey =
    networkId === 0
      ? process.env.CI_BLOCKFROST_PREPROD_API_KEY?.trim() ||
        process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD?.trim()
      : process.env.CI_BLOCKFROST_MAINNET_API_KEY?.trim() ||
        process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET?.trim();
  if (!apiKey) {
    throw new Error(`Missing Blockfrost API key for proxy chain recovery on network ${networkId}`);
  }
  return new BlockfrostProvider(apiKey) as unknown as ProxyChainRecoveryProvider;
}

async function runInTransaction<T>(
  db: ProxyRecoveryDb,
  fn: (tx: ProxyRecoveryDb) => Promise<T>,
): Promise<T> {
  if (typeof db.$transaction === "function") {
    return db.$transaction(fn);
  }
  return fn(db);
}

function positiveQuantity(quantity: string | undefined): boolean {
  try {
    return BigInt(quantity ?? "0") > 0n;
  } catch {
    return false;
  }
}

function collectAssetUnits(utxos: UTxO[]): string[] {
  const units = new Set<string>();
  for (const utxo of utxos) {
    for (const asset of utxo.output.amount) {
      if (asset.unit !== "lovelace" && positiveQuantity(asset.quantity)) {
        units.add(asset.unit);
      }
    }
  }
  return [...units].sort();
}

function normalizeAssetHistory(value: unknown): AssetHistoryEntry[] {
  return Array.isArray(value) ? (value as AssetHistoryEntry[]) : [];
}

function normalizeTxUtxos(value: unknown): TxUtxosResponse {
  return typeof value === "object" && value !== null ? (value as TxUtxosResponse) : {};
}

function findMintTxHash(history: AssetHistoryEntry[]): string | null {
  const mint = history.find(
    (entry) => entry.action === "minted" && typeof entry.tx_hash === "string" && entry.tx_hash,
  );
  return mint?.tx_hash ?? null;
}

function inputToRef(input: TxUtxoEntry): UtxoRef | null {
  const txHash = typeof input.tx_hash === "string" ? input.tx_hash.trim() : "";
  const outputIndex =
    typeof input.output_index === "number" && Number.isInteger(input.output_index)
      ? input.output_index
      : -1;
  if (!txHash || outputIndex < 0) return null;
  return { txHash, outputIndex };
}

async function inspectAssetCandidate(args: {
  assetUnit: string;
  provider: ProxyChainRecoveryProvider;
  network: 0 | 1;
}): Promise<
  | {
      matched: true;
      authTokenId: string;
      proxyAddress: string;
      paramUtxo: UtxoRef;
      mintTxHash: string;
      dRepId: string;
      proxyUtxoCount?: number;
    }
  | { matched: false; reason: ProxyChainRecoverySkipReason; detail?: string }
> {
  let history: AssetHistoryEntry[];
  try {
    history = normalizeAssetHistory(
      await args.provider.get(
        `/assets/${encodeURIComponent(args.assetUnit)}/history?order=asc&count=${ASSET_HISTORY_PAGE_SIZE}`,
      ),
    );
  } catch (error) {
    return {
      matched: false,
      reason: "asset-history-fetch-error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const mintTxHash = findMintTxHash(history);
  if (!mintTxHash) {
    return { matched: false, reason: "no-mint-transaction" };
  }

  let txUtxos: TxUtxosResponse;
  try {
    txUtxos = normalizeTxUtxos(
      await args.provider.get(`/txs/${encodeURIComponent(mintTxHash)}/utxos`),
    );
  } catch (error) {
    return {
      matched: false,
      reason: "tx-utxos-fetch-error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const inputs = Array.isArray(txUtxos.inputs) ? txUtxos.inputs : [];
  for (const input of inputs) {
    const paramUtxo = inputToRef(input);
    if (!paramUtxo) continue;

    const scripts = deriveProxyScripts({ paramUtxo, network: args.network });
    if (scripts.authTokenId !== args.assetUnit) continue;

    let proxyUtxoCount: number | undefined;
    try {
      proxyUtxoCount = (await args.provider.fetchAddressUTxOs(scripts.proxyAddress)).length;
    } catch {
      proxyUtxoCount = undefined;
    }

    return {
      matched: true,
      authTokenId: scripts.authTokenId,
      proxyAddress: scripts.proxyAddress,
      paramUtxo,
      mintTxHash,
      dRepId: scripts.dRepId,
      proxyUtxoCount,
    };
  }

  return { matched: false, reason: "no-derived-match" };
}

export async function recoverProxyRowsFromChainForWalletType(args: {
  ctx: CIBootstrapContext;
  walletType: CIWalletType;
  db?: ProxyRecoveryDb;
  provider?: ProxyChainRecoveryProvider;
  maxCandidates?: number;
}): Promise<ProxyChainRecoveryResult> {
  const wallet = getWalletByType(args.ctx, args.walletType);
  if (!wallet) throw new Error(`Missing ${args.walletType} wallet`);

  const db = args.db ?? (getDefaultDb() as unknown as ProxyRecoveryDb);
  const provider = args.provider ?? createDefaultProvider(args.ctx.networkId);
  const currentWallet = await db.wallet.findUnique({
    where: { id: wallet.walletId },
    select: { id: true },
  });
  if (!currentWallet) {
    throw new Error(`Current ${args.walletType} wallet row ${wallet.walletId} was not found`);
  }

  const walletUtxos = await provider.fetchAddressUTxOs(wallet.walletAddress);
  const assetUnits = collectAssetUnits(walletUtxos);
  const maxCandidates = args.maxCandidates ?? DEFAULT_MAX_CANDIDATES;
  const candidates = assetUnits.slice(0, maxCandidates);
  const skipped: ProxyChainRecoveryResult["skipped"] = assetUnits
    .slice(maxCandidates)
    .map((assetUnit) => ({
      assetUnit,
      reason: "candidate-cap-exceeded",
      detail: `candidate limit ${maxCandidates} reached`,
    }));

  const matches: Array<{
    assetUnit: string;
    authTokenId: string;
    proxyAddress: string;
    paramUtxo: UtxoRef;
    mintTxHash: string;
    dRepId: string;
    proxyUtxoCount?: number;
  }> = [];

  for (const assetUnit of candidates) {
    const inspected = await inspectAssetCandidate({
      assetUnit,
      provider,
      network: args.ctx.networkId,
    });
    if (!inspected.matched) {
      skipped.push({ assetUnit, reason: inspected.reason, detail: inspected.detail });
      continue;
    }
    matches.push({ assetUnit, ...inspected });
  }

  const recovered: ProxyChainRecoveryResult["recovered"] = [];
  await runInTransaction(db, async (tx) => {
    for (const match of matches) {
      const existing = await tx.proxy.findFirst({
        where: { authTokenId: match.authTokenId },
        select: proxySelect,
      });

      if (existing?.walletId === wallet.walletId && existing.isActive) {
        skipped.push({ assetUnit: match.assetUnit, reason: "already-current-active" });
        continue;
      }

      const previousWalletId = existing?.walletId ?? null;
      const row = existing
        ? await tx.proxy.update({
            where: { id: existing.id },
            data: { walletId: wallet.walletId, isActive: true },
            select: proxySelect,
          })
        : await tx.proxy.create({
            data: {
              walletId: wallet.walletId,
              proxyAddress: match.proxyAddress,
              authTokenId: match.authTokenId,
              paramUtxo: JSON.stringify(match.paramUtxo),
              description: "Recovered CI proxy from chain",
              isActive: true,
            },
            select: proxySelect,
          });

      recovered.push({
        proxyId: row.id,
        action: existing ? (previousWalletId === wallet.walletId ? "reactivated" : "reattached") : "created",
        fromWalletId: previousWalletId,
        authTokenId: match.authTokenId,
        proxyAddress: match.proxyAddress,
        paramUtxo: match.paramUtxo,
        mintTxHash: match.mintTxHash,
        dRepId: match.dRepId,
        proxyUtxoCount: match.proxyUtxoCount,
      });
    }
  });

  return {
    walletType: args.walletType,
    walletId: wallet.walletId,
    walletAddress: wallet.walletAddress,
    recovered,
    skipped,
  };
}
