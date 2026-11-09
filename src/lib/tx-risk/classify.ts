import { csl } from "@meshsdk/core-csl";
import { resolveScriptHash } from "@meshsdk/core";
import type { PaymentControl, RiskContext } from "./types";

/** Exact identity, not a heuristic for arbitrary scripts with similar code. */
export const ALWAYS_TRUE_V2 = Object.freeze({
  id: "hydra-always-true-v2",
  version: "V2" as const,
  cbor: "49480100002221200101",
  hash: "3a888d65f16790950a72daee1f63aa05add6d268434107cfa5b67712",
  source:
    "https://hydra.family/head-protocol/unstable/docs/how-to/commit-script-utxo",
});

export const networkId = (network: number) => (network === 1 ? 1 : 0);

/** Reads PAYMENT, never stake, credentials. Reward and legacy addresses are not guessed. */
export function paymentCredential(address: string) {
  const parsed = csl.Address.from_bech32(address);
  // whisky's payment_cred() also returns the staking credential of reward
  // addresses. Check the address kind before interpreting that accessor.
  if (
    ![
      csl.AddressKind.Base,
      csl.AddressKind.Enterprise,
      csl.AddressKind.Pointer,
    ].includes(parsed.kind())
  )
    throw new Error("A supported payment address is required.");
  const credential = parsed.payment_cred();
  if (!credential) throw new Error("A supported payment address is required.");
  const script = credential.to_scripthash();
  const key = credential.to_keyhash();
  if (!script && !key) throw new Error("Cannot decode payment credential.");
  return {
    networkId: parsed.network_id(),
    kind: script ? ("script" as const) : ("key" as const),
    paymentHash: (script ?? key)!.to_hex(),
  };
}

/** Throws on a mismatched wallet context rather than accepting a claimed own address. */
export function verifiedWalletScriptHash(ctx: RiskContext): string | undefined {
  const wallet = ctx.walletNativeScript;
  if (!wallet) return undefined;
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(wallet.cbor))
    throw new Error("Invalid wallet native script hex.");
  const payment = paymentCredential(wallet.address);
  const hash = csl.NativeScript.from_hex(wallet.cbor).hash().to_hex();
  if (
    payment.kind !== "script" ||
    payment.paymentHash !== hash ||
    payment.networkId !== networkId(ctx.network)
  ) {
    throw new Error(
      "The wallet native script does not match its payment address and network.",
    );
  }
  return hash;
}

export function classifyPaymentAddress(
  address: string,
  ctx: RiskContext,
): PaymentControl {
  const payment = paymentCredential(address);
  if (payment.networkId !== networkId(ctx.network))
    throw new Error("Payment address is on a different network.");
  if (payment.kind === "key") return { ...payment, kind: "key" };
  // Known danger wins over contextual exemptions. Never use an address allowlist.
  if (payment.paymentHash === ALWAYS_TRUE_V2.hash)
    return { ...payment, kind: "known-anyone-can-spend" };
  if (payment.paymentHash === verifiedWalletScriptHash(ctx))
    return { ...payment, kind: "wallet-native-script" };
  return { ...payment, kind: "unknown-script" };
}

/** For supplied draft scripts: language is part of the hash. No code-text heuristics. */
export function assertSuppliedScriptMatches(
  address: string,
  script: { version: "V1" | "V2" | "V3"; cbor: string },
) {
  const payment = paymentCredential(address);
  if (
    !/^(?:[0-9a-fA-F]{2})+$/.test(script.cbor) ||
    !["V1", "V2", "V3"].includes(script.version) ||
    payment.kind !== "script" ||
    resolveScriptHash(script.cbor, script.version) !== payment.paymentHash
  )
    throw new Error(
      "Supplied script and language do not match the input payment script hash.",
    );
}
