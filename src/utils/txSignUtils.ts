import { csl } from "@meshsdk/core-csl";

function toKeyHashHex(publicKey: csl.PublicKey): string {
  return Array.from(publicKey.hash().to_bytes())
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
): string {
  const originalTx = csl.Transaction.from_hex(originalTxHex);
  const txBodyClone = csl.TransactionBody.from_bytes(originalTx.body().to_bytes());
  const witnessSetClone = csl.TransactionWitnessSet.from_bytes(
    originalTx.witness_set().to_bytes(),
  );

  const mergedVkeys = cloneVkeyWitnesses(witnessSetClone);

  const incomingVkeys = extractVkeyWitnesses(signedPayloadHex);
  mergeUniqueWitnesses(mergedVkeys, incomingVkeys);

  witnessSetClone.set_vkeys(mergedVkeys);

  const mergedTx = csl.Transaction.new(
    txBodyClone,
    witnessSetClone,
    originalTx.auxiliary_data(),
  );
  if (!originalTx.is_valid()) {
    mergedTx.set_is_valid(false);
  }

  return mergedTx.to_hex();
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
