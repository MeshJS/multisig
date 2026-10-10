import { describe, expect, it, jest } from "@jest/globals";
import { resolvePaymentKeyHash, serializeNativeScript } from "@meshsdk/core";
import { adoptProxyOrphansForWalletType } from "../../scripts/ci/scenarios/proxyOrphanAdoption";
import type { CIBootstrapContext } from "../../scripts/ci/framework/types";
import { deriveProxyScripts } from "../lib/server/proxyTxBuilders";
import { realTestAddresses } from "./testUtils";

type TestWalletRow = {
  id: string;
  name: string;
  signersAddresses: string[];
  signersStakeKeys: string[];
  signersDRepKeys: string[];
  signersDescriptions: string[];
  numRequiredSigners: number;
  scriptCbor: string;
  stakeCredentialHash: string | null;
  type: string;
  rawImportBodies: null;
};

type TestProxyRow = {
  id: string;
  walletId: string | null;
  proxyAddress: string;
  authTokenId: string;
  paramUtxo: string;
  isActive: boolean;
};

const paramUtxo = {
  txHash: "a".repeat(64),
  outputIndex: 0,
};
const derivedProxy = deriveProxyScripts({ paramUtxo, network: 0 });

function createWalletRows(): { address: string; current: TestWalletRow; old: TestWalletRow } {
  const paymentScript = {
    type: "atLeast" as const,
    required: 1,
    scripts: [
      { type: "sig" as const, keyHash: resolvePaymentKeyHash(realTestAddresses.address1) },
      { type: "sig" as const, keyHash: resolvePaymentKeyHash(realTestAddresses.address2) },
    ],
  };
  const serialized = serializeNativeScript(paymentScript, undefined, 0, true);
  if (!serialized.scriptCbor) {
    throw new Error("Expected test native script CBOR");
  }

  const base = {
    name: "CI legacy wallet",
    signersAddresses: [realTestAddresses.address1, realTestAddresses.address2],
    signersStakeKeys: [],
    signersDRepKeys: [],
    signersDescriptions: ["one", "two"],
    numRequiredSigners: 1,
    scriptCbor: serialized.scriptCbor,
    stakeCredentialHash: null,
    type: "atLeast",
    rawImportBodies: null,
  };

  return {
    address: serialized.address,
    current: { ...base, id: "current-wallet" },
    old: { ...base, id: "old-wallet" },
  };
}

function createContext(walletAddress: string): CIBootstrapContext {
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
        signerAddresses: [realTestAddresses.address1, realTestAddresses.address2],
      },
    ],
    bots: [],
    signerAddresses: [realTestAddresses.address1, realTestAddresses.address2],
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
    isActive: true,
    ...overrides,
  };
}

function createDb(args: { wallets: TestWalletRow[]; proxies: TestProxyRow[] }) {
  const updates: Array<{ where: { id: string }; data: { walletId: string; isActive: true } }> = [];
  type TestDb = {
    wallet: {
      findUnique: ReturnType<typeof jest.fn>;
      findMany: ReturnType<typeof jest.fn>;
    };
    proxy: {
      findMany: ReturnType<typeof jest.fn>;
      update: ReturnType<typeof jest.fn>;
    };
    $transaction: ReturnType<typeof jest.fn>;
  };
  const db: TestDb = {
    wallet: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        args.wallets.find((wallet) => wallet.id === where.id) ?? null,
      ),
      findMany: jest.fn(async () => args.wallets),
    },
    proxy: {
      findMany: jest.fn(async ({ where }: { where: { walletId: { in: string[] } } }) =>
        args.proxies.filter((proxy) => proxy.walletId && where.walletId.in.includes(proxy.walletId)),
      ),
      update: jest.fn(async (updateArgs: { where: { id: string }; data: { walletId: string; isActive: true } }) => {
        updates.push(updateArgs);
        return {
          id: updateArgs.where.id,
          walletId: updateArgs.data.walletId,
          isActive: updateArgs.data.isActive,
        };
      }),
    },
    $transaction: jest.fn(async (fn: (tx: TestDb) => Promise<unknown>) => fn(db)),
  };
  return { db, updates };
}

function createProvider(args: { walletAddress: string; includeAuthToken: boolean }) {
  return {
    fetchAddressUTxOs: jest.fn(async (address: string) => {
      if (address === args.walletAddress) {
        return [
          {
            input: { txHash: "b".repeat(64), outputIndex: 0 },
            output: {
              address,
              amount: [
                { unit: "lovelace", quantity: "2000000" },
                ...(args.includeAuthToken
                  ? [{ unit: derivedProxy.authTokenId, quantity: "1" }]
                  : []),
              ],
            },
          },
        ];
      }
      if (address === derivedProxy.proxyAddress) {
        return [];
      }
      throw new Error(`unexpected address ${address}`);
    }),
  };
}

describe("CI proxy orphan adoption", () => {
  it("reattaches a valid historical proxy row to the current wallet", async () => {
    const { address, current, old } = createWalletRows();
    const proxy = createProxyRow();
    const { db, updates } = createDb({ wallets: [current, old], proxies: [proxy] });

    const result = await adoptProxyOrphansForWalletType({
      ctx: createContext(address),
      walletType: "legacy",
      db,
      provider: createProvider({ walletAddress: address, includeAuthToken: true }),
    });

    expect(result.historicalWalletIds).toEqual(["old-wallet"]);
    expect(result.adopted).toEqual([
      expect.objectContaining({
        proxyId: "proxy-1",
        fromWalletId: "old-wallet",
        authTokenId: derivedProxy.authTokenId,
      }),
    ]);
    expect(updates).toEqual([
      expect.objectContaining({
        where: { id: "proxy-1" },
        data: { walletId: "current-wallet", isActive: true },
      }),
    ]);
  });

  it("reactivates a valid inactive row already attached to the current wallet", async () => {
    const { address, current, old } = createWalletRows();
    const proxy = createProxyRow({ walletId: "current-wallet", isActive: false });
    const { db, updates } = createDb({ wallets: [current, old], proxies: [proxy] });

    const result = await adoptProxyOrphansForWalletType({
      ctx: createContext(address),
      walletType: "legacy",
      db,
      provider: createProvider({ walletAddress: address, includeAuthToken: true }),
    });

    expect(result.adopted[0]).toEqual(
      expect.objectContaining({
        proxyId: "proxy-1",
        fromWalletId: "current-wallet",
        wasActive: false,
      }),
    );
    expect(updates[0]?.data).toEqual({ walletId: "current-wallet", isActive: true });
  });

  it("skips rows whose stored metadata does not match derived scripts", async () => {
    const { address, current, old } = createWalletRows();
    const { db, updates } = createDb({
      wallets: [current, old],
      proxies: [createProxyRow({ authTokenId: "wrong-auth-token" })],
    });

    const result = await adoptProxyOrphansForWalletType({
      ctx: createContext(address),
      walletType: "legacy",
      db,
      provider: createProvider({ walletAddress: address, includeAuthToken: true }),
    });

    expect(result.adopted).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ proxyId: "proxy-1", reason: "metadata-mismatch" }),
    ]);
    expect(updates).toEqual([]);
  });

  it("skips rows when the auth token is not visible at the current wallet address", async () => {
    const { address, current, old } = createWalletRows();
    const { db, updates } = createDb({
      wallets: [current, old],
      proxies: [createProxyRow()],
    });

    const result = await adoptProxyOrphansForWalletType({
      ctx: createContext(address),
      walletType: "legacy",
      db,
      provider: createProvider({ walletAddress: address, includeAuthToken: false }),
    });

    expect(result.adopted).toEqual([]);
    expect(result.skipped).toEqual([
      expect.objectContaining({ proxyId: "proxy-1", reason: "chain-empty" }),
    ]);
    expect(updates).toEqual([]);
  });
});
