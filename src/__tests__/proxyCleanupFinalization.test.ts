import { describe, expect, it, jest } from "@jest/globals";
import type { Proxy } from "@prisma/client";
import type { UTxO } from "@meshsdk/core";

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: jest.fn(),
}), { virtual: true });

const proxy = {
  id: "proxy-1",
  walletId: "wallet-1",
  proxyAddress: "addr_test_proxy",
  authTokenId: "policy",
  paramUtxo: "{}",
  description: null,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as Proxy;

const mkUtxo = (amount: UTxO["output"]["amount"]): UTxO =>
  ({
    input: { txHash: "aa", outputIndex: 0 },
    output: { address: "addr_test_wallet", amount },
  }) as UTxO;

function createDb() {
  return {
    proxy: {
      update: jest.fn(async ({ data }: { data: Partial<Proxy> }) => ({
        ...proxy,
        ...data,
      })),
    },
  };
}

describe("finalizeConfirmedProxyCleanup", () => {
  it("deactivates the proxy when auth tokens are gone", async () => {
    const { finalizeConfirmedProxyCleanup } = await import("@/lib/server/proxyCleanupFinalization");
    const db = createDb();
    const result = await finalizeConfirmedProxyCleanup({
      db: db as never,
      network: 0,
      proxy,
      walletAddress: "addr_test_wallet",
      txHash: "cleanup-burn-tx",
      provider: {
        fetchAddressUTxOs: jest.fn(async (address: string) =>
          address === proxy.proxyAddress
            ? []
            : [mkUtxo([{ unit: "lovelace", quantity: "2000000" }])],
        ),
        get: jest.fn(async () => ({
          inputs: [
            {
              address: "addr_test_wallet",
              amount: [
                { unit: "lovelace", quantity: "2000000" },
                { unit: "policy", quantity: "1" },
              ],
            },
          ],
          outputs: [{ address: "addr_test_wallet", amount: [{ unit: "lovelace", quantity: "1500000" }] }],
        })),
      },
    });

    expect("error" in result).toBe(false);
    expect(db.proxy.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: proxy.id },
        data: { isActive: false },
      }),
    );
  });

  it("rejects cleanup finalization while auth tokens are still on-chain", async () => {
    const { finalizeConfirmedProxyCleanup } = await import("@/lib/server/proxyCleanupFinalization");
    const result = await finalizeConfirmedProxyCleanup({
      db: createDb() as never,
      network: 0,
      proxy,
      walletAddress: "addr_test_wallet",
      txHash: "cleanup-burn-tx",
      provider: {
        fetchAddressUTxOs: jest.fn(async () => [
          mkUtxo([
            { unit: "lovelace", quantity: "2000000" },
            { unit: "policy", quantity: "1" },
          ]),
        ]),
        get: jest.fn(async () => ({
          inputs: [
            {
              address: "addr_test_wallet",
              amount: [
                { unit: "lovelace", quantity: "2000000" },
                { unit: "policy", quantity: "1" },
              ],
            },
          ],
          outputs: [{ address: "addr_test_wallet", amount: [{ unit: "lovelace", quantity: "1500000" }] }],
        })),
      },
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("auth tokens are still visible");
    }
  });

  it("rejects cleanup finalization while proxy UTxOs remain", async () => {
    const { finalizeConfirmedProxyCleanup } = await import("@/lib/server/proxyCleanupFinalization");
    const result = await finalizeConfirmedProxyCleanup({
      db: createDb() as never,
      network: 0,
      proxy,
      walletAddress: "addr_test_wallet",
      txHash: "cleanup-burn-tx",
      provider: {
        fetchAddressUTxOs: jest.fn(async (address: string) =>
          address === proxy.proxyAddress
            ? [mkUtxo([{ unit: "lovelace", quantity: "1000000" }])]
            : [],
        ),
        get: jest.fn(async () => ({
          inputs: [
            {
              address: "addr_test_wallet",
              amount: [
                { unit: "lovelace", quantity: "2000000" },
                { unit: "policy", quantity: "1" },
              ],
            },
          ],
          outputs: [{ address: "addr_test_wallet", amount: [{ unit: "lovelace", quantity: "1500000" }] }],
        })),
      },
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("proxy address still has on-chain UTxOs");
    }
  });

  it("rejects finalization when txHash does not spend the auth token", async () => {
    const { finalizeConfirmedProxyCleanup } = await import("@/lib/server/proxyCleanupFinalization");
    const result = await finalizeConfirmedProxyCleanup({
      db: createDb() as never,
      network: 0,
      proxy,
      walletAddress: "addr_test_wallet",
      txHash: "wrong-tx",
      provider: {
        fetchAddressUTxOs: jest.fn(async () => []),
        get: jest.fn(async () => ({
          inputs: [{ address: "addr_test_wallet", amount: [{ unit: "lovelace", quantity: "2000000" }] }],
          outputs: [{ address: "addr_test_wallet", amount: [{ unit: "lovelace", quantity: "1500000" }] }],
        })),
      },
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("txHash does not match confirmed proxy cleanup burn outputs");
    }
  });
});
