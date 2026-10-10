import { describe, expect, it } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";
import {
  requireAuthTokenUtxo,
  resolveCollateralRefFromChain,
  selectProxyUtxosForOutputs,
} from "@/lib/server/proxyUtxos";

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

describe("proxyUtxos", () => {
  it("rejects collateral below 5 ADA", async () => {
    const result = await resolveCollateralRefFromChain({
      network: 0,
      collateralRef: { txHash: "aa", outputIndex: 0 },
      provider: {
        fetchUTxOs: async () => [
          mkUtxo("addr_test", [{ unit: "lovelace", quantity: "4999999" }]),
        ],
      },
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("at least 5 ADA");
    }
  });

  it("rejects collateral at an unexpected address", async () => {
    const result = await resolveCollateralRefFromChain({
      network: 0,
      collateralRef: { txHash: "aa", outputIndex: 0 },
      expectedAddress: "addr_test_signer",
      provider: {
        fetchUTxOs: async () => [
          mkUtxo("addr_test_wallet_script", [{ unit: "lovelace", quantity: "6000000" }]),
        ],
      },
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("expected address");
    }
  });

  it("rejects collateral with native assets", async () => {
    const result = await resolveCollateralRefFromChain({
      network: 0,
      collateralRef: { txHash: "aa", outputIndex: 0 },
      expectedAddress: "addr_test_signer",
      provider: {
        fetchUTxOs: async () => [
          mkUtxo("addr_test_signer", [
            { unit: "lovelace", quantity: "6000000" },
            { unit: "policy.asset", quantity: "1" },
          ]),
        ],
      },
    });

    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error).toContain("ADA-only");
    }
  });

  it("finds the proxy auth-token UTxO", () => {
    const result = requireAuthTokenUtxo(
      [
        mkUtxo("addr_wallet", [{ unit: "lovelace", quantity: "3000000" }]),
        mkUtxo(
          "addr_wallet",
          [
            { unit: "lovelace", quantity: "2000000" },
            { unit: "policyid", quantity: "1" },
          ],
          "bb",
          1,
        ),
      ],
      "policyid",
    );

    expect("error" in result).toBe(false);
    if (!("error" in result)) {
      expect(result.input.txHash).toBe("bb");
    }
  });

  it("selects proxy UTxOs that cover requested outputs plus fee buffer", () => {
    const result = selectProxyUtxosForOutputs({
      proxyUtxos: [
        mkUtxo("addr_proxy", [{ unit: "lovelace", quantity: "1000000" }], "aa", 0),
        mkUtxo("addr_proxy", [{ unit: "lovelace", quantity: "2500000" }], "bb", 1),
      ],
      outputs: [{ address: "addr_target", unit: "lovelace", amount: "1500000" }],
      feeBufferLovelace: BigInt(500000),
    });

    expect(Array.isArray(result)).toBe(true);
    if (Array.isArray(result)) {
      expect(result.map((utxo) => utxo.input.txHash)).toEqual(["bb"]);
    }
  });
});
