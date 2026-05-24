import { csl, calculateTxHash } from "@meshsdk/core-csl";
import {
  decodeNativeScriptFromCsl,
  collectSigKeyHashes,
} from "@/utils/nativeScriptUtils";

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

function extractFullSignedTx(
  signedPayloadHex: string,
): csl.Transaction | undefined {
  try {
    return csl.Transaction.from_hex(signedPayloadHex);
  } catch {
    return undefined;
  }
}

export function mergeSignerWitnesses(
  originalTxHex: string,
  signedPayloadHex: string,
): { txHex: string; invalidVkeyPubKeysHex: string[] } {
  const originalTx = csl.Transaction.from_hex(originalTxHex);
  const originalBodyBytes = Buffer.from(originalTx.body().to_bytes());

  // Some wallets re-canonicalise the tx body before signing (notably with Conway
  // `voting_procedures`). Their vkey witness then targets *their* body hash, not
  // ours. If the wallet returned a full Transaction (vs just a witness set) and
  // we have no pre-existing witnesses to invalidate, prefer their body — that's
  // what the signature is actually over.
  const signedTx = extractFullSignedTx(signedPayloadHex);
  const existingVkeysCount = originalTx.witness_set().vkeys()?.len() ?? 0;
  let bodyToUse = csl.TransactionBody.from_bytes(originalTx.body().to_bytes());
  if (signedTx && existingVkeysCount === 0) {
    const walletBodyBytes = Buffer.from(signedTx.body().to_bytes());
    if (!originalBodyBytes.equals(walletBodyBytes)) {
      bodyToUse = csl.TransactionBody.from_bytes(signedTx.body().to_bytes());
    }
  }

  const witnessSetClone = csl.TransactionWitnessSet.from_bytes(
    originalTx.witness_set().to_bytes(),
  );

  const existingKeyHashes = new Set<string>();
  const existingVkeys = witnessSetClone.vkeys();
  if (existingVkeys) {
    for (let i = 0; i < existingVkeys.len(); i++) {
      existingKeyHashes.add(toKeyHashHex(existingVkeys.get(i).vkey().public_key()));
    }
  }

  const mergedVkeys = cloneVkeyWitnesses(witnessSetClone);

  const incomingVkeys = extractVkeyWitnesses(signedPayloadHex);
  mergeUniqueWitnesses(mergedVkeys, incomingVkeys);

  witnessSetClone.set_vkeys(mergedVkeys);

  const mergedTx = csl.Transaction.new(
    bodyToUse,
    witnessSetClone,
    originalTx.auxiliary_data(),
  );
  if (!originalTx.is_valid()) {
    mergedTx.set_is_valid(false);
  }

  const txHex = mergedTx.to_hex();

  // Verify each *newly added* vkey witness against the merged tx body hash.
  // Even after the body-swap recovery above, a wallet that returns *only* a
  // witness set (no body) can still produce a witness over an encoding we
  // don't have. Surface that so callers can abort before persisting.
  const invalidVkeyPubKeysHex: string[] = [];
  const bodyHashBytes = Buffer.from(calculateTxHash(txHex), "hex");
  for (let i = 0; i < mergedVkeys.len(); i++) {
    const witness = mergedVkeys.get(i);
    const pubKey = witness.vkey().public_key();
    if (existingKeyHashes.has(toKeyHashHex(pubKey))) continue;
    if (!pubKey.verify(bodyHashBytes, witness.signature())) {
      invalidVkeyPubKeysHex.push(toPubKeyHex(pubKey));
    }
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

  const filteredVkeys = csl.Vkeywitnesses.new();
  let removed = 0;
  for (let i = 0; i < existingVkeys.len(); i++) {
    const w = existingVkeys.get(i);
    const kh = toKeyHashHex(w.vkey().public_key());
    if (allowedKeyHashes.has(kh)) {
      filteredVkeys.add(w);
    } else {
      removed += 1;
    }
  }

  if (removed === 0) {
    return txHex;
  }

  const witnessSetClone = csl.TransactionWitnessSet.from_bytes(
    witnessSet.to_bytes(),
  );
  witnessSetClone.set_vkeys(filteredVkeys);

  const filteredTx = csl.Transaction.new(
    csl.TransactionBody.from_bytes(tx.body().to_bytes()),
    witnessSetClone,
    tx.auxiliary_data(),
  );
  if (!tx.is_valid()) {
    filteredTx.set_is_valid(false);
  }

  return filteredTx.to_hex();
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
