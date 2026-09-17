/**
 * Classify free-text input on the Discover tab into a lookup query.
 *
 * Accepted inputs:
 *   - a 56-hex hash — ambiguous between a signer key hash and a native
 *     script hash ("policy"); resolved at query time by trying the script
 *     first (the provider 404s for a key hash)
 *   - a payment address (addr1 / addr_test1) — a script-credential address
 *     is a policy query, a key-credential address is a signer query using
 *     its payment (and, when present, stake) key hash
 *   - a stake address (stake1 / stake_test1) — signer query by stake hash
 */

import { deserializeAddress } from "@meshsdk/core";

import { tryResolveKeyHash } from "./addressCompatibility";

export type DiscoverQuery =
  | { kind: "empty" }
  | { kind: "signer"; keyHashes: string[] }
  | { kind: "policy"; scriptHash: string; address?: string }
  | { kind: "hash"; hash: string }
  | { kind: "invalid"; reason: "malformed" | "wrong-network" };

const HASH_RE = /^[0-9a-f]{56}$/i;

export function classifyDiscoverInput(
  raw: string,
  networkId: number,
): DiscoverQuery {
  const value = raw.trim();
  if (!value) return { kind: "empty" };

  if (HASH_RE.test(value)) {
    return { kind: "hash", hash: value.toLowerCase() };
  }

  const isPayment = value.startsWith("addr1") || value.startsWith("addr_test1");
  const isStake = value.startsWith("stake1") || value.startsWith("stake_test1");
  if (!isPayment && !isStake) {
    return { kind: "invalid", reason: "malformed" };
  }

  // Prefix check mirrors matchAddressesToSigSlots: a wrong-network
  // address parses fine but can never match this network's registrations.
  const expectedPrefix = isPayment
    ? networkId === 0
      ? "addr_test1"
      : "addr1"
    : networkId === 0
      ? "stake_test1"
      : "stake1";
  if (!value.startsWith(expectedPrefix)) {
    return { kind: "invalid", reason: "wrong-network" };
  }

  if (isStake) {
    const resolved = tryResolveKeyHash(value);
    return resolved
      ? { kind: "signer", keyHashes: [resolved.keyHash.toLowerCase()] }
      : { kind: "invalid", reason: "malformed" };
  }

  let parts: ReturnType<typeof deserializeAddress>;
  try {
    parts = deserializeAddress(value);
  } catch {
    return { kind: "invalid", reason: "malformed" };
  }

  if (parts.scriptHash) {
    return {
      kind: "policy",
      scriptHash: parts.scriptHash.toLowerCase(),
      address: value,
    };
  }

  const keyHashes: string[] = [];
  if (parts.pubKeyHash) keyHashes.push(parts.pubKeyHash.toLowerCase());
  // Same rule as the tab's own-key lookup: a key-based stake credential
  // may itself be registered as a participant; a script stake credential
  // never is.
  if (!parts.stakeScriptCredentialHash && parts.stakeCredentialHash) {
    keyHashes.push(parts.stakeCredentialHash.toLowerCase());
  }
  if (keyHashes.length === 0) {
    return { kind: "invalid", reason: "malformed" };
  }
  return { kind: "signer", keyHashes };
}

/** Short human label for a query kind, used in result copy. */
export function describeDiscoverQuery(query: DiscoverQuery): string {
  switch (query.kind) {
    case "signer":
      return "this signer";
    case "policy":
      return "this wallet";
    case "hash":
      return "this hash";
    default:
      return "your keys";
  }
}
