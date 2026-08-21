/**
 * CIP-0146 (label 1854) registration metadata helpers.
 *
 * A multisig wallet is registered on-chain by a transaction carrying
 * metadata under label 1854 with the shape produced by
 * MultisigWallet.getJsonMetadata():
 *   { types: number[], name?, description?, participants?: { [keyHash]: { name } } }
 *
 * Cardano transaction metadata strings are limited to 64 bytes, so long
 * name/description values are chunked into string arrays (reversible),
 * while participant names are truncated (map values can't become arrays
 * without breaking the CIP shape).
 */

import type { MultisigWallet } from "./multisigSDK";

export const METADATA_STRING_MAX_BYTES = 64;

export type Label1854Participant = { name: string };

export type Label1854Metadata = {
  types: number[];
  name?: string | string[];
  description?: string | string[];
  participants?: Record<string, Label1854Participant>;
};

export type Label1854LookupItem = {
  tx_hash: string;
  json_metadata?: Label1854Metadata | null;
};

const encoder = new TextEncoder();

export function byteLength(value: string): number {
  return encoder.encode(value).length;
}

/**
 * Split a string into chunks of at most METADATA_STRING_MAX_BYTES UTF-8
 * bytes, never splitting inside a code point. Returns the string itself
 * when it already fits.
 */
export function chunkMetadataString(value: string): string | string[] {
  if (byteLength(value) <= METADATA_STRING_MAX_BYTES) return value;
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of value) {
    const charBytes = byteLength(char);
    if (currentBytes + charBytes > METADATA_STRING_MAX_BYTES) {
      chunks.push(current);
      current = char;
      currentBytes = charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Truncate a string to at most METADATA_STRING_MAX_BYTES UTF-8 bytes. */
export function truncateMetadataString(value: string): string {
  if (byteLength(value) <= METADATA_STRING_MAX_BYTES) return value;
  let out = "";
  let bytes = 0;
  for (const char of value) {
    const charBytes = byteLength(char);
    if (bytes + charBytes > METADATA_STRING_MAX_BYTES) break;
    out += char;
    bytes += charBytes;
  }
  return out;
}

/** Reassemble a possibly-chunked metadata string for display. */
export function joinMetadataString(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string").join("");
  }
  return "";
}

/**
 * Build the label-1854 payload for a wallet, applying the 64-byte
 * metadata string limits. Empty name/description are omitted (both are
 * optional per CIP-0146; `types` is the only required field).
 */
export function buildLabel1854Metadata(
  mWallet: MultisigWallet,
): Label1854Metadata {
  const base = mWallet.getJsonMetadata() as {
    name: string;
    description: string;
    participants: Record<string, { name: string }>;
    types: number[];
  };

  const payload: Label1854Metadata = { types: base.types };
  if (base.name) payload.name = chunkMetadataString(base.name);
  if (base.description) {
    payload.description = chunkMetadataString(base.description);
  }

  const participants: Record<string, Label1854Participant> = {};
  for (const [keyHash, info] of Object.entries(base.participants)) {
    participants[keyHash] = { name: truncateMetadataString(info?.name ?? "") };
  }
  payload.participants = participants;

  return payload;
}

function participantKeySet(item: Label1854LookupItem): Set<string> | null {
  const participants = item.json_metadata?.participants;
  if (!participants || typeof participants !== "object") return null;
  const keys = Object.keys(participants);
  if (keys.length === 0) return null;
  return new Set(keys.map((k) => k.toLowerCase()));
}

/**
 * True when a lookup item's participant key hashes exactly equal the
 * given set (case-insensitive). The lookup endpoint matches on ANY
 * shared hash, so a signer who belongs to several registered wallets
 * gets items for all of them — exact-set equality identifies THIS
 * wallet's registration.
 */
export function participantsMatchExactly(
  item: Label1854LookupItem,
  keyHashes: string[],
): boolean {
  const onChain = participantKeySet(item);
  if (!onChain) return false;
  const expected = new Set(keyHashes.map((k) => k.toLowerCase()));
  if (onChain.size !== expected.size) return false;
  for (const hash of expected) {
    if (!onChain.has(hash)) return false;
  }
  return true;
}

/**
 * True when an on-chain registration's metadata already reflects the
 * wallet's current metadata (name, description, participant names and
 * types) — used to decide between "up to date" and "update available".
 */
export function isRegistrationUpToDate(
  item: Label1854LookupItem,
  mWallet: MultisigWallet,
): boolean {
  const onChain = item.json_metadata;
  if (!onChain) return false;
  const current = buildLabel1854Metadata(mWallet);

  if (joinMetadataString(onChain.name) !== joinMetadataString(current.name)) {
    return false;
  }
  if (
    joinMetadataString(onChain.description) !==
    joinMetadataString(current.description)
  ) {
    return false;
  }

  const onChainTypes = [...(onChain.types ?? [])].sort((a, b) => a - b);
  const currentTypes = [...current.types].sort((a, b) => a - b);
  if (JSON.stringify(onChainTypes) !== JSON.stringify(currentTypes)) {
    return false;
  }

  const currentParticipants = current.participants ?? {};
  const onChainParticipants = onChain.participants ?? {};
  const currentKeys = Object.keys(currentParticipants);
  if (currentKeys.length !== Object.keys(onChainParticipants).length) {
    return false;
  }
  for (const keyHash of currentKeys) {
    const onChainEntry = Object.entries(onChainParticipants).find(
      ([k]) => k.toLowerCase() === keyHash.toLowerCase(),
    );
    if (!onChainEntry) return false;
    if (
      joinMetadataString(onChainEntry[1]?.name) !==
      currentParticipants[keyHash]!.name
    ) {
      return false;
    }
  }
  return true;
}
