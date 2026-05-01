import { PrismaClient, type Proxy as DbProxy, type Wallet as DbWallet } from "@prisma/client";
import { BlockfrostProvider, type UTxO } from "@meshsdk/core";
import { deriveProxyScripts } from "../../../src/lib/server/proxyTxBuilders";
import { hasAsset, type UtxoRef } from "../../../src/lib/server/proxyUtxos";
import { resolveWalletScriptAddressSafe } from "../../../src/lib/server/walletScriptAddress";
import type { CIBootstrapContext, CIWalletType } from "../framework/types";
import { getWalletByType } from "./steps/helpers";

type ProxyAdoptionWallet = Pick<
  DbWallet,
  | "id"
  | "name"
  | "signersAddresses"
  | "signersStakeKeys"
  | "signersDRepKeys"
  | "signersDescriptions"
  | "numRequiredSigners"
  | "scriptCbor"
  | "stakeCredentialHash"
  | "type"
  | "rawImportBodies"
>;

type ProxyAdoptionRow = Pick<
  DbProxy,
  "id" | "walletId" | "proxyAddress" | "authTokenId" | "paramUtxo" | "isActive"
>;

type ProxyAdoptionDb = {
  wallet: {
    findUnique: (args: {
      where: { id: string };
      select: Record<keyof ProxyAdoptionWallet, true>;
    }) => Promise<ProxyAdoptionWallet | null>;
    findMany: (args: {
      select: Record<keyof ProxyAdoptionWallet, true>;
    }) => Promise<ProxyAdoptionWallet[]>;
  };
  proxy: {
    findMany: (args: {
      where: { walletId: { in: string[] } };
      select: Record<keyof ProxyAdoptionRow, true>;
    }) => Promise<ProxyAdoptionRow[]>;
    update: (args: {
      where: { id: string };
      data: { walletId: string; isActive: true };
      select: { id: true; walletId: true; isActive: true };
    }) => Promise<{ id: string; walletId: string | null; isActive: boolean }>;
  };
  $transaction?: <T>(fn: (tx: ProxyAdoptionDb) => Promise<T>) => Promise<T>;
};

export type ProxyOrphanAdoptionProvider = {
  fetchAddressUTxOs: (address: string) => Promise<UTxO[]>;
};

export type ProxyAdoptionSkipReason =
  | "already-current-active"
  | "invalid-param-utxo"
  | "metadata-mismatch"
  | "chain-empty"
  | "chain-fetch-error";

export type ProxyAdoptionResult = {
  walletType: CIWalletType;
  walletId: string;
  walletAddress: string;
  historicalWalletIds: string[];
  adopted: Array<{
    proxyId: string;
    fromWalletId: string | null;
    authTokenId: string;
    proxyAddress: string;
    wasActive: boolean;
  }>;
  skipped: Array<{
    proxyId: string;
    walletId: string | null;
    reason: ProxyAdoptionSkipReason;
    detail?: string;
  }>;
};

const walletSelect: Record<keyof ProxyAdoptionWallet, true> = {
  id: true,
  name: true,
  signersAddresses: true,
  signersStakeKeys: true,
  signersDRepKeys: true,
  signersDescriptions: true,
  numRequiredSigners: true,
  scriptCbor: true,
  stakeCredentialHash: true,
  type: true,
  rawImportBodies: true,
};

const proxySelect: Record<keyof ProxyAdoptionRow, true> = {
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

function createDefaultProvider(networkId: 0 | 1): ProxyOrphanAdoptionProvider {
  const apiKey =
    networkId === 0
      ? process.env.CI_BLOCKFROST_PREPROD_API_KEY?.trim() ||
        process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD?.trim()
      : process.env.CI_BLOCKFROST_MAINNET_API_KEY?.trim() ||
        process.env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET?.trim();
  if (!apiKey) {
    throw new Error(`Missing Blockfrost API key for proxy orphan adoption on network ${networkId}`);
  }
  return new BlockfrostProvider(apiKey);
}

function parseParamUtxo(value: string): UtxoRef | null {
  try {
    const parsed = JSON.parse(value) as Partial<UtxoRef>;
    const txHash = typeof parsed.txHash === "string" ? parsed.txHash.trim() : "";
    const outputIndex =
      typeof parsed.outputIndex === "number" && Number.isInteger(parsed.outputIndex)
        ? parsed.outputIndex
        : -1;
    if (!txHash || outputIndex < 0) return null;
    return { txHash, outputIndex };
  } catch {
    return null;
  }
}

async function runInTransaction<T>(
  db: ProxyAdoptionDb,
  fn: (tx: ProxyAdoptionDb) => Promise<T>,
): Promise<T> {
  if (typeof db.$transaction === "function") {
    return db.$transaction(fn);
  }
  return fn(db);
}

function resolveMatchingWalletIds(args: {
  currentWallet: ProxyAdoptionWallet;
  allWallets: ProxyAdoptionWallet[];
  fallbackAddress: string;
}): string[] {
  const currentAddressResult = resolveWalletScriptAddressSafe(
    args.currentWallet as DbWallet,
    args.fallbackAddress,
  );
  if ("error" in currentAddressResult) {
    throw new Error(`Unable to resolve current wallet script address: ${currentAddressResult.error}`);
  }

  return args.allWallets
    .filter((wallet) => {
      const resolved = resolveWalletScriptAddressSafe(wallet as DbWallet, args.fallbackAddress);
      return "address" in resolved && resolved.address === currentAddressResult.address;
    })
    .map((wallet) => wallet.id);
}

function hasAuthToken(utxos: UTxO[], authTokenId: string): boolean {
  return utxos.some((utxo) => hasAsset(utxo, authTokenId));
}

export async function adoptProxyOrphansForWalletType(args: {
  ctx: CIBootstrapContext;
  walletType: CIWalletType;
  db?: ProxyAdoptionDb;
  provider?: ProxyOrphanAdoptionProvider;
}): Promise<ProxyAdoptionResult> {
  const wallet = getWalletByType(args.ctx, args.walletType);
  if (!wallet) throw new Error(`Missing ${args.walletType} wallet`);

  const db = args.db ?? (getDefaultDb() as unknown as ProxyAdoptionDb);
  const provider = args.provider ?? createDefaultProvider(args.ctx.networkId);
  const currentWallet = await db.wallet.findUnique({
    where: { id: wallet.walletId },
    select: walletSelect,
  });
  if (!currentWallet) {
    throw new Error(`Current ${args.walletType} wallet row ${wallet.walletId} was not found`);
  }

  const allWallets = await db.wallet.findMany({ select: walletSelect });
  const matchingWalletIds = resolveMatchingWalletIds({
    currentWallet,
    allWallets,
    fallbackAddress: wallet.walletAddress,
  });
  const historicalWalletIds = matchingWalletIds.filter((walletId) => walletId !== wallet.walletId);
  if (matchingWalletIds.length === 0) {
    return {
      walletType: args.walletType,
      walletId: wallet.walletId,
      walletAddress: wallet.walletAddress,
      historicalWalletIds: [],
      adopted: [],
      skipped: [],
    };
  }

  const candidates = await db.proxy.findMany({
    where: { walletId: { in: matchingWalletIds } },
    select: proxySelect,
  });

  const walletUtxos = await provider.fetchAddressUTxOs(wallet.walletAddress);
  const adopted: ProxyAdoptionResult["adopted"] = [];
  const skipped: ProxyAdoptionResult["skipped"] = [];
  const updates: ProxyAdoptionRow[] = [];

  for (const proxy of candidates) {
    if (proxy.walletId === wallet.walletId && proxy.isActive) {
      skipped.push({
        proxyId: proxy.id,
        walletId: proxy.walletId,
        reason: "already-current-active",
      });
      continue;
    }

    const paramUtxo = parseParamUtxo(proxy.paramUtxo);
    if (!paramUtxo) {
      skipped.push({
        proxyId: proxy.id,
        walletId: proxy.walletId,
        reason: "invalid-param-utxo",
      });
      continue;
    }

    const scripts = deriveProxyScripts({ paramUtxo, network: args.ctx.networkId });
    if (scripts.authTokenId !== proxy.authTokenId || scripts.proxyAddress !== proxy.proxyAddress) {
      skipped.push({
        proxyId: proxy.id,
        walletId: proxy.walletId,
        reason: "metadata-mismatch",
      });
      continue;
    }

    let proxyUtxos: UTxO[];
    try {
      proxyUtxos = await provider.fetchAddressUTxOs(proxy.proxyAddress);
    } catch (error) {
      skipped.push({
        proxyId: proxy.id,
        walletId: proxy.walletId,
        reason: "chain-fetch-error",
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    if (!hasAuthToken(walletUtxos, proxy.authTokenId)) {
      skipped.push({
        proxyId: proxy.id,
        walletId: proxy.walletId,
        reason: "chain-empty",
        detail: proxyUtxos.length
          ? "proxy address has UTxOs, but auth token is not at current wallet address"
          : "no auth token at current wallet address and proxy address is empty",
      });
      continue;
    }

    updates.push(proxy);
  }

  await runInTransaction(db, async (tx) => {
    for (const proxy of updates) {
      await tx.proxy.update({
        where: { id: proxy.id },
        data: { walletId: wallet.walletId, isActive: true },
        select: { id: true, walletId: true, isActive: true },
      });
      adopted.push({
        proxyId: proxy.id,
        fromWalletId: proxy.walletId,
        authTokenId: proxy.authTokenId,
        proxyAddress: proxy.proxyAddress,
        wasActive: proxy.isActive,
      });
    }
  });

  return {
    walletType: args.walletType,
    walletId: wallet.walletId,
    walletAddress: wallet.walletAddress,
    historicalWalletIds,
    adopted,
    skipped,
  };
}
