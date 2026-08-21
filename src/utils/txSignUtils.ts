import { csl } from "@meshsdk/core-csl";
import {
  resolveTxHash,
  addVKeyWitnessSetToTransaction,
  Transaction as CstTransaction,
  TxCBOR,
  CborSet,
  VkeyWitness,
} from "@meshsdk/core-cst";
import {
  decodeNativeScriptFromCsl,
  collectSigKeyHashes,
} from "@/utils/nativeScriptUtils";

// The tx is BUILT with core-cst (MeshTxBuilder's default CardanoSDK serializer),
// so the wallet signs the body hash core-cst produces. The old verify path used
// core-csl's calculateTxHash, which re-serializes the body to *different* bytes
// (notably Conway `voting_procedures` map order / set tag 258) — a different
// hash, so valid witnesses failed to verify ("witness does not verify against tx
// body hash"). Everything here now hashes and merges via core-cst so build and
// verify agree, and the original body bytes every signer signed are preserved.
//
// core-cst VkeyWitness.toCore() returns a [pubKeyHex, signatureHex] tuple.
function cstVkeyPubKeyHex(vkw: { toCore: () => unknown }): string {
  const core = vkw.toCore() as unknown;
  const pub = Array.isArray(core)
    ? (core[0] as string)
    : ((core as { vkey: string }).vkey);
  return String(pub).toLowerCase();
}

function toKeyHashHex(publicKey: csl.PublicKey): string {
  return Array.from(publicKey.hash().to_bytes())
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}

function toPubKeyHex(publicKey: csl.PublicKey): string {
  return Array.from(publicKey.as_bytes())
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}

function cloneVkeyWitnesses(
  witnessSet: csl.TransactionWitnessSet,
): csl.Vkeywitnesses {
  const existingVkeys = witnessSet.vkeys();
  if (!existingVkeys) {
    return csl.Vkeywitnesses.new();
  }
  return csl.Vkeywitnesses.from_bytes(existingVkeys.to_bytes());
}

function mergeUniqueWitnesses(
  targetVkeys: csl.Vkeywitnesses,
  incomingVkeys: csl.Vkeywitnesses,
): { mergedVkeys: csl.Vkeywitnesses; addedCount: number } {
  const existingKeyHashes = new Set<string>();
  const existingVkeyCount = targetVkeys.len();
  for (let i = 0; i < existingVkeyCount; i++) {
    const existingWitness = targetVkeys.get(i);
    existingKeyHashes.add(toKeyHashHex(existingWitness.vkey().public_key()));
  }

  let addedCount = 0;
  const incomingVkeyCount = incomingVkeys.len();
  for (let i = 0; i < incomingVkeyCount; i++) {
    const incomingWitness = incomingVkeys.get(i);
    const incomingKeyHash = toKeyHashHex(incomingWitness.vkey().public_key());
    if (!existingKeyHashes.has(incomingKeyHash)) {
      targetVkeys.add(incomingWitness);
      existingKeyHashes.add(incomingKeyHash);
      addedCount += 1;
    }
  }

  return { mergedVkeys: targetVkeys, addedCount };
}

export function extractVkeyWitnesses(signedPayloadHex: string): csl.Vkeywitnesses {
  try {
    const signedTx = csl.Transaction.from_hex(signedPayloadHex);
    const txVkeys = signedTx.witness_set().vkeys();
    if (!txVkeys) {
      return csl.Vkeywitnesses.new();
    }
    return csl.Vkeywitnesses.from_bytes(txVkeys.to_bytes());
  } catch {
    const witnessSet = csl.TransactionWitnessSet.from_hex(signedPayloadHex);
    const witnessVkeys = witnessSet.vkeys();
    if (!witnessVkeys) {
      return csl.Vkeywitnesses.new();
    }
    return csl.Vkeywitnesses.from_bytes(witnessVkeys.to_bytes());
  }
}

export function createVkeyWitnessFromHex(
  keyHex: string,
  signatureHex: string,
): {
  publicKey: csl.PublicKey;
  signature: csl.Ed25519Signature;
  witness: csl.Vkeywitness;
  keyHashHex: string;
} {
  const publicKey = csl.PublicKey.from_hex(keyHex);
  const signature = csl.Ed25519Signature.from_hex(signatureHex);
  const vkey = csl.Vkey.new(publicKey);
  const witness = csl.Vkeywitness.new(vkey, signature);

  return {
    publicKey,
    signature,
    witness,
    keyHashHex: toKeyHashHex(publicKey),
  };
}

export function addUniqueVkeyWitnessToTx(
  originalTxHex: string,
  witnessToAdd: csl.Vkeywitness,
): {
  txHex: string;
  witnessAdded: boolean;
  vkeyWitnesses: csl.Vkeywitnesses;
} {
  const originalTx = csl.Transaction.from_hex(originalTxHex);
  const txBodyClone = csl.TransactionBody.from_bytes(originalTx.body().to_bytes());
  const witnessSetClone = csl.TransactionWitnessSet.from_bytes(
    originalTx.witness_set().to_bytes(),
  );

  const vkeyWitnesses = cloneVkeyWitnesses(witnessSetClone);
  const incoming = csl.Vkeywitnesses.new();
  incoming.add(witnessToAdd);

  const { addedCount } = mergeUniqueWitnesses(vkeyWitnesses, incoming);
  if (addedCount === 0) {
    return {
      txHex: originalTxHex,
      witnessAdded: false,
      vkeyWitnesses,
    };
  }

  witnessSetClone.set_vkeys(vkeyWitnesses);

  const updatedTx = csl.Transaction.new(
    txBodyClone,
    witnessSetClone,
    originalTx.auxiliary_data(),
  );
  if (!originalTx.is_valid()) {
    updatedTx.set_is_valid(false);
  }

  return {
    txHex: updatedTx.to_hex(),
    witnessAdded: true,
    vkeyWitnesses,
  };
}

export function mergeSignerWitnesses(
  originalTxHex: string,
  signedPayloadHex: string,
): { txHex: string; invalidVkeyPubKeysHex: string[] } {
  const originalTx = csl.Transaction.from_hex(originalTxHex);

  // Key hashes already witnessed by earlier co-signers — don't re-verify those.
  const existingKeyHashes = new Set<string>();
  const existingVkeys = originalTx.witness_set().vkeys();
  if (existingVkeys) {
    for (let i = 0; i < existingVkeys.len(); i++) {
      existingKeyHashes.add(toKeyHashHex(existingVkeys.get(i).vkey().public_key()));
    }
  }

  // The wallet's freshly-added vkey witnesses (it returns a witness-set-only
  // payload on partial sign, or a full tx), deduped against existing.
  const incomingVkeys = extractVkeyWitnesses(signedPayloadHex);
  const newVkeys = csl.Vkeywitnesses.new();
  const seen = new Set<string>();
  for (let i = 0; i < incomingVkeys.len(); i++) {
    const witness = incomingVkeys.get(i);
    const keyHash = toKeyHashHex(witness.vkey().public_key());
    if (existingKeyHashes.has(keyHash) || seen.has(keyHash)) continue;
    seen.add(keyHash);
    newVkeys.add(witness);
  }

  // Verify each new witness against the core-cst hash of the ORIGINAL body —
  // the exact bytes the wallet signed. No more body-swap workaround: with a
  // consistent (core-cst) encoder there's nothing to reconcile, and every
  // co-signer signs the same stored body.
  const bodyHashBytes = Buffer.from(resolveTxHash(originalTxHex), "hex");
  const invalidVkeyPubKeysHex: string[] = [];
  for (let i = 0; i < newVkeys.len(); i++) {
    const witness = newVkeys.get(i);
    const pubKey = witness.vkey().public_key();
    if (!pubKey.verify(bodyHashBytes, witness.signature())) {
      invalidVkeyPubKeysHex.push(toPubKeyHex(pubKey));
    }
  }

  // Merge the new witnesses into the original tx WITHOUT re-encoding the body.
  // addVKeyWitnessSetToTransaction parses with the same (core-cst) serializer
  // used to build the tx and preserves the original body bytes, so the
  // persisted/submitted body hash stays equal to what every signer signed.
  let txHex = originalTxHex;
  if (newVkeys.len() > 0) {
    const newWitnessSet = csl.TransactionWitnessSet.new();
    newWitnessSet.set_vkeys(newVkeys);
    txHex = addVKeyWitnessSetToTransaction(originalTxHex, newWitnessSet.to_hex());
  }

  return { txHex, invalidVkeyPubKeysHex };
}

/**
 * Removes VKey witnesses whose key hash is not required by any native script
 * in the transaction's witness set. This prevents `InvalidWitnessesUTXOW`
 * rejections from the Conway ledger when a wallet returns extraneous witnesses
 * during partial signing.
 *
 * If the transaction contains no native scripts (non-multisig), it is returned
 * unchanged.
 */
export function filterWitnessesToScripts(txHex: string): string {
  const tx = csl.Transaction.from_hex(txHex);
  const witnessSet = tx.witness_set();

  const nativeScripts = witnessSet.native_scripts();
  if (!nativeScripts || nativeScripts.len() === 0) {
    return txHex;
  }

  const allowedKeyHashes = new Set<string>();
  for (let i = 0; i < nativeScripts.len(); i++) {
    const decoded = decodeNativeScriptFromCsl(nativeScripts.get(i));
    for (const kh of collectSigKeyHashes(decoded)) {
      allowedKeyHashes.add(kh.toLowerCase());
    }
  }

  if (allowedKeyHashes.size === 0) {
    return txHex;
  }

  const existingVkeys = witnessSet.vkeys();
  if (!existingVkeys || existingVkeys.len() === 0) {
    return txHex;
  }

  // Pub keys (by hex) whose key hash is required by a native script — keep only
  // these. Analysis is read-only via core-csl; the rebuild below is core-cst.
  const allowedPubKeyHexes = new Set<string>();
  let removed = 0;
  for (let i = 0; i < existingVkeys.len(); i++) {
    const pub = existingVkeys.get(i).vkey().public_key();
    if (allowedKeyHashes.has(toKeyHashHex(pub))) {
      allowedPubKeyHexes.add(toPubKeyHex(pub));
    } else {
      removed += 1;
    }
  }

  if (removed === 0) {
    return txHex;
  }

  // Drop the extraneous vkeys WITHOUT re-encoding the body: rebuild the witness
  // set with core-cst, which preserves the original body bytes (so the
  // remaining witnesses stay valid against the submitted body hash).
  const cstTx = CstTransaction.fromCbor(TxCBOR(txHex));
  const cstWitnessSet = cstTx.witnessSet();
  const cstVkeys = cstWitnessSet.vkeys();
  if (!cstVkeys) {
    return txHex;
  }
  const keptVkeys = [...cstVkeys.values()].filter((vkw) =>
    allowedPubKeyHexes.has(cstVkeyPubKeyHex(vkw)),
  );
  cstWitnessSet.setVkeys(
    CborSet.fromCore(
      keptVkeys.map((vkw) => vkw.toCore()),
      VkeyWitness.fromCore,
    ),
  );
  cstTx.setWitnessSet(cstWitnessSet);
  return cstTx.toCbor();
}

export {
  buildLegacyStylePaymentScriptCbor,
  buildSerializedNativeScriptCbor,
  extractMissingScriptHashFromError,
  getFirstNativeScriptCborFromTx,
  replaceNativeScriptWitness,
  resolveExpectedPaymentScriptCbor,
  shouldSubmitMultisigTx,
  submitTxWithScriptRecovery,
} from "@/utils/txScriptRecovery";
