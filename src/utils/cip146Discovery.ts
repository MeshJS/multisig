/**
 * CIP-0146 discovery helpers: reconstruct an importable wallet from an
 * on-chain label-1854 registration plus the native script resolved from
 * the registration transaction (/api/v1/resolveRegistrationScript).
 */

import {
  pubKeyAddress,
  serializeAddressObj,
  serializeNativeScript,
  type NativeScript,
} from "@meshsdk/core";

import { tryResolveKeyHash } from "./addressCompatibility";
import {
  joinMetadataString,
  type Label1854LookupItem,
} from "./cip146Registration";
import {
  decodeNativeScriptFromCbor,
  decodedToNativeScript,
} from "./nativeScriptUtils";

export type RegistrationScriptCandidate = {
  address: string;
  scriptHash: string;
  stakeCredentialHash: string | null;
  scriptJson: unknown;
};

export type DiscoveredImportInput = {
  name: string;
  description: string;
  signersAddresses: string[];
  signersStakeKeys: string[];
  signersDRepKeys: string[];
  signersDescriptions: string[];
  scriptCbor: string;
  numRequiredSigners: number;
  scriptType: "all" | "any" | "atLeast";
  stakeCredentialHash?: string | null;
};

/**
 * Convert provider (cardano-cli style) timelock JSON into a Mesh
 * NativeScript. Throws on malformed or non-timelock input.
 */
export function providerScriptJsonToNativeScript(json: unknown): NativeScript {
  if (!json || typeof json !== "object") {
    throw new Error("Invalid native script JSON");
  }
  const node = json as Record<string, unknown>;
  const type = node.type;

  if (type === "sig") {
    if (typeof node.keyHash !== "string") {
      throw new Error("Invalid sig script: missing keyHash");
    }
    return { type: "sig", keyHash: node.keyHash };
  }
  if (type === "all" || type === "any") {
    if (!Array.isArray(node.scripts)) {
      throw new Error(`Invalid ${type} script: missing scripts`);
    }
    return {
      type,
      scripts: node.scripts.map(providerScriptJsonToNativeScript),
    };
  }
  if (type === "atLeast") {
    if (!Array.isArray(node.scripts) || typeof node.required !== "number") {
      throw new Error("Invalid atLeast script: missing scripts/required");
    }
    return {
      type: "atLeast",
      required: node.required,
      scripts: node.scripts.map(providerScriptJsonToNativeScript),
    };
  }
  if (type === "after" || type === "before") {
    if (node.slot === undefined || node.slot === null) {
      throw new Error(`Invalid ${type} script: missing slot`);
    }
    return { type, slot: String(node.slot) };
  }
  throw new Error(`Unsupported native script type: ${String(type)}`);
}

/** Collect sig key hashes in script order (lowercased, deduplicated). */
export function collectNativeScriptSigHashes(script: NativeScript): string[] {
  const out: string[] = [];
  const walk = (node: NativeScript) => {
    if (node.type === "sig") {
      const hash = node.keyHash.toLowerCase();
      if (!out.includes(hash)) out.push(hash);
      return;
    }
    if ("scripts" in node && Array.isArray(node.scripts)) {
      for (const child of node.scripts) walk(child);
    }
  };
  walk(script);
  return out;
}

/** Enterprise (payment-only) bech32 address for a payment key hash. */
export function keyHashToEnterpriseAddress(
  keyHash: string,
  networkId: number,
): string {
  return serializeAddressObj(pubKeyAddress(keyHash), networkId);
}

/**
 * Assemble the import-wizard cbor payload from a discovered registration
 * and the resolved on-chain script.
 *
 * The reconstruction is verified by re-serializing the script (with the
 * candidate's stake credential) and requiring the produced address to
 * equal the address seen on-chain — a wallet is never imported with a
 * mismatched address.
 *
 * Per-signer stake/DRep keys are left empty: the flat 1854 participants
 * map doesn't record role pairings. The wallet address stays exact via
 * the external stakeCredentialHash.
 */
export function buildImportFromRegistration(args: {
  registration: Label1854LookupItem;
  candidate: RegistrationScriptCandidate;
  networkId: number;
  userAddress: string;
  userPaymentKeyHash: string;
}):
  | { input: DiscoveredImportInput; sigHashes: string[]; error?: undefined }
  | { input?: undefined; sigHashes?: undefined; error: string } {
  const { registration, candidate, networkId, userAddress, userPaymentKeyHash } =
    args;

  // A registration tx can expose several scripts (e.g. payment and
  // staking). Only a candidate whose signer keys all appear in the
  // registration's participant set can be the wallet being imported.
  const participantHashes = new Set(
    Object.keys(registration.json_metadata?.participants ?? {}).map((k) =>
      k.toLowerCase(),
    ),
  );

  let nativeScript: NativeScript;
  try {
    nativeScript = providerScriptJsonToNativeScript(candidate.scriptJson);
  } catch (e) {
    return {
      error: e instanceof Error ? e.message : "Could not parse the on-chain script",
    };
  }

  if (
    nativeScript.type !== "all" &&
    nativeScript.type !== "any" &&
    nativeScript.type !== "atLeast"
  ) {
    return { error: "Unsupported script structure for import" };
  }

  const sigHashes = collectNativeScriptSigHashes(nativeScript);
  if (sigHashes.length === 0) {
    return { error: "The on-chain script contains no signer keys" };
  }

  if (
    participantHashes.size > 0 &&
    !sigHashes.every((hash) => participantHashes.has(hash))
  ) {
    return {
      error:
        "The resolved script's signers don't match the registration's participants",
    };
  }

  const userHash = userPaymentKeyHash.toLowerCase();
  if (!sigHashes.includes(userHash)) {
    return {
      error:
        "Your connected wallet is not a payment signer of this multisig wallet",
    };
  }

  let scriptCbor: string | undefined;
  let derivedAddress: string;
  try {
    const serialized = serializeNativeScript(
      nativeScript,
      candidate.stakeCredentialHash ?? undefined,
      networkId,
      true,
    );
    scriptCbor = serialized.scriptCbor;
    derivedAddress = serialized.address;
  } catch (e) {
    return {
      error:
        e instanceof Error ? e.message : "Could not serialize the on-chain script",
    };
  }
  if (!scriptCbor) {
    return { error: "Could not serialize the on-chain script" };
  }
  if (derivedAddress !== candidate.address) {
    return {
      error:
        "Reconstructed wallet address does not match the on-chain address — refusing to import",
    };
  }

  const metadata = registration.json_metadata;
  const participants = metadata?.participants ?? {};
  const participantName = (hash: string): string => {
    const entry = Object.entries(participants).find(
      ([k]) => k.toLowerCase() === hash,
    );
    return entry ? joinMetadataString(entry[1]?.name) : "";
  };

  const scriptType = nativeScript.type;
  const numRequiredSigners =
    scriptType === "atLeast"
      ? nativeScript.required
      : scriptType === "any"
        ? 1
        : sigHashes.length;

  const name = joinMetadataString(metadata?.name) || "Discovered multisig wallet";
  const description = joinMetadataString(metadata?.description);

  return {
    input: {
      name,
      description,
      signersAddresses: sigHashes.map((hash) =>
        hash === userHash
          ? userAddress
          : keyHashToEnterpriseAddress(hash, networkId),
      ),
      signersStakeKeys: sigHashes.map(() => ""),
      signersDRepKeys: sigHashes.map(() => ""),
      signersDescriptions: sigHashes.map(participantName),
      scriptCbor,
      numRequiredSigners,
      scriptType,
      stakeCredentialHash: candidate.stakeCredentialHash ?? null,
    },
    sigHashes,
  };
}

// ---------------------------------------------------------------------------
// Signer-slot assignment: map co-signers' real addresses onto script slots
// ---------------------------------------------------------------------------

export type SlotAssignmentError = {
  /** The pasted line the error refers to */
  line: string;
  reason:
    | "invalid"
    | "stake-address"
    | "not-a-signer"
    | "duplicate-slot"
    | "wrong-network";
};

/**
 * Match pasted bech32 addresses to script sig-hash slots by payment key
 * hash. Order-independent: each address is resolved to its payment key
 * hash and assigned to the slot holding that hash. Lines that resolve to
 * a locked slot (e.g. the importer's own address) are silently skipped.
 */
export function matchAddressesToSigSlots(args: {
  /** script-order, lowercased (from collectNativeScriptSigHashes) */
  sigHashes: string[];
  /** slots that already have a final address, keyed by slot index */
  lockedSlots?: Record<number, string>;
  pastedLines: string[];
  /** 0 = preprod, 1 = mainnet — used to reject wrong-network addresses */
  networkId: number;
}): {
  assignments: Record<number, string>;
  errors: SlotAssignmentError[];
} {
  const { sigHashes, lockedSlots = {}, pastedLines, networkId } = args;
  const assignments: Record<number, string> = {};
  const errors: SlotAssignmentError[] = [];
  const seenLines = new Set<string>();

  for (const rawLine of pastedLines) {
    const line = rawLine.trim();
    if (!line || seenLines.has(line)) continue;
    seenLines.add(line);

    const resolved = tryResolveKeyHash(line);
    if (!resolved) {
      errors.push({ line, reason: "invalid" });
      continue;
    }
    // Prefix check as well as resolver type: some Mesh versions resolve a
    // payment hash even from stake addresses, so the type alone is not
    // reliable for rejecting them.
    if (
      resolved.type === "staking" ||
      line.startsWith("stake1") ||
      line.startsWith("stake_test1")
    ) {
      errors.push({ line, reason: "stake-address" });
      continue;
    }
    const expectedPrefix = networkId === 0 ? "addr_test1" : "addr1";
    if (!line.startsWith(expectedPrefix)) {
      errors.push({ line, reason: "wrong-network" });
      continue;
    }
    const hash = resolved.keyHash.toLowerCase();
    const slotIndex = sigHashes.indexOf(hash);
    if (slotIndex === -1) {
      errors.push({ line, reason: "not-a-signer" });
      continue;
    }
    if (lockedSlots[slotIndex] !== undefined) {
      // Importer pasted an address for an already-final slot (usually
      // their own) — not an error, just redundant.
      continue;
    }
    if (assignments[slotIndex] !== undefined) {
      errors.push({ line, reason: "duplicate-slot" });
      continue;
    }
    assignments[slotIndex] = line;
  }

  return { assignments, errors };
}

/**
 * Final address per slot with precedence locked > assigned > fallback.
 * The "enterprise" fallback derives a payment-only bech32 address (used
 * when creating a final Wallet record); "keyhash" keeps the raw 56-hex
 * hash as a placeholder (used for invite drafts, where the invite
 * machinery treats bare hashes as unclaimed slots).
 */
export function buildSlotAddresses(args: {
  sigHashes: string[];
  assignments: Record<number, string>;
  lockedSlots: Record<number, string>;
  networkId: number;
  fallback: "enterprise" | "keyhash";
}): string[] {
  const { sigHashes, assignments, lockedSlots, networkId, fallback } = args;
  return sigHashes.map((hash, index) => {
    const locked = lockedSlots[index];
    if (locked !== undefined) return locked;
    const assigned = assignments[index];
    if (assigned !== undefined) return assigned;
    return fallback === "enterprise"
      ? keyHashToEnterpriseAddress(hash, networkId)
      : hash;
  });
}

/**
 * Re-derive the wallet address from stored script CBOR and compare it to
 * the expected on-chain address. Used as a final safety assertion before
 * creating a wallet record from a discovery-sourced draft; mirrors the
 * address-equality check in buildImportFromRegistration.
 */
export function verifyScriptCborAddress(args: {
  scriptCbor: string;
  stakeCredentialHash?: string | null;
  networkId: number;
  expectedAddress: string;
}): boolean {
  try {
    const decoded = decodeNativeScriptFromCbor(args.scriptCbor);
    const nativeScript = decodedToNativeScript(decoded);
    const { address } = serializeNativeScript(
      nativeScript,
      args.stakeCredentialHash ?? undefined,
      args.networkId,
      true,
    );
    return address === args.expectedAddress;
  } catch {
    return false;
  }
}
