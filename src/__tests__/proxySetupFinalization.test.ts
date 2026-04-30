import { describe, expect, it, jest } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: jest.fn(),
}), { virtual: true });

const setup = {
  proxyAddress: "addr_test_proxy",
  authTokenId: "policy",
  paramUtxo: { txHash: "aa", outputIndex: 0 },
  description: "CI proxy setup",
};

const mkUtxo = (
  address: string,
  amount: UTxO["output"]["amount"],
  txHash = "aa",
  outputIndex = 0,
): UTxO =>
  ({
    input: { txHash, outputIndex },
    output: { address, amount },
  }) as UTxO;

function createDb(existingProxy?: unknown) {
  return {
    proxy: {
      findFirst: jest.fn(async () => existingProxy ?? null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "proxy-1",
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "proxy-1",
        ...data,
      })),
    },
  };
}

function createProvider(args: { walletUtxos: UTxO[]; proxyUtxos: UTxO[] }) {
  return {
    fetchAddressUTxOs: jest.fn(async (address: string) =>
      address === setup.proxyAddress ? args.proxyUtxos : args.walletUtxos,
    ),
    get: jest.fn(async () => ({
      outputs: [
        {
          address: setup.proxyAddress,
          amount: [{ unit: "lovelace", quantity: "10000000" }],
        },
        {
          address: "addr_test_wallet",
          amount: [
            { unit: "lovelace", quantity: "2000000" },
            { unit: setup.authTokenId, quantity: "1" },
          ],
        },
      ],
    })),
  };
}

describe("finalizeConfirmedProxySetup", () => {
  it("creates a proxy row when confirmed chain state is present", async () => {
    const { finalizeConfirmedProxySetup } = await import("@/lib/server/proxySetupFinalization");
    const db = createDb();
    const provider = createProvider({
      walletUtxos: [
        mkUtxo("addr_test_wallet", [
          { unit: "lovelace", quantity: "2000000" },
          { unit: "policy", quantity: "1" },
        ]),
      ],
      proxyUtxos: [
        mkUtxo("addr_test_proxy", [{ unit: "lovelace", quantity: "1000000" }]),
      ],
    });

    const result = await finalizeConfirmedProxySetup({
      db: db as never,
      network: 0,
      walletId: "wallet-1",
      walletAddress: "addr_test_wallet",
      txHash: "setup-tx",
      setup,
      provider,
    });

    expect("error" in result).toBe(false);
    expect(db.proxy.create).toHaveBeenCalledWith({
      data: {
        walletId: "wallet-1",
        proxyAddress: setup.proxyAddress,
        authTokenId: setup.authTokenId,
        paramUtxo: JSON.stringify(setup.paramUtxo),
        description: setup.description,
        isActive: true,
      },
    });
  });

  it("rejects confirmed setup when the auth token is missing at the wallet", async () => {
    const { finalizeConfirmedProxySetup } = await import("@/lib/server/proxySetupFinalization");
    const result = await finalizeConfirmedProxySetup({
      db: createDb() as never,
      network: 0,
      walletId: "wallet-1",
      walletAddress: "addr_test_wallet",
      txHash: "setup-tx",
      setup,
      provider: createProvider({
        walletUtxos: [
          mkUtxo("addr_test_wallet", [{ unit: "lovelace", quantity: "2000000" }]),
        ],
        proxyUtxos: [
          mkUtxo("addr_test_proxy", [{ unit: "lovelace", quantity: "1000000" }]),
        ],
      }),
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("auth token is not present");
    }
  });

  it("is idempotent when an active proxy row already exists", async () => {
    const { finalizeConfirmedProxySetup } = await import("@/lib/server/proxySetupFinalization");
    const existingProxy = { id: "proxy-existing", isActive: true };
    const db = createDb(existingProxy);
    const result = await finalizeConfirmedProxySetup({
      db: db as never,
      network: 0,
      walletId: "wallet-1",
      walletAddress: "addr_test_wallet",
      txHash: "setup-tx",
      setup,
      provider: createProvider({
        walletUtxos: [
          mkUtxo("addr_test_wallet", [
            { unit: "lovelace", quantity: "2000000" },
            { unit: "policy", quantity: "1" },
          ]),
        ],
        proxyUtxos: [
          mkUtxo("addr_test_proxy", [{ unit: "lovelace", quantity: "1000000" }]),
        ],
      }),
    });

    expect(result).toBe(existingProxy);
    expect(db.proxy.create).not.toHaveBeenCalled();
  });

  it("rejects finalization when txHash does not match setup outputs", async () => {
    const { finalizeConfirmedProxySetup } = await import("@/lib/server/proxySetupFinalization");
    const result = await finalizeConfirmedProxySetup({
      db: createDb() as never,
      network: 0,
      walletId: "wallet-1",
      walletAddress: "addr_test_wallet",
      txHash: "wrong-tx",
      setup,
      provider: {
        fetchAddressUTxOs: jest.fn(async () => []),
        get: jest.fn(async () => ({
          outputs: [{ address: "addr_test_other", amount: [{ unit: "lovelace", quantity: "1000000" }] }],
        })),
      },
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("txHash does not match confirmed proxy setup outputs");
    }
  });
});
