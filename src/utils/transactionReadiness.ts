import { csl } from "@meshsdk/core-csl";
import { resolveTxHash } from "@meshsdk/core-cst";
import { deserializeAddress } from "@meshsdk/core";
import { collateralRefs, inspectCollateral } from "@/lib/tx-draft/collateral";
import {
  utxoRefKey,
  type ScriptInputProvider,
} from "@/lib/tx-draft/resolve-script-inputs";
import {
  decodeNativeScriptFromCsl,
  type DecodedNativeScript,
} from "./nativeScriptUtils";

export function verifiedWitnessKeyHashes(txHex: string): Set<string> {
  const witnesses = csl.Transaction.from_hex(txHex).witness_set().vkeys();
  const hash = Buffer.from(resolveTxHash(txHex), "hex");
  const keys = new Set<string>();
  for (let i = 0; i < (witnesses?.len() ?? 0); i++) {
    const witness = witnesses!.get(i);
    const pub = witness.vkey().public_key();
    if (pub.verify(hash, witness.signature())) keys.add(pub.hash().to_hex());
  }
  return keys;
}

export function hasVerifiedPaymentWitness(
  txHex: string,
  address: string,
): boolean {
  return verifiedWitnessKeyHashes(txHex).has(
    deserializeAddress(address).pubKeyHash,
  );
}

export function requiredSignerKeyHashes(txHex: string): string[] {
  const signers = csl.Transaction.from_hex(txHex).body().required_signers();
  return Array.from({ length: signers?.len() ?? 0 }, (_, i) =>
    signers!.get(i).to_hex(),
  );
}

/** Resolve the collateral owner from the original body's references, including legacy proxy transactions. */
export async function transactionReadiness(
  txHex: string,
  authorized: boolean,
  provider: ScriptInputProvider,
  network: number,
) {
  const tx = csl.Transaction.from_hex(txHex);
  const required = new Set(requiredSignerKeyHashes(txHex));
  const collateral = [];
  for (const ref of collateralRefs(txHex)) {
    const historical = (
      await provider.fetchUTxOs(ref.txHash, ref.outputIndex)
    ).find((u) => utxoRefKey(u.input) === utxoRefKey(ref));
    if (!historical)
      throw new Error(
        "Cannot resolve the recorded collateral owner. Check the network and retry.",
      );
    const live = (
      await provider.fetchAddressUTxOs(historical.output.address)
    ).find(
      (u) =>
        utxoRefKey(u.input) === utxoRefKey(ref) &&
        u.output.address === historical.output.address,
    );
    if (!live)
      throw new Error(
        "Recorded collateral is no longer unspent. Rebuild and collect new signatures.",
      );
    const candidate = inspectCollateral(live, network);
    required.add(candidate.ownerKeyHash);
    collateral.push(candidate);
  }
  const keys = verifiedWitnessKeyHashes(txHex);
  const missingKeyHashes = [...required].filter((key) => !keys.has(key));
  // For advanced transactions verify native-script coverage too: a collateral-only
  // wallet response must not satisfy the wallet's recorded signature count.
  const satisfies = (script: DecodedNativeScript): boolean => {
    switch (script.type) {
      case "sig":
        return keys.has(script.keyHash);
      case "all":
        return script.scripts.every(satisfies);
      case "any":
        return script.scripts.some(satisfies);
      case "atLeast":
        return script.scripts.filter(satisfies).length >= script.required;
      case "timelockStart": {
        const start = tx.body().validity_start_interval_bignum();
        return !!start && BigInt(start.to_str()) >= BigInt(script.slot);
      }
      case "timelockExpiry": {
        const end = tx.body().ttl_bignum();
        return !!end && BigInt(end.to_str()) <= BigInt(script.slot);
      }
    }
  };
  const scripts = tx.witness_set().native_scripts();
  const nativeSatisfied =
    required.size === 0 ||
    Array.from({ length: scripts?.len() ?? 0 }, (_, i) =>
      decodeNativeScriptFromCsl(scripts!.get(i)),
    ).every(satisfies);
  return {
    ready: authorized && nativeSatisfied && missingKeyHashes.length === 0,
    missingKeyHashes,
    collateral,
    nativeSatisfied,
  };
}
