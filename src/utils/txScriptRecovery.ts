import type { NativeScript } from "@meshsdk/core";
import {
  deserializeAddress,
  serializeNativeScript,
} from "@meshsdk/core";
import { csl, deserializeNativeScript } from "@meshsdk/core-csl";
import type {
  MultisigSubmissionWallet,
  ScriptRecoveryWallet,
  SubmitTxWithRecoveryArgs,
  SubmitTxWithRecoveryResult,
} from "@/types/txSign";
import {
  buildPaymentSigScriptsFromAddresses,
  normalizeHex,
  scriptHashFromCbor,
} from "@/utils/nativeScriptUtils";

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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toLowerCase();
}

function extractErrorMessage(error: unknown): string {
  const e = error as { response?: { data?: { message?: string } }; message?: string };
  const message = e?.response?.data?.message || e?.message || JSON.stringify(error || "");
  return typeof message === "string" ? message : String(message);
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

function getNativeScriptWitnessCbors(txHex: string): string[] {
  try {
    const tx = csl.Transaction.from_hex(txHex);
    const nativeScripts = tx.witness_set().native_scripts();
    if (!nativeScripts || nativeScripts.len() === 0) return [];

    const scripts: string[] = [];
    for (let i = 0; i < nativeScripts.len(); i++) {
      scripts.push(bytesToHex(nativeScripts.get(i).to_bytes()));
    }
    return scripts;
  } catch {
    return [];
  }
}

export function replaceNativeScriptWitness(txHex: string, scriptCbor: string): string {
  return setNativeScriptWitnesses(txHex, [scriptCbor]);
}

function dedupeScriptSetByHash(scriptCbors: string[]): string[] {
  const uniqueScripts: string[] = [];
  const seenHashes = new Set<string>();
  const seenCbors = new Set<string>();

  for (const scriptCbor of scriptCbors) {
    const trimmed = scriptCbor.trim();
    if (!trimmed) continue;

    const normalizedCbor = trimmed.toLowerCase();
    if (seenCbors.has(normalizedCbor)) continue;

    const scriptHash = scriptHashFromCbor(trimmed);
    if (scriptHash && seenHashes.has(scriptHash)) continue;

    seenCbors.add(normalizedCbor);
    if (scriptHash) seenHashes.add(scriptHash);
    uniqueScripts.push(trimmed);
  }

  return uniqueScripts;
}

function setNativeScriptWitnesses(txHex: string, scriptCbors: string[]): string {
  const tx = csl.Transaction.from_hex(txHex);
  const txBodyClone = csl.TransactionBody.from_bytes(tx.body().to_bytes());
  const witnessSetClone = csl.TransactionWitnessSet.from_bytes(
    tx.witness_set().to_bytes(),
  );

  const nativeScripts = csl.NativeScripts.new();
  const uniqueScripts = dedupeScriptSetByHash(scriptCbors);
  for (const scriptCbor of uniqueScripts) {
    const canonicalScript = deserializeNativeScript(scriptCbor);
    nativeScripts.add(canonicalScript);
  }
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
  const hashes = extractMissingScriptHashesFromError(error);
  return hashes[0];
}

function extractScriptHashesFromFailureList(
  message: string,
  failureType: "MissingScriptWitnessesUTXOW" | "ExtraneousScriptWitnessesUTXOW",
): string[] {
  const markerIndex = message.indexOf(failureType);
  if (markerIndex < 0) return [];

  const tail = message.slice(markerIndex);
  const listMatch = tail.match(
    new RegExp(`${failureType}\\s*\\(fromList\\s*\\[([^\\]]*)\\]\\)`),
  );
  if (!listMatch?.[1]) return [];

  const hashes = listMatch[1].match(/[0-9a-fA-F]{56}/g) || [];
  return Array.from(new Set(hashes.map((hash) => hash.toLowerCase())));
}

function extractMissingScriptHashesFromError(error: unknown): string[] {
  const message = extractErrorMessage(error);
  const hashes = extractScriptHashesFromFailureList(message, "MissingScriptWitnessesUTXOW");
  if (hashes.length > 0) {
    return hashes;
  }

  const fallbackMatch = message.match(/([0-9a-fA-F]{56})/);
  return fallbackMatch?.[1] ? [fallbackMatch[1].toLowerCase()] : [];
}

function extractExtraneousScriptHashesFromError(error: unknown): string[] {
  const message = extractErrorMessage(error);
  return extractScriptHashesFromFailureList(message, "ExtraneousScriptWitnessesUTXOW");
}

function hasMissingScriptWitnessFailure(error: unknown): boolean {
  return extractErrorMessage(error).includes("MissingScriptWitnessesUTXOW");
}

function hasIrrecoverableInputFailure(error: unknown): boolean {
  const message = extractErrorMessage(error);
  return message.includes("BadInputsUTxO");
}

function hasValueNotConservedFailure(error: unknown): boolean {
  return extractErrorMessage(error).includes("ValueNotConservedUTxO");
}

function buildStaleInputError(error: unknown): Error {
  const original = extractErrorMessage(error);
  return new Error(
    "Transaction inputs are no longer available on chain. Please rebuild and re-collect signatures for this transaction. " +
      `Original submit error: ${original}`,
  );
}

function buildValueNotConservedError(error: unknown): Error {
  const original = extractErrorMessage(error);
  return new Error(
    "Transaction value is not balanced (ValueNotConservedUTxO). This usually means inputs do not cover outputs + fees + deposits (for example, stake registration deposit). " +
      "Please rebuild the transaction with sufficient ADA inputs and re-collect signatures. " +
      `Original submit error: ${original}`,
  );
}

export function buildLegacyStylePaymentScriptCbor(
  appWallet: ScriptRecoveryWallet,
  network: number,
): string | undefined {
  if (!appWallet?.signersAddresses?.length) return undefined;
  try {
    const scripts = buildPaymentSigScriptsFromAddresses(appWallet.signersAddresses);

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

function throwIfUnrecoverableSubmitError(error: unknown): void {
  if (hasIrrecoverableInputFailure(error)) {
    throw buildStaleInputError(error);
  }
  if (hasValueNotConservedFailure(error)) {
    throw buildValueNotConservedError(error);
  }
}

function addCandidateScriptSet(
  candidateScriptSets: Map<string, string[]>,
  scripts: Array<string | undefined>,
): void {
  const normalized = dedupeScriptSetByHash(
    scripts.filter((value): value is string => !!value),
  );
  if (normalized.length === 0) return;

  const key = normalized.map((script) => scriptHashFromCbor(script) ?? script).join("|");
  if (!candidateScriptSets.has(key)) {
    candidateScriptSets.set(key, normalized);
  }
}

function buildRecoveryCandidateScriptSets(
  txHex: string,
  appWallet: ScriptRecoveryWallet,
  network: number,
  missingScriptHashes: string[],
  extraneousScriptHashes: Set<string>,
): Map<string, string[]> {
  const preferredScript = findCandidateScriptByHash(appWallet, missingScriptHashes[0]);
  const { paymentScript, stakeScript } = resolveMultisigScripts(
    appWallet.rawImportBodies,
  );
  const expectedScript = resolveExpectedPaymentScriptCbor(appWallet);

  const currentWitnessScripts = getNativeScriptWitnessCbors(txHex);
  const retainedCurrentScripts = currentWitnessScripts.filter((scriptCbor) => {
    const hash = scriptHashFromCbor(scriptCbor);
    if (!hash) return true;
    return !extraneousScriptHashes.has(hash);
  });

  const missingScripts = missingScriptHashes
    .map((hash) => findCandidateScriptByHash(appWallet, hash))
    .filter((value): value is string => !!value);

  const candidateScripts = dedupeScriptCbors([
    preferredScript,
    expectedScript,
    paymentScript,
    stakeScript,
    buildSerializedNativeScriptCbor(appWallet, network),
    buildLegacyStylePaymentScriptCbor(appWallet, network),
    appWallet.scriptCbor,
  ]);

  const candidateScriptSets = new Map<string, string[]>();
  addCandidateScriptSet(candidateScriptSets, missingScripts);
  addCandidateScriptSet(candidateScriptSets, [...retainedCurrentScripts, ...missingScripts]);
  addCandidateScriptSet(candidateScriptSets, [paymentScript, stakeScript]);
  addCandidateScriptSet(candidateScriptSets, [expectedScript]);
  addCandidateScriptSet(candidateScriptSets, [preferredScript]);
  addCandidateScriptSet(candidateScriptSets, [appWallet.scriptCbor]);

  for (const candidate of candidateScripts) {
    addCandidateScriptSet(candidateScriptSets, [candidate]);
  }

  return candidateScriptSets;
}

async function retrySubmitWithCandidateScriptSets(
  txHex: string,
  submitter: SubmitTxWithRecoveryArgs["submitter"],
  candidateScriptSets: Map<string, string[]>,
  initialError: unknown,
): Promise<SubmitTxWithRecoveryResult> {
  let lastRetryError: unknown = initialError;

  for (const scriptSet of candidateScriptSets.values()) {
    const repairedTx = setNativeScriptWitnesses(txHex, scriptSet);
    try {
      const txHash = await submitter.submitTx(repairedTx);
      return { txHash, txHex: repairedTx, repaired: true };
    } catch (retryError) {
      lastRetryError = retryError;
    }
  }

  throw lastRetryError;
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
    throwIfUnrecoverableSubmitError(submitError);

    if (!appWallet || network === undefined) {
      throw submitError;
    }

    if (!hasMissingScriptWitnessFailure(submitError)) {
      throw submitError;
    }

    const missingScriptHashes = extractMissingScriptHashesFromError(submitError);
    const extraneousScriptHashes = new Set(extractExtraneousScriptHashesFromError(submitError));
    const candidateScriptSets = buildRecoveryCandidateScriptSets(
      txHex,
      appWallet,
      network,
      missingScriptHashes,
      extraneousScriptHashes,
    );

    if (candidateScriptSets.size === 0) {
      throw submitError;
    }

    return retrySubmitWithCandidateScriptSets(
      txHex,
      submitter,
      candidateScriptSets,
      submitError,
    );
  }
}
