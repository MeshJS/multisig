/**
 * CIP-0146 discovery helpers: reconstruct an importable wallet from an
 * on-chain label-1854 registration plus the native script resolved from
 * the registration transaction (/api/v1/resolveRegistrationScript).
 */

import {
  deserializeAddress,
  pubKeyAddress,
  resolveRewardAddress,
  resolveStakeKeyHash,
  serializeAddressObj,
  serializeNativeScript,
  serializeRewardAddress,
  type NativeScript,
} from "@meshsdk/core";

import { tryResolveKeyHash } from "./addressCompatibility";
import {
  joinMetadataString,
  type Label1854LookupItem,
} from "./cip146Registration";
import { MultisigWallet, type MultisigKey } from "./multisigSDK";
import {
  collectNativeScriptSigHashes,
  providerScriptJsonToNativeScript,
} from "./nativeScriptJson";
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
  recovery?: RoleRecovery;
};

// Script-JSON parsing lives in nativeScriptJson.ts (no runtime Mesh
// imports) so API routes can share it; re-exported here for callers.
export { providerScriptJsonToNativeScript, collectNativeScriptSigHashes };

/** Enterprise (payment-only) bech32 address for a payment key hash. */
export function keyHashToEnterpriseAddress(
  keyHash: string,
  networkId: number,
): string {
  return serializeAddressObj(pubKeyAddress(keyHash), networkId);
}

/**
 * Base bech32 address from a payment key hash + stake key hash. When both
 * hashes belong to the same signer, this IS the address their wallet
 * reports (for standard single-account wallets) — the exact string
 * getUserWallets matches on for wallet visibility.
 */
export function keyHashesToBaseAddress(
  paymentKeyHash: string,
  stakeKeyHash: string,
  networkId: number,
): string {
  return serializeAddressObj(
    pubKeyAddress(paymentKeyHash, stakeKeyHash),
    networkId,
  );
}

// ---------------------------------------------------------------------------
// Role-set recovery: reconstruct stake/dRep key sets from the registration
// ---------------------------------------------------------------------------

export type RoleRecovery = {
  /** True when a stake key set was found whose role-2 script hash equals
   * the on-chain stake credential (cryptographic proof of exactness). */
  stakeRestored: boolean;
  /** True when the dRep key assignment is fully determined. Slots may
   * still be "" — a signer that registered no role-3 key. */
  drepRestored: boolean;
  /** True when per-slot pairing came from participant names (cosmetic —
   * pairing never affects script hashes, which are built from sorted
   * sets). */
  pairedByName: boolean;
  /** Per payment-slot bech32 reward addresses; all "" when not restored. */
  signersStakeKeys: string[];
  /** Per payment-slot raw 56-hex dRep key hashes; "" where the signer
   * registered none. */
  signersDRepKeys: string[];
  /** Per payment-slot constructed base address (payment hash + that
   * signer's recovered stake hash). Filled ONLY when the stake set is
   * restored AND paired by name — combinatorial pairing is arbitrary and
   * must never mint an address. "" where not constructible. */
  signersBaseAddresses: string[];
};

const RECOVERY_MAX_PARTICIPANTS = 40;
const RECOVERY_MAX_COMBINATIONS = 10_000;
const RECOVERY_MAX_NAME_VECTORS = 4096;

/** Visit k-subsets of `pool` until the visitor returns true (the match)
 * or the combination budget is exhausted. Returns the matching subset. */
function findCombination(
  pool: string[],
  k: number,
  budget: { remaining: number },
  visit: (subset: string[]) => boolean,
): string[] | undefined {
  const current: string[] = [];
  let found: string[] | undefined;
  const walk = (start: number): boolean => {
    if (current.length === k) {
      if (budget.remaining-- <= 0) return true; // abort on budget exhaustion
      if (visit(current)) {
        found = [...current];
        return true;
      }
      return false;
    }
    for (let i = start; i <= pool.length - (k - current.length); i++) {
      current.push(pool[i]!);
      const stop = walk(i + 1);
      current.pop();
      if (stop) return true;
    }
    return false;
  };
  walk(0);
  return found;
}

/**
 * Recover the per-role key-hash sets of a registered wallet from its 1854
 * participants map alone.
 *
 * Scripts in this app are built purely from key hashes, and the
 * participants map is the union of ALL roles' hashes — so although the
 * hashes can never be reversed into keys or addresses, the exact role
 * sets can be reconstructed:
 *
 * - payment set: known from the resolved on-chain script (`sigHashes`).
 * - stake set: the subset of participant hashes whose role-2 script hash
 *   (same script type/threshold) equals the on-chain stake credential.
 *   A hash match is proof — identical script hash implies identical
 *   sorted key set. Searched name-guided first (each signer's stake hash
 *   comes from their own name group), then by bounded combinatorial
 *   search.
 * - dRep set: once payment and stake are fixed, each signer's leftover
 *   hash is their dRep key; a name group with no leftover means that
 *   signer registered NO dRep key (do not assume one per signer).
 *
 * Edge left undetectable by design: a dRep key identical to the same
 * signer's payment/stake hash is indistinguishable from "no dRep key"
 * using the metadata alone (the participants map collapses reused
 * hashes).
 */
export function recoverRoleKeySets(args: {
  /** 1854 participants map: keyHash -> { name } (any case, any shape) */
  participants: Record<string, { name?: string | string[] } | undefined>;
  /** Ordered payment slot hashes from the on-chain script (lowercase) */
  sigHashes: string[];
  stakeCredentialHash: string | null | undefined;
  registrationTypes: number[] | null | undefined;
  numRequiredSigners: number;
  scriptType: "all" | "any" | "atLeast";
  networkId: number;
}): RoleRecovery {
  const {
    participants,
    sigHashes,
    stakeCredentialHash,
    registrationTypes,
    numRequiredSigners,
    scriptType,
    networkId,
  } = args;

  const slots = sigHashes.length;
  const empty = (): string[] => Array.from({ length: slots }, () => "");
  const none: RoleRecovery = {
    stakeRestored: false,
    drepRestored: false,
    pairedByName: false,
    signersStakeKeys: empty(),
    signersDRepKeys: empty(),
    signersBaseAddresses: empty(),
  };

  // hash (lowercase) -> participant name
  const names = new Map<string, string>();
  for (const [hash, info] of Object.entries(participants ?? {})) {
    if (/^[0-9a-f]{56}$/i.test(hash)) {
      names.set(hash.toLowerCase(), joinMetadataString(info?.name).trim());
    }
  }
  const allHashes = [...names.keys()];
  if (allHashes.length === 0 || allHashes.length > RECOVERY_MAX_PARTICIPANTS) {
    return none;
  }
  const paymentSet = new Set(sigHashes);

  // Name groups: a signer's payment/stake/dRep hashes share their name.
  // Usable only when every payment slot has a non-empty name and no two
  // slots share one (otherwise groups don't identify signers).
  const groups = new Map<string, string[]>();
  for (const [hash, name] of names) {
    if (!name) continue;
    const group = groups.get(name);
    if (group) group.push(hash);
    else groups.set(name, [hash]);
  }
  const slotNames = sigHashes.map((h) => names.get(h) ?? "");
  const namesUsable =
    slotNames.every((n) => n) && new Set(slotNames).size === slots;

  const expectedStake = stakeCredentialHash?.toLowerCase() ?? null;
  const wantStake = registrationTypes ? registrationTypes.includes(2) : true;
  const wantDRep = registrationTypes?.includes(3) ?? false;

  const credentialOf = (stakeHashes: string[]): string | undefined =>
    deriveStakeCredentialFromKeys({
      stakeKeys: stakeHashes,
      numRequiredSigners,
      scriptType,
      networkId,
    });

  // --- Stake set search -----------------------------------------------------
  // perSlotStake[i] = raw stake key hash paired to payment slot i ("" = none)
  let perSlotStake: string[] | undefined;
  let stakePairedByName = false;

  if (expectedStake && wantStake) {
    // 1) Name-guided: pick one candidate per slot from that signer's own
    //    name group (reuse across roles is legal, so the payment hash
    //    itself is a candidate too).
    if (namesUsable) {
      const candidates = slotNames.map((n) => groups.get(n) ?? []);
      const product = candidates.reduce((acc, c) => acc * c.length, 1);
      if (product > 0 && product <= RECOVERY_MAX_NAME_VECTORS) {
        const vector: string[] = [];
        const search = (slot: number): boolean => {
          if (slot === slots) {
            return credentialOf(vector) === expectedStake;
          }
          for (const hash of candidates[slot]!) {
            vector.push(hash);
            if (search(slot + 1)) return true;
            vector.pop();
          }
          return false;
        };
        if (search(0)) {
          perSlotStake = [...vector];
          stakePairedByName = true;
        }
      }
    }

    // 2) Combinatorial fallback over distinct participant hashes: the
    //    standard case is one stake key per signer (size == slots), but a
    //    registration may carry fewer role-2 keys, so smaller sizes are
    //    tried too. The script-hash equality check is the arbiter, so a
    //    match at any size is exact.
    if (!perSlotStake) {
      const budget = { remaining: RECOVERY_MAX_COMBINATIONS };
      for (let k = Math.min(slots, allHashes.length); k >= 1; k--) {
        const match = findCombination(allHashes, k, budget, (subset) => {
          return credentialOf(subset) === expectedStake;
        });
        if (match) {
          const sorted = [...match].sort();
          // Attempt cosmetic name pairing of the found set; otherwise
          // fill slots in sorted order.
          perSlotStake = empty();
          const unplaced: string[] = [];
          for (const hash of sorted) {
            const slot = namesUsable
              ? slotNames.findIndex(
                  (n, i) =>
                    !perSlotStake![i] && groups.get(n)?.includes(hash),
                )
              : -1;
            if (slot !== -1) perSlotStake[slot] = hash;
            else unplaced.push(hash);
          }
          for (const hash of unplaced) {
            const free = perSlotStake.findIndex((s) => !s);
            if (free !== -1) perSlotStake[free] = hash;
          }
          stakePairedByName =
            namesUsable && unplaced.length === 0 && match.length === slots;
          break;
        }
        if (budget.remaining <= 0) break;
      }
    }
  }

  const stakeRestored = perSlotStake !== undefined;
  const stakeSet = new Set((perSlotStake ?? []).filter(Boolean));

  // --- dRep assignment ------------------------------------------------------
  // Requires the stake set to be settled first, otherwise leftover hashes
  // can't be attributed to a role. (When the registration has no role-2
  // keys at all, the stake set is legitimately empty.)
  let perSlotDRep: string[] | undefined;
  const stakeSettled = stakeRestored || !wantStake;

  if (wantDRep && stakeSettled) {
    const leftovers = allHashes.filter(
      (h) => !paymentSet.has(h) && !stakeSet.has(h),
    );
    // types including 3 means at least one role-3 key exists — an empty
    // leftover set means every dRep key reuses a payment/stake hash,
    // which the collapsed participants map cannot attribute. Don't guess.
    if (leftovers.length > 0 && namesUsable) {
      const assigned = empty();
      let consistent = true;
      for (let i = 0; i < slots; i++) {
        const groupLeft = (groups.get(slotNames[i]!) ?? []).filter(
          (h) => !paymentSet.has(h) && !stakeSet.has(h),
        );
        if (groupLeft.length === 1) assigned[i] = groupLeft[0]!;
        else if (groupLeft.length > 1) {
          consistent = false;
          break;
        }
      }
      // Every leftover hash must have found a slot — each participant
      // hash holds at least one role in the registered wallet.
      if (
        consistent &&
        leftovers.every((h) => assigned.includes(h))
      ) {
        perSlotDRep = assigned;
      }
    }
    if (!perSlotDRep && leftovers.length > 0 && leftovers.length <= slots) {
      // Without usable names the leftover SET is still exact (scripts
      // sort internally); slot pairing is arbitrary.
      const assigned = empty();
      [...leftovers].sort().forEach((h, i) => {
        assigned[i] = h;
      });
      perSlotDRep = assigned;
    }
  }

  const drepRestored = perSlotDRep !== undefined;

  return {
    stakeRestored,
    drepRestored,
    pairedByName: stakePairedByName,
    signersStakeKeys: stakeRestored
      ? perSlotStake!.map((h) =>
          h ? serializeRewardAddress(h, false, networkId ? 1 : 0) : "",
        )
      : empty(),
    signersDRepKeys: drepRestored ? perSlotDRep! : empty(),
    signersBaseAddresses:
      stakeRestored && stakePairedByName
        ? sigHashes.map((hash, i) =>
            perSlotStake![i]
              ? keyHashesToBaseAddress(hash, perSlotStake![i]!, networkId)
              : "",
          )
        : empty(),
  };
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
 * Per-signer stake/dRep keys are recovered from the registration's
 * participant hashes via recoverRoleKeySets — the stake set is proven
 * against the on-chain stake credential; the wallet address stays exact
 * via the external stakeCredentialHash either way.
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

  const recovery = recoverRoleKeySets({
    participants,
    sigHashes,
    stakeCredentialHash: candidate.stakeCredentialHash,
    registrationTypes: metadata?.types ?? null,
    numRequiredSigners,
    scriptType,
    networkId,
  });

  return {
    input: {
      name,
      description,
      // Co-signer slots get their CONSTRUCTED base address (registered
      // payment hash + name-paired recovered stake hash) — the exact
      // string a standard single-account wallet reports, so the wallet
      // is visible to them (getUserWallets exact-match) with no paste or
      // invite. A signer whose live wallet uses a different stake key
      // silently won't match — same outcome as the enterprise
      // placeholder, corrected via paste or invite. The user's own slot
      // always keeps their wallet-reported address.
      signersAddresses: sigHashes.map((hash, i) =>
        hash === userHash
          ? userAddress
          : recovery.signersBaseAddresses[i] ||
            keyHashToEnterpriseAddress(hash, networkId),
      ),
      signersStakeKeys: recovery.signersStakeKeys,
      signersDRepKeys: recovery.signersDRepKeys,
      signersDescriptions: sigHashes.map(participantName),
      scriptCbor,
      numRequiredSigners,
      scriptType,
      // Kept even when the stake set was recovered: draft finalization
      // asserts the serialized address against provenance.expectedAddress
      // with this credential, then nulls it after verifying.
      stakeCredentialHash: candidate.stakeCredentialHash ?? null,
      recovery,
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
 * Final address per slot with precedence locked > assigned > recovered >
 * fallback. `recovered` carries base addresses constructed from the
 * registration (RoleRecovery.signersBaseAddresses) — a pasted
 * wallet-reported address still beats them. The "enterprise" fallback
 * derives a payment-only bech32 address (used when creating a final
 * Wallet record); "keyhash" keeps the raw 56-hex hash as a placeholder
 * (used for invite drafts, where the invite machinery treats bare hashes
 * as unclaimed slots).
 */
export function buildSlotAddresses(args: {
  sigHashes: string[];
  assignments: Record<number, string>;
  lockedSlots: Record<number, string>;
  networkId: number;
  fallback: "enterprise" | "keyhash";
  recovered?: Record<number, string>;
}): string[] {
  const { sigHashes, assignments, lockedSlots, networkId, fallback, recovered } =
    args;
  return sigHashes.map((hash, index) => {
    const locked = lockedSlots[index];
    if (locked !== undefined) return locked;
    const assigned = assignments[index];
    if (assigned !== undefined) return assigned;
    const recoveredAddress = recovered?.[index];
    if (recoveredAddress) return recoveredAddress;
    return fallback === "enterprise"
      ? keyHashToEnterpriseAddress(hash, networkId)
      : hash;
  });
}

// ---------------------------------------------------------------------------
// SDK-state restoration: recover per-signer stake keys with on-chain proof
// ---------------------------------------------------------------------------

/**
 * Derive the role-2 (staking) multisig script credential from a set of
 * per-signer stake keys. Uses MultisigWallet itself so sorting, required
 * count and script-type semantics are byte-identical to how the original
 * wallet derived its stake credential.
 *
 * Accepts bech32 reward addresses or raw 56-hex stake key hashes.
 * Returns undefined when any entry is missing/unparseable — restoration
 * is all-or-nothing.
 */
export function deriveStakeCredentialFromKeys(args: {
  stakeKeys: string[];
  numRequiredSigners: number;
  scriptType: "all" | "any" | "atLeast";
  networkId: number;
}): string | undefined {
  const { stakeKeys, numRequiredSigners, scriptType, networkId } = args;
  if (stakeKeys.length === 0) return undefined;
  try {
    const keys: MultisigKey[] = [];
    for (const raw of stakeKeys) {
      const entry = raw.trim();
      if (!entry) return undefined;
      const hash = /^[0-9a-f]{56}$/i.test(entry)
        ? entry.toLowerCase()
        : resolveStakeKeyHash(entry).toLowerCase();
      keys.push({ keyHash: hash, role: 2, name: "" });
    }
    const wallet = new MultisigWallet(
      "",
      keys,
      "",
      numRequiredSigners,
      networkId,
      undefined,
      scriptType,
    );
    return wallet.getStakeCredentialHash()?.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Attempt to restore per-signer stake keys from the final slot addresses
 * (base addresses carry their owner's stake credential). The restoration
 * only succeeds when EVERY slot yields a stake key AND the derived role-2
 * script hash equals the wallet's on-chain stake credential — proving the
 * reconstruction is identical to the original. Otherwise falls back to
 * empty stake keys + the external stake credential (today's behavior).
 */
export function restoreStakeKeysFromAddresses(args: {
  signersAddresses: string[];
  expectedStakeCredentialHash: string | null | undefined;
  numRequiredSigners: number;
  scriptType: "all" | "any" | "atLeast";
  networkId: number;
}): {
  restored: boolean;
  signersStakeKeys: string[];
  stakeCredentialHash: string | null;
} {
  const {
    signersAddresses,
    expectedStakeCredentialHash,
    numRequiredSigners,
    scriptType,
    networkId,
  } = args;

  const fallback = {
    restored: false,
    signersStakeKeys: signersAddresses.map(() => ""),
    stakeCredentialHash: expectedStakeCredentialHash ?? null,
  };
  if (!expectedStakeCredentialHash) return fallback;

  const stakeKeys: string[] = [];
  for (const address of signersAddresses) {
    let rewardAddress = "";
    try {
      const parts = deserializeAddress(address);
      // Script-stake base addresses can't contribute a signer stake key.
      if (!parts.stakeScriptCredentialHash && parts.stakeCredentialHash) {
        rewardAddress = resolveRewardAddress(address) ?? "";
      }
    } catch {
      rewardAddress = "";
    }
    stakeKeys.push(rewardAddress);
  }

  if (stakeKeys.some((k) => !k)) return fallback;

  const derived = deriveStakeCredentialFromKeys({
    stakeKeys,
    numRequiredSigners,
    scriptType,
    networkId,
  });
  if (!derived || derived !== expectedStakeCredentialHash.toLowerCase()) {
    return fallback;
  }

  return {
    restored: true,
    signersStakeKeys: stakeKeys,
    stakeCredentialHash: null,
  };
}

/** Stake credential (script hash) embedded in a wallet address, if any. */
export function stakeCredentialFromAddress(
  address: string,
): string | undefined {
  try {
    const parts = deserializeAddress(address);
    const hash = parts.stakeScriptCredentialHash || parts.stakeCredentialHash;
    return hash ? hash.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
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
