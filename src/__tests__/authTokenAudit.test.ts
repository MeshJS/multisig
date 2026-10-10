import { describe, expect, it } from "@jest/globals";
import { csl } from "@meshsdk/core-csl";
import { auditAuthTokenOutputs, formatAuthTokenAuditError } from "@/lib/proxy/authTokenAudit";
import { auditBuiltProxyTx } from "@/lib/server/proxyAuthTokenAudit";

const POLICY = "d".repeat(56);
const OTHER_POLICY = "e".repeat(56);

function enterpriseAddress(keyHashHex: string): string {
  return csl.EnterpriseAddress.new(
    csl.NetworkInfo.testnet_preview().network_id(),
    csl.Credential.from_keyhash(csl.Ed25519KeyHash.from_hex(keyHashHex)),
  )
    .to_address()
    .to_bech32();
}

const WALLET = enterpriseAddress("1".repeat(56));
const PROXY = enterpriseAddress("2".repeat(56));
const STRANGER = enterpriseAddress("3".repeat(56));

type OutputSpec = {
  address: string;
  lovelace?: string;
  tokens?: { policy: string; quantity: string; name?: string }[];
};

function buildTxHex(specs: OutputSpec[]): string {
  const inputs = csl.TransactionInputs.new();
  inputs.add(
    csl.TransactionInput.new(csl.TransactionHash.from_bytes(Buffer.from("00".repeat(32), "hex")), 0),
  );

  const outputs = csl.TransactionOutputs.new();
  for (const spec of specs) {
    const value = csl.Value.new(csl.BigNum.from_str(spec.lovelace ?? "2000000"));
    if (spec.tokens && spec.tokens.length > 0) {
      const multiasset = csl.MultiAsset.new();
      for (const token of spec.tokens) {
        const assets = csl.Assets.new();
        assets.insert(
          csl.AssetName.new(Buffer.from(token.name ?? "", "hex")),
          csl.BigNum.from_str(token.quantity),
        );
        multiasset.insert(csl.ScriptHash.from_hex(token.policy), assets);
      }
      value.set_multiasset(multiasset);
    }
    outputs.add(csl.TransactionOutput.new(csl.Address.from_bech32(spec.address), value));
  }

  const body = csl.TransactionBody.new(inputs, outputs, csl.BigNum.from_str("200000"), undefined);
  return csl.Transaction.new(body, csl.TransactionWitnessSet.new(), undefined).to_hex();
}

describe("auditAuthTokenOutputs", () => {
  it("passes when every auth token returns to the wallet as a 1-token output", () => {
    const txCbor = buildTxHex([
      { address: WALLET, tokens: [{ policy: POLICY, quantity: "1" }] },
      { address: WALLET, tokens: [{ policy: POLICY, quantity: "1" }] },
      { address: PROXY, lovelace: "9000000" },
      { address: STRANGER, lovelace: "1000000" },
    ]);

    expect(auditAuthTokenOutputs({ txCbor, authTokenIds: [POLICY], walletAddress: WALLET })).toEqual({
      ok: true,
      tokenOutputs: 2,
    });
  });

  it("passes a burn (no token outputs at all)", () => {
    const txCbor = buildTxHex([{ address: WALLET, lovelace: "5000000" }]);
    expect(auditAuthTokenOutputs({ txCbor, authTokenIds: [POLICY], walletAddress: WALLET })).toEqual({
      ok: true,
      tokenOutputs: 0,
    });
  });

  it("fails when a token lands at the proxy address (the drain scenario)", () => {
    const txCbor = buildTxHex([
      { address: WALLET, tokens: [{ policy: POLICY, quantity: "1" }] },
      { address: PROXY, lovelace: "9000000", tokens: [{ policy: POLICY, quantity: "1" }] },
    ]);

    const result = auditAuthTokenOutputs({ txCbor, authTokenIds: [POLICY], walletAddress: WALLET });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.violations).toHaveLength(1);
      expect(result.violations[0]).toMatch(/output #1 .* address other than the multisig wallet/);
    }
  });

  it("fails when a token goes to any third-party address", () => {
    const txCbor = buildTxHex([{ address: STRANGER, tokens: [{ policy: POLICY, quantity: "1" }] }]);
    const result = auditAuthTokenOutputs({ txCbor, authTokenIds: [POLICY], walletAddress: WALLET });
    expect(result.ok).toBe(false);
  });

  it("allows tokens bundled into one output at the wallet (cleanup sweep, ordinary wallet change)", () => {
    const txCbor = buildTxHex([{ address: WALLET, tokens: [{ policy: POLICY, quantity: "10" }] }]);
    expect(auditAuthTokenOutputs({ txCbor, authTokenIds: [POLICY], walletAddress: WALLET })).toEqual({
      ok: true,
      tokenOutputs: 1,
    });
  });

  it("still fails when a bundled token output is anywhere but the wallet", () => {
    const txCbor = buildTxHex([{ address: PROXY, tokens: [{ policy: POLICY, quantity: "10" }] }]);
    const result = auditAuthTokenOutputs({ txCbor, authTokenIds: [POLICY], walletAddress: WALLET });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violations[0]).toMatch(/sends 10 auth token\(s\)/);
  });

  it("ignores unrelated policies and checks all listed proxies", () => {
    const txCbor = buildTxHex([
      { address: STRANGER, tokens: [{ policy: OTHER_POLICY, quantity: "7" }] },
      { address: WALLET, tokens: [{ policy: POLICY, quantity: "1" }] },
    ]);

    expect(
      auditAuthTokenOutputs({ txCbor, authTokenIds: [POLICY], walletAddress: WALLET }).ok,
    ).toBe(true);
    expect(
      auditAuthTokenOutputs({ txCbor, authTokenIds: [POLICY, OTHER_POLICY], walletAddress: WALLET }).ok,
    ).toBe(false);
  });

  it("is a no-op when the wallet has no auth token policies", () => {
    const txCbor = buildTxHex([{ address: STRANGER, tokens: [{ policy: POLICY, quantity: "1" }] }]);
    expect(auditAuthTokenOutputs({ txCbor, authTokenIds: [], walletAddress: WALLET })).toEqual({
      ok: true,
      tokenOutputs: 0,
    });
  });

  it("fails closed on undecodable CBOR and on an unparsable wallet address", () => {
    const bad = auditAuthTokenOutputs({ txCbor: "not-cbor", authTokenIds: [POLICY], walletAddress: WALLET });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.violations[0]).toMatch(/could not be decoded/);

    const txCbor = buildTxHex([{ address: WALLET, tokens: [{ policy: POLICY, quantity: "1" }] }]);
    const badAddr = auditAuthTokenOutputs({ txCbor, authTokenIds: [POLICY], walletAddress: "nope" });
    expect(badAddr.ok).toBe(false);
  });

  it("accepts the wallet address in hex as well as bech32", () => {
    const txCbor = buildTxHex([{ address: WALLET, tokens: [{ policy: POLICY, quantity: "1" }] }]);
    const walletHex = csl.Address.from_bech32(WALLET).to_hex();
    expect(
      auditAuthTokenOutputs({ txCbor, authTokenIds: [POLICY], walletAddress: walletHex }).ok,
    ).toBe(true);
  });
});

describe("auditBuiltProxyTx", () => {
  it("returns null for a safe transaction and a formatted message otherwise", () => {
    const safe = buildTxHex([{ address: WALLET, tokens: [{ policy: POLICY, quantity: "1" }] }]);
    expect(
      auditBuiltProxyTx({ txCbor: safe, authTokenIds: [POLICY], walletAddress: WALLET, context: "test" }),
    ).toBeNull();

    const unsafe = buildTxHex([{ address: PROXY, tokens: [{ policy: POLICY, quantity: "1" }] }]);
    const message = auditBuiltProxyTx({
      txCbor: unsafe,
      authTokenIds: [POLICY],
      walletAddress: WALLET,
      context: "test",
    });
    expect(message).toMatch(/^Transaction moves a proxy auth token away from the wallet address/);
    expect(formatAuthTokenAuditError({ violations: ["x"] })).toBe(
      "Transaction moves a proxy auth token away from the wallet address: x",
    );
  });
});
