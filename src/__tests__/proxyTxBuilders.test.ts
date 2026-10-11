import { describe, expect, it } from "@jest/globals";
import { deserializeAddress } from "@meshsdk/core";
import type { UTxO } from "@meshsdk/core";
import {
  buildProxyDRepCertificateTx,
  buildProxyCleanupTx,
  buildProxyCleanupSweepTx,
  buildProxyVoteTx,
  buildProxySetupTx,
  DEFAULT_PROXY_SETUP_LOVELACE,
  deriveProxyScripts,
  findProxyAddressInOutputs,
  proxyStakeCredentialFromAddress,
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
    // Swept value and the preserved auth token share one wallet output so the token
    // UTxO keeps enough ADA to fund the burn that follows.
    expect(sweepBuilder.txOuts).toEqual([
      {
        address: "addr_test_wallet",
        amount: [
          { unit: "lovelace", quantity: "2500000" },
          { unit: setup.authTokenId, quantity: "1" },
        ],
      },
    ]);
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

describe("proxy address stake credential", () => {
  const paramUtxo = { txHash: "a".repeat(64), outputIndex: 0 };

  it("defaults new proxies to the proxy script itself as a script stake credential", () => {
    const scripts = deriveProxyScripts({ paramUtxo, network: 0 });
    const parsed = deserializeAddress(scripts.proxyAddress);
    expect(parsed.scriptHash).toBe(scripts.proxyScriptHash);
    expect(parsed.stakeScriptCredentialHash).toBe(scripts.proxyScriptHash);
    expect(parsed.stakeCredentialHash).toBe("");
    expect(scripts.proxyAddress.startsWith("addr_test1")).toBe(true);
  });

  it("round-trips existing proxies through proxyStakeCredentialFromAddress (self, key, none)", () => {
    const self = deriveProxyScripts({ paramUtxo, network: 0 });
    expect(proxyStakeCredentialFromAddress(self.proxyAddress)).toEqual({
      kind: "script",
      hash: self.proxyScriptHash,
    });
    expect(
      deriveProxyScripts({ paramUtxo, network: 0, stake: proxyStakeCredentialFromAddress(self.proxyAddress) })
        .proxyAddress,
    ).toBe(self.proxyAddress);

    // Legacy v1 derivation: base address with a key-hash stake part.
    const legacyKeyHash = "c08f0294ead5ab7ae0ce5471dd487007919297ba95230af22f25e575";
    const legacy = deriveProxyScripts({ paramUtxo, network: 0, stake: { kind: "key", hash: legacyKeyHash } });
    expect(legacy.proxyAddress).not.toBe(self.proxyAddress);
    expect(proxyStakeCredentialFromAddress(legacy.proxyAddress)).toEqual({ kind: "key", hash: legacyKeyHash });
    expect(
      deriveProxyScripts({ paramUtxo, network: 0, stake: proxyStakeCredentialFromAddress(legacy.proxyAddress) })
        .proxyAddress,
    ).toBe(legacy.proxyAddress);

    // Legacy browser derivation: enterprise address.
    const enterprise = deriveProxyScripts({ paramUtxo, network: 0, stake: { kind: "none" } });
    expect(enterprise.proxyAddress).not.toBe(self.proxyAddress);
    expect(proxyStakeCredentialFromAddress(enterprise.proxyAddress)).toEqual({ kind: "none" });
    expect(
      deriveProxyScripts({ paramUtxo, network: 0, stake: proxyStakeCredentialFromAddress(enterprise.proxyAddress) })
        .proxyAddress,
    ).toBe(enterprise.proxyAddress);

    // The payment part, token policy and DRep id never depend on the stake part.
    for (const variant of [legacy, enterprise]) {
      expect(variant.authTokenId).toBe(self.authTokenId);
      expect(variant.dRepId).toBe(self.dRepId);
      expect(deserializeAddress(variant.proxyAddress).scriptHash).toBe(self.proxyScriptHash);
    }
  });

  it("findProxyAddressInOutputs picks the output paid to the proxy script regardless of stake part", () => {
    const self = deriveProxyScripts({ paramUtxo, network: 0 });
    const legacy = deriveProxyScripts({
      paramUtxo,
      network: 0,
      stake: { kind: "key", hash: "c08f0294ead5ab7ae0ce5471dd487007919297ba95230af22f25e575" },
    });
    const walletAddr = mkUtxo("addr_test_wallet", "1").output.address;
    expect(findProxyAddressInOutputs([walletAddr, legacy.proxyAddress], self.proxyScriptHash)).toBe(
      legacy.proxyAddress,
    );
    expect(findProxyAddressInOutputs([walletAddr, "not-an-address"], self.proxyScriptHash)).toBeNull();
  });

  it("buildProxySetupTx funds the self-staked proxy address", () => {
    const { builder, txOuts } = createTxBuilderMock();
    const setup = buildProxySetupTx({
      txBuilder: builder as never,
      network: 0,
      walletUtxos: [mkUtxo("addr_test_wallet", "25000000", "b".repeat(64), 1)],
      walletAddress: "addr_test_wallet",
      collateral: mkUtxo("addr_test_collateral", "5000000", "d".repeat(64), 3),
    });
    const expected = deriveProxyScripts({ paramUtxo: setup.paramUtxo, network: 0 });
    expect(setup.proxyAddress).toBe(expected.proxyAddress);
    expect(txOuts.some((out) => out.address === expected.proxyAddress)).toBe(true);
  });
});
