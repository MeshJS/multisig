import { describe, expect, it } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";
import {
  assertNoStrayAuthTokenUtxos,
  hasAsset,
} from "@/lib/proxy/utxoUtils";
import { buildProxySpendTx, deriveProxyScripts } from "@/lib/proxy/txBuilders";

const WALLET_ADDRESS = "addr_test1qpwalletfixtureaddress0000000000000000000000000000";
const PROXY_PARAM_UTXO = { txHash: "a".repeat(64), outputIndex: 0 };

function mkUtxo(
  address: string,
  amount: UTxO["output"]["amount"],
  txHash: string,
  outputIndex = 0,
): UTxO {
  return { input: { txHash, outputIndex }, output: { address, amount } };
}

function createNoopTxBuilder() {
  const builder: any = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return undefined;
        return () => builder;
      },
    },
  );
  return builder;
}

describe("assertNoStrayAuthTokenUtxos (proxy AuthToken leak guard)", () => {
  const AUTH_TOKEN_ID = "d".repeat(56) + "6d79546f6b656e";
  const designated = mkUtxo(
    WALLET_ADDRESS,
    [{ unit: "lovelace", quantity: "2000000" }, { unit: AUTH_TOKEN_ID, quantity: "1" }],
    "b".repeat(64),
  );

  it("passes when walletUtxos contains only plain ADA UTxOs alongside the designated AuthToken", () => {
    const plainAda = mkUtxo(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "5000000" }], "c".repeat(64));
    expect(() =>
      assertNoStrayAuthTokenUtxos([designated, plainAda], AUTH_TOKEN_ID, designated),
    ).not.toThrow();
  });

  it("throws when walletUtxos contains a second, non-designated AuthToken UTxO", () => {
    const strayAuthToken = mkUtxo(
      WALLET_ADDRESS,
      [{ unit: "lovelace", quantity: "2000000" }, { unit: AUTH_TOKEN_ID, quantity: "1" }],
      "e".repeat(64),
    );
    expect(() =>
      assertNoStrayAuthTokenUtxos([designated, strayAuthToken], AUTH_TOKEN_ID, designated),
    ).toThrow(/additional AuthToken UTxO/i);
  });

  it("hasAsset correctly detects the AuthToken unit", () => {
    expect(hasAsset(designated, AUTH_TOKEN_ID)).toBe(true);
    expect(hasAsset(designated, "lovelace", 3_000_000n)).toBe(false);
  });
});

describe("buildProxySpendTx stray AuthToken protection (regression for proxyAddress drain bug)", () => {
  const scripts = deriveProxyScripts({ paramUtxo: PROXY_PARAM_UTXO, network: 0 });

  const authTokenUtxo = mkUtxo(
    WALLET_ADDRESS,
    [{ unit: "lovelace", quantity: "2000000" }, { unit: scripts.authTokenId, quantity: "1" }],
    "b".repeat(64),
  );
  const collateral = mkUtxo(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "5000000" }], "f".repeat(64));

  it("rejects the transaction when an extra AuthToken UTxO is included as wallet funding", () => {
    const strayAuthTokenUtxo = mkUtxo(
      WALLET_ADDRESS,
      [{ unit: "lovelace", quantity: "2000000" }, { unit: scripts.authTokenId, quantity: "1" }],
      "e".repeat(64),
    );

    expect(() =>
      buildProxySpendTx({
        txBuilder: createNoopTxBuilder(),
        network: 0,
        proxyAddress: scripts.proxyAddress,
        paramUtxo: PROXY_PARAM_UTXO,
        walletUtxos: [strayAuthTokenUtxo],
        proxyUtxos: [],
        authTokenUtxo,
        collateral,
        outputs: [{ address: WALLET_ADDRESS, unit: "lovelace", amount: "1000000" }],
        walletAddress: WALLET_ADDRESS,
      }),
    ).toThrow(/additional AuthToken UTxO/i);
  });

  it("still builds normally when walletUtxos only contains plain ADA funding", () => {
    const plainAda = mkUtxo(WALLET_ADDRESS, [{ unit: "lovelace", quantity: "5000000" }], "c".repeat(64));

    expect(() =>
      buildProxySpendTx({
        txBuilder: createNoopTxBuilder(),
        network: 0,
        proxyAddress: scripts.proxyAddress,
        paramUtxo: PROXY_PARAM_UTXO,
        walletUtxos: [plainAda],
        proxyUtxos: [],
        authTokenUtxo,
        collateral,
        outputs: [{ address: WALLET_ADDRESS, unit: "lovelace", amount: "1000000" }],
        walletAddress: WALLET_ADDRESS,
      }),
    ).not.toThrow();
  });
});
