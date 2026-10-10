import { describe, expect, it } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";
import {
  buildProxyDRepCertificateTx,
  buildProxyCleanupTx,
  buildProxyCleanupSweepTx,
  buildProxyVoteTx,
  buildProxySetupTx,
  DEFAULT_PROXY_SETUP_LOVELACE,
} from "@/lib/proxy/txBuilders";

const mkUtxo = (
  address: string,
  lovelace: string,
  txHash = "a".repeat(64),
  outputIndex = 0,
): UTxO =>
  ({
    input: { txHash, outputIndex },
    output: {
      address,
      amount: [{ unit: "lovelace", quantity: lovelace }],
    },
  }) as UTxO;

function createTxBuilderMock() {
  const txOuts: Array<{ address: string; amount: UTxO["output"]["amount"] }> = [];
  const mints: Array<{ quantity: string; policyId: string; tokenName: string }> = [];
  const txIns: Array<{ txHash: string; outputIndex: number; address: string }> = [];
  const builder = {
    spendingPlutusScriptV3: () => builder,
    txIn: (
      txHash: string,
      outputIndex: number,
      _amount: UTxO["output"]["amount"],
      address: string,
    ) => {
      txIns.push({ txHash, outputIndex, address });
      return builder;
    },
    txInScript: () => builder,
    txInInlineDatumPresent: () => builder,
    txInRedeemerValue: () => builder,
    mintPlutusScriptV3: () => builder,
    mint: (quantity: string, policyId: string, tokenName: string) => {
      mints.push({ quantity, policyId, tokenName });
      return builder;
    },
    mintingScript: () => builder,
    mintRedeemerValue: () => builder,
    txOut: (address: string, amount: UTxO["output"]["amount"]) => {
      txOuts.push({ address, amount });
      return builder;
    },
    txInCollateral: () => builder,
    changeAddress: () => builder,
    drepRegistrationCertificate: () => builder,
    drepUpdateCertificate: () => builder,
    drepDeregistrationCertificate: () => builder,
    certificateScript: () => builder,
    certificateRedeemerValue: () => builder,
    votePlutusScriptV3: () => builder,
    vote: () => builder,
    voteScript: () => builder,
    voteRedeemerValue: () => builder,
  };

  return { builder, txOuts, mints, txIns };
}

describe("buildProxySetupTx", () => {
  it("defaults the proxy output to the minimal setup lovelace", () => {
    const { builder, txOuts } = createTxBuilderMock();
    const setup = buildProxySetupTx({
      txBuilder: builder as never,
      network: 0,
      walletUtxos: [mkUtxo("addr_test_wallet", "20000000")],
      walletAddress: "addr_test_wallet",
      collateral: mkUtxo("addr_test_collateral", "5000000", "b".repeat(64), 1),
    });

    expect(txOuts).toContainEqual({
      address: setup.proxyAddress,
      amount: [{ unit: "lovelace", quantity: DEFAULT_PROXY_SETUP_LOVELACE }],
    });
  });

  it("uses initialProxyLovelace for the proxy setup output", () => {
    const { builder, txOuts } = createTxBuilderMock();
    const setup = buildProxySetupTx({
      txBuilder: builder as never,
      network: 0,
      walletUtxos: [mkUtxo("addr_test_wallet", "20000000")],
      walletAddress: "addr_test_wallet",
      collateral: mkUtxo("addr_test_collateral", "5000000", "b".repeat(64), 1),
      initialProxyLovelace: "5000000",
    });

    expect(txOuts).toContainEqual({
      address: setup.proxyAddress,
      amount: [{ unit: "lovelace", quantity: "5000000" }],
    });
  });

  it("burns all 10 auth tokens for proxy cleanup", () => {
    const setupBuilder = createTxBuilderMock();
    const setup = buildProxySetupTx({
      txBuilder: setupBuilder.builder as never,
      network: 0,
      walletUtxos: [mkUtxo("addr_test_wallet", "20000000")],
      walletAddress: "addr_test_wallet",
      collateral: mkUtxo("addr_test_collateral", "5000000", "b".repeat(64), 1),
    });

    const cleanupBuilder = createTxBuilderMock();
    const result = buildProxyCleanupTx({
      txBuilder: cleanupBuilder.builder as never,
      network: 0,
      paramUtxo: setup.paramUtxo,
      walletUtxos: [
        ({
          ...mkUtxo("addr_test_wallet", "3000000", "c".repeat(64), 2),
          output: {
            address: "addr_test_wallet",
            amount: [
              { unit: "lovelace", quantity: "3000000" },
              { unit: setup.authTokenId, quantity: "10" },
            ],
          },
        }) as UTxO,
      ],
      collateral: mkUtxo("addr_test_collateral", "5000000", "d".repeat(64), 3),
      walletAddress: "addr_test_wallet",
      authTokenId: setup.authTokenId,
    });

    expect(result).toEqual({ burnedAuthTokens: "10" });
    expect(cleanupBuilder.mints).toContainEqual({
      quantity: "-10",
      policyId: setup.authTokenId,
      tokenName: "",
    });
  });

  it("sweeps proxy UTxOs back to the wallet while preserving an auth token", () => {
    const setupBuilder = createTxBuilderMock();
    const setup = buildProxySetupTx({
      txBuilder: setupBuilder.builder as never,
      network: 0,
      walletUtxos: [mkUtxo("addr_test_wallet", "20000000")],
      walletAddress: "addr_test_wallet",
      collateral: mkUtxo("addr_test_collateral", "5000000", "b".repeat(64), 1),
    });

    const sweepBuilder = createTxBuilderMock();
    const result = buildProxyCleanupSweepTx({
      txBuilder: sweepBuilder.builder as never,
      network: 0,
      paramUtxo: setup.paramUtxo,
      proxyAddress: setup.proxyAddress,
      proxyUtxos: [mkUtxo(setup.proxyAddress, "2500000", "c".repeat(64), 2)],
      walletUtxos: [
        ({
          ...mkUtxo("addr_test_wallet", "3000000", "d".repeat(64), 3),
          output: {
            address: "addr_test_wallet",
            amount: [
              { unit: "lovelace", quantity: "3000000" },
              { unit: setup.authTokenId, quantity: "1" },
            ],
          },
        }) as UTxO,
      ],
      authTokenUtxo: ({
        ...mkUtxo("addr_test_wallet", "3000000", "d".repeat(64), 3),
        output: {
          address: "addr_test_wallet",
          amount: [
            { unit: "lovelace", quantity: "3000000" },
            { unit: setup.authTokenId, quantity: "1" },
          ],
        },
      }) as UTxO,
      collateral: mkUtxo("addr_test_collateral", "5000000", "e".repeat(64), 4),
      walletAddress: "addr_test_wallet",
    });

    expect(result).toEqual({ sweptProxyUtxos: "1", preservedAuthTokens: "1" });
    expect(sweepBuilder.txIns).toContainEqual({
      txHash: "c".repeat(64),
      outputIndex: 2,
      address: setup.proxyAddress,
    });
    expect(sweepBuilder.txOuts).toContainEqual({
      address: "addr_test_wallet",
      amount: expect.arrayContaining([
        { unit: "lovelace", quantity: "2500000" },
        { unit: setup.authTokenId, quantity: "1" },
      ]),
    });
    expect(sweepBuilder.mints).toEqual([]);
  });
});

describe("proxy action funding validation", () => {
  it("rejects proxy vote inputs that cannot preserve the auth token output", () => {
    const setupBuilder = createTxBuilderMock();
    const setup = buildProxySetupTx({
      txBuilder: setupBuilder.builder as never,
      network: 0,
      walletUtxos: [mkUtxo("addr_test_wallet", "20000000")],
      walletAddress: "addr_test_wallet",
      collateral: mkUtxo("addr_test_collateral", "5000000", "b".repeat(64), 1),
    });
    const authTokenUtxo = {
      ...mkUtxo("addr_test_wallet", "1200000", "c".repeat(64), 2),
      output: {
        address: "addr_test_wallet",
        amount: [
          { unit: "lovelace", quantity: "1200000" },
          { unit: setup.authTokenId, quantity: "1" },
        ],
      },
    } as UTxO;

    expect(() =>
      buildProxyVoteTx({
        txBuilder: createTxBuilderMock().builder as never,
        network: 0,
        paramUtxo: setup.paramUtxo,
        walletUtxos: [authTokenUtxo],
        authTokenUtxo,
        collateral: mkUtxo("addr_test_collateral", "5000000", "d".repeat(64), 3),
        walletAddress: "addr_test_wallet",
        votes: [{ proposalId: `${"e".repeat(64)}#0`, voteKind: "Abstain" }],
      }),
    ).toThrow(/proxy vote requires at least 2 ADA in selected wallet inputs, but only 1.2 ADA was selected/);
  });

  it("rejects proxy DRep deregister inputs that cannot preserve the auth token output", () => {
    const setupBuilder = createTxBuilderMock();
    const setup = buildProxySetupTx({
      txBuilder: setupBuilder.builder as never,
      network: 0,
      walletUtxos: [mkUtxo("addr_test_wallet", "20000000")],
      walletAddress: "addr_test_wallet",
      collateral: mkUtxo("addr_test_collateral", "5000000", "b".repeat(64), 1),
    });
    const authTokenUtxo = {
      ...mkUtxo("addr_test_wallet", "1200000", "c".repeat(64), 2),
      output: {
        address: "addr_test_wallet",
        amount: [
          { unit: "lovelace", quantity: "1200000" },
          { unit: setup.authTokenId, quantity: "1" },
        ],
      },
    } as UTxO;

    expect(() =>
      buildProxyDRepCertificateTx({
        txBuilder: createTxBuilderMock().builder as never,
        network: 0,
        paramUtxo: setup.paramUtxo,
        walletUtxos: [authTokenUtxo],
        authTokenUtxo,
        collateral: mkUtxo("addr_test_collateral", "5000000", "d".repeat(64), 3),
        walletAddress: "addr_test_wallet",
        action: "deregister",
      }),
    ).toThrow(/proxy DRep deregister requires at least 2 ADA in selected wallet inputs, but only 1.2 ADA was selected/);
  });
});
