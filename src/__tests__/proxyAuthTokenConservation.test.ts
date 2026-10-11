import { describe, expect, it } from "@jest/globals";
import type { UTxO } from "@meshsdk/core";
import { countAuthTokens } from "@/lib/proxy/utxoUtils";
import {
  buildProxyCleanupSweepTx,
  buildProxyDRepCertificateTx,
  buildProxySpendTx,
  buildProxyVoteTx,
  deriveProxyScripts,
} from "@/lib/proxy/txBuilders";

/**
 * Regression suite for the proxy auth-token leak (PR #396).
 *
 * The on-chain proxy validator passes whenever *some* output carries the auth-token
 * policy and never checks who holds it. `buildProxySpendTx` sends change to the proxy
 * address, so an auth token that is spent but not explicitly returned to the wallet
 * lands at the proxy address and makes it drainable by anyone. These tests pin the
 * off-chain invariant: every token that enters as an input leaves at the wallet
 * address (split 1 per output for spend/DRep/vote, bundled for the cleanup sweep),
 * and nothing token-bearing goes anywhere else.
 */

const WALLET = "addr_test_wallet";
const PARAM_UTXO = { txHash: "a".repeat(64), outputIndex: 0 };

function mkUtxo(
  address: string,
  amount: UTxO["output"]["amount"],
  txHash: string,
  outputIndex = 0,
): UTxO {
  return { input: { txHash, outputIndex }, output: { address, amount } } as UTxO;
}

function createRecordingBuilder() {
  const txOuts: Array<{ address: string; amount: UTxO["output"]["amount"] }> = [];
  const txIns: Array<{ txHash: string; outputIndex: number }> = [];
  let changeAddress: string | undefined;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const name of [
    "spendingPlutusScriptV3",
    "txInScript",
    "txInInlineDatumPresent",
    "txInRedeemerValue",
    "txInCollateral",
    "drepRegistrationCertificate",
    "drepUpdateCertificate",
    "drepDeregistrationCertificate",
    "certificateScript",
    "certificateRedeemerValue",
    "votePlutusScriptV3",
    "vote",
    "voteScript",
    "voteRedeemerValue",
  ]) {
    builder[name] = chain;
  }
  builder.txIn = (txHash: string, outputIndex: number) => {
    txIns.push({ txHash, outputIndex });
    return builder;
  };
  builder.txOut = (address: string, amount: UTxO["output"]["amount"]) => {
    txOuts.push({ address, amount });
    return builder;
  };
  builder.changeAddress = (address: string) => {
    changeAddress = address;
    return builder;
  };
  return {
    builder: builder as never,
    txOuts,
    txIns,
    getChangeAddress: () => changeAddress,
  };
}

const scripts = deriveProxyScripts({ paramUtxo: PARAM_UTXO, network: 0 });
const TOKEN = scripts.authTokenId;

const tokenUtxo = (txHash: string, quantity = "1", lovelace = "2000000") =>
  mkUtxo(
    WALLET,
    [
      { unit: "lovelace", quantity: lovelace },
      { unit: TOKEN, quantity },
    ],
    txHash,
  );
const adaUtxo = (txHash: string, lovelace = "5000000") =>
  mkUtxo(WALLET, [{ unit: "lovelace", quantity: lovelace }], txHash);
const collateral = mkUtxo(WALLET, [{ unit: "lovelace", quantity: "5000000" }], "f".repeat(64));

function tokenOutputs(txOuts: Array<{ address: string; amount: UTxO["output"]["amount"] }>) {
  return txOuts.filter((out) => out.amount.some((asset) => asset.unit === TOKEN));
}

function tokensSentTo(
  txOuts: Array<{ address: string; amount: UTxO["output"]["amount"] }>,
  address: string,
): bigint {
  return txOuts
    .filter((out) => out.address === address)
    .flatMap((out) => out.amount)
    .filter((asset) => asset.unit === TOKEN)
    .reduce((sum, asset) => sum + BigInt(asset.quantity), 0n);
}

describe("countAuthTokens", () => {
  it("sums the auth-token unit across UTxOs and ignores duplicates by ref", () => {
    const a = tokenUtxo("b".repeat(64));
    const b = tokenUtxo("c".repeat(64), "2");
    expect(countAuthTokens([a, b, a, adaUtxo("d".repeat(64))], TOKEN)).toBe(3n);
    expect(countAuthTokens([adaUtxo("d".repeat(64))], TOKEN)).toBe(0n);
  });
});

describe("buildProxySpendTx auth-token conservation", () => {
  const defaultProxyUtxos = () => [
    mkUtxo(scripts.proxyAddress, [{ unit: "lovelace", quantity: "10000000" }], "e".repeat(64)),
  ];
  const spend = (
    walletUtxos: UTxO[],
    authTokenUtxo: UTxO,
    proxyUtxos: UTxO[] = defaultProxyUtxos(),
  ) => {
    const rec = createRecordingBuilder();
    buildProxySpendTx({
      txBuilder: rec.builder,
      network: 0,
      proxyAddress: scripts.proxyAddress,
      paramUtxo: PARAM_UTXO,
      walletUtxos,
      proxyUtxos,
      authTokenUtxo,
      collateral,
      outputs: [{ address: "addr_test_payee", unit: "lovelace", amount: "1000000" }],
      walletAddress: WALLET,
    });
    return rec;
  };

  it("returns exactly one token to the wallet for a single designated token input", () => {
    const designated = tokenUtxo("b".repeat(64));
    const rec = spend([designated, adaUtxo("c".repeat(64))], designated);

    expect(rec.getChangeAddress()).toBe(scripts.proxyAddress);
    expect(tokensSentTo(rec.txOuts, WALLET)).toBe(1n);
    expect(tokensSentTo(rec.txOuts, scripts.proxyAddress)).toBe(0n);
  });

  it("returns every stray token in walletUtxos to the wallet as separate 1-token outputs (the PR #396 leak)", () => {
    const designated = tokenUtxo("b".repeat(64));
    const stray1 = tokenUtxo("c".repeat(64));
    const stray2 = tokenUtxo("d".repeat(64));
    const rec = spend([stray1, adaUtxo("9".repeat(64)), stray2], designated);

    const inputTokens = countAuthTokens([designated, stray1, stray2], TOKEN);
    expect(inputTokens).toBe(3n);
    expect(tokensSentTo(rec.txOuts, WALLET)).toBe(3n);
    expect(tokensSentTo(rec.txOuts, scripts.proxyAddress)).toBe(0n);
    expect(tokenOutputs(rec.txOuts)).toHaveLength(3);
    for (const out of tokenOutputs(rec.txOuts)) {
      expect(out.address).toBe(WALLET);
      expect(out.amount).toEqual([{ unit: TOKEN, quantity: "1" }]);
    }
    // All three token UTxOs are spent exactly once.
    expect(rec.txIns.filter((i) => [designated, stray1, stray2].some((u) => u.input.txHash === i.txHash))).toHaveLength(3);
  });

  it("splits a designated UTxO that bundles several tokens back into 1-token outputs", () => {
    const designated = tokenUtxo("b".repeat(64), "2");
    const rec = spend([], designated);

    expect(tokensSentTo(rec.txOuts, WALLET)).toBe(2n);
    expect(tokenOutputs(rec.txOuts)).toHaveLength(2);
    expect(tokensSentTo(rec.txOuts, scripts.proxyAddress)).toBe(0n);
  });

  it("does not double-spend the designated UTxO when it is also listed in walletUtxos", () => {
    const designated = tokenUtxo("b".repeat(64));
    const rec = spend([designated, adaUtxo("c".repeat(64))], designated);

    expect(rec.txIns.filter((i) => i.txHash === designated.input.txHash)).toHaveLength(1);
    expect(tokensSentTo(rec.txOuts, WALLET)).toBe(1n);
  });

  it("refuses to build when no input carries the auth token", () => {
    const notAToken = adaUtxo("b".repeat(64));
    expect(() => spend([], notAToken)).toThrow(/requires an input holding the proxy auth token/);
  });

  it("recovers a token that was previously leaked to the proxy address instead of recycling it into proxy change", () => {
    const designated = tokenUtxo("b".repeat(64));
    const leakedProxyUtxo = mkUtxo(
      scripts.proxyAddress,
      [
        { unit: "lovelace", quantity: "10000000" },
        { unit: TOKEN, quantity: "1" },
      ],
      "e".repeat(64),
    );
    const rec = spend([designated], designated, [leakedProxyUtxo]);

    // 1 from the wallet + 1 recovered from the proxy, both back at the wallet, split.
    expect(tokensSentTo(rec.txOuts, WALLET)).toBe(2n);
    expect(tokenOutputs(rec.txOuts)).toHaveLength(2);
    expect(tokensSentTo(rec.txOuts, scripts.proxyAddress)).toBe(0n);
    expect(rec.getChangeAddress()).toBe(scripts.proxyAddress);
  });
});

describe("buildProxyCleanupSweepTx auth-token conservation", () => {
  it("accepts all wallet token UTxOs (cleanup passes every token) and bundles them into the swept-value output", () => {
    const designated = tokenUtxo("b".repeat(64));
    const others = Array.from({ length: 9 }, (_, i) =>
      tokenUtxo((i + 1).toString(16).padStart(1, "0").repeat(64)),
    );
    const rec = createRecordingBuilder();
    const result = buildProxyCleanupSweepTx({
      txBuilder: rec.builder,
      network: 0,
      paramUtxo: PARAM_UTXO,
      proxyAddress: scripts.proxyAddress,
      proxyUtxos: [mkUtxo(scripts.proxyAddress, [{ unit: "lovelace", quantity: "2500000" }], "e".repeat(64))],
      walletUtxos: [designated, ...others],
      authTokenUtxo: designated,
      collateral,
      walletAddress: WALLET,
    });

    expect(result).toEqual({ sweptProxyUtxos: "1", preservedAuthTokens: "10" });
    expect(rec.getChangeAddress()).toBe(WALLET);
    expect(tokensSentTo(rec.txOuts, WALLET)).toBe(10n);
    expect(tokensSentTo(rec.txOuts, scripts.proxyAddress)).toBe(0n);
    // One output carrying the swept proxy ADA *and* all tokens. The burn that follows
    // is typically funded with token UTxOs alone, so the tokens must keep real ADA with
    // them: a token-only output would get bare min-ADA and the burn could not pay its
    // fee plus a min-ADA change ("UTxO Fully Depleted"). Splitting 1-per-output would
    // starve the sweep itself the same way.
    expect(rec.txOuts).toEqual([
      {
        address: WALLET,
        amount: [
          { unit: "lovelace", quantity: "2500000" },
          { unit: TOKEN, quantity: "10" },
        ],
      },
    ]);
  });

  it("recovers a token that had previously leaked to the proxy address", () => {
    const designated = tokenUtxo("b".repeat(64));
    const leakedAtProxy = mkUtxo(
      scripts.proxyAddress,
      [
        { unit: "lovelace", quantity: "3000000" },
        { unit: TOKEN, quantity: "1" },
      ],
      "e".repeat(64),
    );
    const rec = createRecordingBuilder();
    const result = buildProxyCleanupSweepTx({
      txBuilder: rec.builder,
      network: 0,
      paramUtxo: PARAM_UTXO,
      proxyAddress: scripts.proxyAddress,
      proxyUtxos: [leakedAtProxy],
      walletUtxos: [designated],
      authTokenUtxo: designated,
      collateral,
      walletAddress: WALLET,
    });

    expect(result.preservedAuthTokens).toBe("2");
    expect(tokensSentTo(rec.txOuts, WALLET)).toBe(2n);
    expect(tokensSentTo(rec.txOuts, scripts.proxyAddress)).toBe(0n);
    // Both tokens (the designated one and the recovered leak) ride in the single
    // swept-value output; the leaked token is not double counted from the proxy value.
    expect(rec.txOuts).toEqual([
      {
        address: WALLET,
        amount: [
          { unit: "lovelace", quantity: "3000000" },
          { unit: TOKEN, quantity: "2" },
        ],
      },
    ]);
  });
});

describe("DRep certificate and vote builders conserve tokens", () => {
  it("vote returns every token selected as funding", () => {
    const designated = tokenUtxo("b".repeat(64), "1", "1500000");
    const stray = tokenUtxo("c".repeat(64), "1", "3000000");
    const rec = createRecordingBuilder();
    buildProxyVoteTx({
      txBuilder: rec.builder,
      network: 0,
      paramUtxo: PARAM_UTXO,
      walletUtxos: [designated, stray],
      authTokenUtxo: designated,
      collateral,
      walletAddress: WALLET,
      votes: [{ proposalId: `${"e".repeat(64)}#0`, voteKind: "Abstain" }],
    });

    // Both UTxOs were needed to reach the 2 ADA minimum, so both tokens come back.
    expect(tokensSentTo(rec.txOuts, WALLET)).toBe(2n);
    expect(tokenOutputs(rec.txOuts)).toHaveLength(2);
  });

  it("DRep deregister returns every token selected as funding", () => {
    const designated = tokenUtxo("b".repeat(64), "1", "1500000");
    const stray = tokenUtxo("c".repeat(64), "1", "3000000");
    const rec = createRecordingBuilder();
    buildProxyDRepCertificateTx({
      txBuilder: rec.builder,
      network: 0,
      paramUtxo: PARAM_UTXO,
      walletUtxos: [designated, stray],
      authTokenUtxo: designated,
      collateral,
      walletAddress: WALLET,
      action: "deregister",
    });

    expect(tokensSentTo(rec.txOuts, WALLET)).toBe(2n);
    expect(tokenOutputs(rec.txOuts)).toHaveLength(2);
  });
});
