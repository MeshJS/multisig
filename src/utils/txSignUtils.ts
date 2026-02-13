import type { NativeScript } from "@meshsdk/core";
import {
  deserializeAddress,
  resolvePaymentKeyHash,
  serializeNativeScript,
} from "@meshsdk/core";
import { csl, deserializeNativeScript } from "@meshsdk/core-csl";
import type {
  MultisigSubmissionWallet,
  ScriptRecoveryWallet,
  SubmitTxWithRecoveryArgs,
  SubmitTxWithRecoveryResult,
} from "@/types/txSign";
import { normalizeHex, scriptHashFromCbor } from "@/utils/nativeScriptUtils";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveMultisigScripts(rawImportBodies: unknown): {
  paymentScript?: string;
  stakeScript?: string;
} {
  if (!isRecord(rawImportBodies)) {
    return {};
  }

  const multisig = rawImportBodies.multisig;
  if (!isRecord(multisig)) {
    return {};
  }

  const paymentScript = typeof multisig.payment_script === "string"
    ? multisig.payment_script
    : undefined;
  const stakeScript = typeof multisig.stake_script === "string"
    ? multisig.stake_script
    : undefined;

  return { paymentScript, stakeScript };
}

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}

export function getFirstNativeScriptCborFromTx(txHex: string): string | undefined {
  try {
    const tx = csl.Transaction.from_hex(txHex);
    const nativeScripts = tx.witness_set().native_scripts();
    if (!nativeScripts || nativeScripts.len() === 0) return undefined;
    return bytesToHex(nativeScripts.get(0).to_bytes());
  } catch {
    return undefined;
  }
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

export function replaceNativeScriptWitness(txHex: string, scriptCbor: string): string {
  const tx = csl.Transaction.from_hex(txHex);
  const txBodyClone = csl.TransactionBody.from_bytes(tx.body().to_bytes());
  const witnessSetClone = csl.TransactionWitnessSet.from_bytes(
    tx.witness_set().to_bytes(),
  );

  const canonicalScript = deserializeNativeScript(scriptCbor.trim());
  const nativeScripts = csl.NativeScripts.new();
  nativeScripts.add(canonicalScript);
  witnessSetClone.set_native_scripts(nativeScripts);

  const rebuiltTx = csl.Transaction.new(
    txBodyClone,
    witnessSetClone,
    tx.auxiliary_data(),
  );
  if (!tx.is_valid()) {
    rebuiltTx.set_is_valid(false);
  }

  return rebuiltTx.to_hex();
}

export function extractMissingScriptHashFromError(error: unknown): string | undefined {
  const e = error as { response?: { data?: { message?: string } }; message?: string };
  const message = e?.response?.data?.message || e?.message || JSON.stringify(error || "");
  if (typeof message !== "string") return undefined;

  const markerIndex = message.indexOf("MissingScriptWitnessesUTXOW");
  if (markerIndex >= 0) {
    const tail = message.slice(markerIndex);
    const matchNearMarker = tail.match(/([0-9a-fA-F]{56})/);
    if (matchNearMarker?.[1]) {
      return matchNearMarker[1].toLowerCase();
    }
  }

  const fallbackMatch = message.match(/([0-9a-fA-F]{56})/);
  return fallbackMatch?.[1]?.toLowerCase();
}

export function buildLegacyStylePaymentScriptCbor(
  appWallet: ScriptRecoveryWallet,
  network: number,
): string | undefined {
  if (!appWallet?.signersAddresses?.length) return undefined;
  try {
    const scripts = appWallet.signersAddresses
      .filter((addr): addr is string => !!addr)
      .map((addr) => ({
        type: "sig" as const,
        keyHash: resolvePaymentKeyHash(addr),
      }));

    if (scripts.length === 0) return undefined;

    const script: NativeScript =
      appWallet.type === "atLeast"
        ? {
            type: "atLeast",
            required: appWallet.numRequiredSigners ?? 1,
            scripts,
          }
        : {
            type: appWallet.type as "all" | "any",
            scripts,
          };

    return serializeNativeScript(script, undefined, network, true).scriptCbor;
  } catch {
    return undefined;
  }
}

export function buildSerializedNativeScriptCbor(
  appWallet: ScriptRecoveryWallet,
  network: number,
): string | undefined {
  if (!appWallet?.nativeScript) return undefined;
  try {
    return serializeNativeScript(appWallet.nativeScript, undefined, network, true)
      .scriptCbor;
  } catch {
    return undefined;
  }
}

export function resolveExpectedPaymentScriptCbor(
  appWallet: ScriptRecoveryWallet,
): string | undefined {
  const { paymentScript, stakeScript } = resolveMultisigScripts(
    appWallet.rawImportBodies,
  );
  const candidatePayment = paymentScript?.trim();
  const candidateStake = stakeScript?.trim();

  let addressScriptHash: string | undefined;
  try {
    if (!appWallet.address) {
      throw new Error("Missing wallet address");
    }
    const parsed = deserializeAddress(appWallet.address) as {
      scriptHash?: string;
      scriptCredentialHash?: string;
    };
    addressScriptHash = normalizeHex(
      parsed.scriptHash || parsed.scriptCredentialHash,
    );
  } catch {
    addressScriptHash = undefined;
  }

  const paymentHash = scriptHashFromCbor(candidatePayment);
  const stakeHash = scriptHashFromCbor(candidateStake);
  const walletScriptHash = scriptHashFromCbor(appWallet.scriptCbor);

  if (addressScriptHash) {
    if (paymentHash === addressScriptHash && candidatePayment) {
      return candidatePayment;
    }
    if (stakeHash === addressScriptHash && candidateStake) {
      return candidateStake;
    }
    if (walletScriptHash === addressScriptHash && appWallet.scriptCbor) {
      return appWallet.scriptCbor;
    }
  }

  return appWallet.scriptCbor;
}

function findCandidateScriptByHash(
  appWallet: ScriptRecoveryWallet,
  targetHash?: string,
): string | undefined {
  if (!targetHash) return undefined;

  const { paymentScript, stakeScript } = resolveMultisigScripts(
    appWallet.rawImportBodies,
  );

  const candidates = [
    appWallet.scriptCbor,
    paymentScript,
    stakeScript,
  ].filter((value): value is string => !!value && value.trim().length > 0);

  for (const candidate of candidates) {
    if (scriptHashFromCbor(candidate) === targetHash) {
      return candidate;
    }
  }

  return undefined;
}

function dedupeScriptCbors(candidates: Array<string | undefined>): string[] {
  const seenCbors = new Set<string>();
  const uniqueCandidates: string[] = [];

  for (const candidate of candidates) {
    if (!candidate || candidate.trim().length === 0) continue;
    const trimmed = candidate.trim();
    const normalized = trimmed.toLowerCase();
    if (seenCbors.has(normalized)) continue;
    seenCbors.add(normalized);
    uniqueCandidates.push(trimmed);
  }

  return uniqueCandidates;
}

export function shouldSubmitMultisigTx(
  appWallet: MultisigSubmissionWallet,
  signedAddressesCount: number,
): boolean {
  if (appWallet.type === "any") {
    return signedAddressesCount >= 1;
  }
  if (appWallet.type === "atLeast") {
    const required = appWallet.numRequiredSigners ?? 1;
    return signedAddressesCount >= required;
  }
  return signedAddressesCount >= appWallet.signersAddresses.length;
}

export async function submitTxWithScriptRecovery({
  txHex,
  submitter,
  appWallet,
  network,
}: SubmitTxWithRecoveryArgs): Promise<SubmitTxWithRecoveryResult> {
  try {
    const txHash = await submitter.submitTx(txHex);
    return { txHash, txHex, repaired: false };
  } catch (submitError) {
    if (!appWallet || network === undefined) {
      throw submitError;
    }

    const missingScriptHash = extractMissingScriptHashFromError(submitError);
    const preferredScript = findCandidateScriptByHash(appWallet, missingScriptHash);
    const { paymentScript, stakeScript } = resolveMultisigScripts(
      appWallet.rawImportBodies,
    );

    const candidateScripts = dedupeScriptCbors([
      preferredScript,
      resolveExpectedPaymentScriptCbor(appWallet),
      paymentScript,
      stakeScript,
      buildSerializedNativeScriptCbor(appWallet, network),
      buildLegacyStylePaymentScriptCbor(appWallet, network),
      appWallet.scriptCbor,
    ]);

    if (candidateScripts.length === 0) {
      throw submitError;
    }

    const currentWitnessScriptCbor = getFirstNativeScriptCborFromTx(txHex);
    const currentWitnessScriptHash = scriptHashFromCbor(currentWitnessScriptCbor);

    let lastRetryError: unknown = submitError;

    for (const candidate of candidateScripts) {
      const candidateHash = scriptHashFromCbor(candidate);
      if (candidateHash && candidateHash === currentWitnessScriptHash) {
        continue;
      }

      const repairedTx = replaceNativeScriptWitness(txHex, candidate);
      try {
        const txHash = await submitter.submitTx(repairedTx);
        return { txHash, txHex: repairedTx, repaired: true };
      } catch (retryError) {
        lastRetryError = retryError;
      }
    }

    throw lastRetryError;
  }
}
