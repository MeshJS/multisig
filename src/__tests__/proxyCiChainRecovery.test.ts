import { describe, expect, it, jest } from "@jest/globals";
import { recoverProxyRowsFromChainForWalletType } from "../../scripts/ci/scenarios/proxyChainRecovery";
import type { CIBootstrapContext } from "../../scripts/ci/framework/types";
import { deriveProxyScripts } from "../lib/server/proxyTxBuilders";
import type { UtxoRef } from "../lib/server/proxyUtxos";

type TestProxyRow = {
  id: string;
  walletId: string | null;
  proxyAddress: string;
  authTokenId: string;
  paramUtxo: string;
  isActive: boolean;
};

const walletAddress = "addr_test_wallet";
const paramUtxo: UtxoRef = {
  txHash: "a".repeat(64),
  outputIndex: 0,
};
const derivedProxy = deriveProxyScripts({ paramUtxo, network: 0 });

function createContext(): CIBootstrapContext {
  return {
    schemaVersion: 3,
    createdAt: "2026-04-30T00:00:00.000Z",
    apiBaseUrl: "http://localhost:3000",
    networkId: 0,
    walletTypes: ["legacy"],
    wallets: [
      {
        type: "legacy",
        walletId: "current-wallet",
        walletAddress,
        signerAddresses: ["addr_test_signer_1", "addr_test_signer_2"],
      },
    ],
    bots: [],
    signerAddresses: ["addr_test_signer_1", "addr_test_signer_2"],
    signerStakeAddresses: [],
  };
}

function createProxyRow(overrides: Partial<TestProxyRow> = {}): TestProxyRow {
  return {
    id: "proxy-1",
    walletId: "old-wallet",
    proxyAddress: derivedProxy.proxyAddress,
    authTokenId: derivedProxy.authTokenId,
    paramUtxo: JSON.stringify(paramUtxo),
    isActive: false,
    ...overrides,
  };
}

function createDb(args: { proxies?: TestProxyRow[] } = {}) {
  const proxies = [...(args.proxies ?? [])];
  const creates: unknown[] = [];
  const updates: unknown[] = [];
  type TestDb = {
    wallet: {
      findUnique: ReturnType<typeof jest.fn>;
    };
    proxy: {
      findFirst: ReturnType<typeof jest.fn>;
      create: ReturnType<typeof jest.fn>;
      update: ReturnType<typeof jest.fn>;
    };
    $transaction: ReturnType<typeof jest.fn>;
  };
  const db: TestDb = {
    wallet: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === "current-wallet" ? { id: "current-wallet" } : null,
      ),
    },
    proxy: {
      findFirst: jest.fn(async ({ where }: { where: { authTokenId: string } }) =>
        proxies.find((proxy) => proxy.authTokenId === where.authTokenId) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: Omit<TestProxyRow, "id"> & { description: string } }) => {
        creates.push(data);
        const row: TestProxyRow = { id: `proxy-${creates.length}`, ...data };
        proxies.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: { walletId: string; isActive: true } }) => {
        updates.push({ where, data });
        const row = proxies.find((proxy) => proxy.id === where.id);
        if (!row) throw new Error(`missing proxy ${where.id}`);
        row.walletId = data.walletId;
        row.isActive = data.isActive;
        return row;
      }),
    },
    $transaction: jest.fn(async (fn: (tx: TestDb) => Promise<unknown>) => fn(db)),
  };
  return { db, creates, updates, proxies };
}

function createProvider(args: {
  walletAssets: string[];
  histories?: Record<string, Array<{ tx_hash?: string; action?: string }>>;
  txInputs?: Record<string, Array<{ tx_hash?: string; output_index?: number }>>;
  txErrors?: string[];
}) {
  return {
    fetchAddressUTxOs: jest.fn(async (address: string) => [
      {
        input: { txHash: "b".repeat(64), outputIndex: 0 },
        output: {
          address,
          amount:
            address === walletAddress
              ? [
                  { unit: "lovelace", quantity: "2000000" },
                  ...args.walletAssets.map((unit) => ({ unit, quantity: "1" })),
                ]
              : [{ unit: "lovelace", quantity: "2000000" }],
        },
      },
    ]),
    get: jest.fn(async (path: string) => {
      const assetMatch = path.match(/^\/assets\/([^/]+)\/history/);
      if (assetMatch) {
        const assetUnit = decodeURIComponent(assetMatch[1]!);
        return args.histories?.[assetUnit] ?? [];
      }

      const txMatch = path.match(/^\/txs\/([^/]+)\/utxos$/);
      if (txMatch) {
        const txHash = decodeURIComponent(txMatch[1]!);
        if (args.txErrors?.includes(txHash)) {
          throw new Error(`tx lookup failed for ${txHash}`);
        }
        return { inputs: args.txInputs?.[txHash] ?? [] };
      }

      throw new Error(`unexpected path ${path}`);
    }),
  };
}

describe("CI proxy chain recovery", () => {
  it("recovers a missing row when a wallet asset matches a mint transaction input", async () => {
    const { db, creates, updates } = createDb();
    const provider = createProvider({
      walletAssets: [derivedProxy.authTokenId],
      histories: { [derivedProxy.authTokenId]: [{ tx_hash: "mint-tx", action: "minted" }] },
      txInputs: { "mint-tx": [{ tx_hash: paramUtxo.txHash, output_index: paramUtxo.outputIndex }] },
    });

    const result = await recoverProxyRowsFromChainForWalletType({
      ctx: createContext(),
      walletType: "legacy",
      db,
      provider,
    });

    expect(result.recovered).toEqual([
      expect.objectContaining({
        proxyId: "proxy-1",
        action: "created",
        authTokenId: derivedProxy.authTokenId,
        proxyAddress: derivedProxy.proxyAddress,
        mintTxHash: "mint-tx",
        dRepId: derivedProxy.dRepId,
      }),
    ]);
    expect(creates).toEqual([
      expect.objectContaining({
        walletId: "current-wallet",
        authTokenId: derivedProxy.authTokenId,
        proxyAddress: derivedProxy.proxyAddress,
        paramUtxo: JSON.stringify(paramUtxo),
        description: "Recovered CI proxy from chain",
        isActive: true,
      }),
    ]);
    expect(updates).toEqual([]);
  });

  it("reattaches an existing historical row instead of creating a duplicate", async () => {
    const existing = createProxyRow({ walletId: "old-wallet", isActive: false });
    const { db, creates, updates } = createDb({ proxies: [existing] });
    const provider = createProvider({
      walletAssets: [derivedProxy.authTokenId],
      histories: { [derivedProxy.authTokenId]: [{ tx_hash: "mint-tx", action: "minted" }] },
      txInputs: { "mint-tx": [{ tx_hash: paramUtxo.txHash, output_index: paramUtxo.outputIndex }] },
    });

    const result = await recoverProxyRowsFromChainForWalletType({
      ctx: createContext(),
      walletType: "legacy",
      db,
      provider,
    });

    expect(result.recovered[0]).toEqual(
      expect.objectContaining({
        proxyId: "proxy-1",
        action: "reattached",
        fromWalletId: "old-wallet",
      }),
    );
    expect(creates).toEqual([]);
    expect(updates).toEqual([
      expect.objectContaining({
        where: { id: "proxy-1" },
        data: { walletId: "current-wallet", isActive: true },
      }),
    ]);
  });

  it("skips unrelated wallet assets whose mint inputs do not derive the observed unit", async () => {
    const unrelatedAsset = "f".repeat(56);
    const { db, creates, updates } = createDb();
    const provider = createProvider({
      walletAssets: [unrelatedAsset],
      histories: { [unrelatedAsset]: [{ tx_hash: "mint-tx", action: "minted" }] },
      txInputs: { "mint-tx": [{ tx_hash: "c".repeat(64), output_index: 1 }] },
    });

    const result = await recoverProxyRowsFromChainForWalletType({
      ctx: createContext(),
      walletType: "legacy",
      db,
      provider,
    });

    expect(result.recovered).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ assetUnit: unrelatedAsset, reason: "no-derived-match" }),
    ]);
    expect(creates).toEqual([]);
    expect(updates).toEqual([]);
  });

  it("records diagnostics when asset history has no mint or tx UTxO lookup fails", async () => {
    const noMintAsset = "1".repeat(56);
    const txErrorAsset = "2".repeat(56);
    const { db } = createDb();
    const provider = createProvider({
      walletAssets: [noMintAsset, txErrorAsset],
      histories: {
        [noMintAsset]: [{ tx_hash: "non-mint-tx", action: "burned" }],
        [txErrorAsset]: [{ tx_hash: "error-tx", action: "minted" }],
      },
      txInputs: {},
      txErrors: ["error-tx"],
    });

    const result = await recoverProxyRowsFromChainForWalletType({
      ctx: createContext(),
      walletType: "legacy",
      db,
      provider,
    });

    expect(result.recovered).toEqual([]);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetUnit: noMintAsset, reason: "no-mint-transaction" }),
        expect.objectContaining({ assetUnit: txErrorAsset, reason: "tx-utxos-fetch-error" }),
      ]),
    );
  });

  it("enforces the candidate cap and records skipped excess assets", async () => {
    const assetA = "a".repeat(56);
    const assetB = "b".repeat(56);
    const { db } = createDb();
    const provider = createProvider({
      walletAssets: [assetA, assetB],
      histories: { [assetA]: [] },
    });

    const result = await recoverProxyRowsFromChainForWalletType({
      ctx: createContext(),
      walletType: "legacy",
      db,
      provider,
      maxCandidates: 1,
    });

    expect(provider.get).toHaveBeenCalledTimes(1);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assetUnit: assetA, reason: "no-mint-transaction" }),
        expect.objectContaining({ assetUnit: assetB, reason: "candidate-cap-exceeded" }),
      ]),
    );
  });
});
