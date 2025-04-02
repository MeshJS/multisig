import {
  MultisigKey,
  buildMultisigScript,
  getStakeCredentialHashFromMultisig,
  getMultisigScriptAddress,
} from "./multisigScriptSdk";
import { resolvePaymentKeyHash } from "@meshsdk/core";

/**
 * Converts parsed signer descriptions into an array of MultisigKey objects.
 * It extracts keys (ignoring "name") from each parsed description.
 * Keys are assumed to be named like "key0", "key2", etc. and the numeric part is the role.
 */
export function convertParsedToMultisigKeys(
  parsedSignersDescriptions: Array<{
    original: string;
    parsed: Record<string, string> | null;
    isNew: boolean;
  }>
): MultisigKey[] {
  const keys: MultisigKey[] = [];
  parsedSignersDescriptions.forEach((desc) => {
    if (desc.isNew && desc.parsed) {
      Object.keys(desc.parsed).forEach((key) => {
        if (key !== "name") {
          const role = parseInt(key.replace("key", ""), 10);
        keys.push({ keyHash: resolvePaymentKeyHash(desc.parsed![key]), role });
        }
      });
    }
  });
  return keys;
}

/**
 * Fallback conversion: if no parsed descriptions are available,
 * treat each raw signer address as a multisig key with a default role of 0.
 */
export function convertLegacyToMultisigKeys(
  signersAddresses: string[]
): MultisigKey[] {
  return signersAddresses.map((addr) => ({ keyHash: resolvePaymentKeyHash(addr), role: 0 }));
}

/**
 * Returns the final multisig script address.
 * If parsed signer descriptions exist, they are converted to multisig keys;
 * otherwise, the raw signer addresses are used.
 *
 * @param signersAddresses - Array of raw signer addresses.
 * @param parsedSignersDescriptions - Parsed signer descriptions.
 * @param requiredSigners - Number of signers required in each leaf.
 * @param network - Network id (0 for testnet, 1 for mainnet).
 * @returns The multisig script address.
 */
export function getFinalMultisigScriptAddress(
  signersAddresses: string[],
  parsedSignersDescriptions: Array<{
    original: string;
    parsed: Record<string, string> | null;
    isNew: boolean;
  }>,
  requiredSigners: number,
  network: number
): string {
  const keys =
    parsedSignersDescriptions.length > 0
      ? convertParsedToMultisigKeys(parsedSignersDescriptions)
      : convertLegacyToMultisigKeys(signersAddresses);
  return getMultisigScriptAddress(keys, requiredSigners, network);
}

/**
 * Returns the final stake credential hash derived from multisig keys.
 * It converts parsed descriptions to multisig keys (or falls back to raw addresses)
 * and then computes the stake credential hash using keys with role 2.
 *
 * @param signersAddresses - Array of raw signer addresses.
 * @param parsedSignersDescriptions - Parsed signer descriptions.
 * @returns The stake credential hash (56-character hex string).
 */
export function getFinalStakeCredentialHash(
  signersAddresses: string[],
  parsedSignersDescriptions: Array<{
    original: string;
    parsed: Record<string, string> | null;
    isNew: boolean;
  }>
): string {
  const keys =
    parsedSignersDescriptions.length > 0
      ? convertParsedToMultisigKeys(parsedSignersDescriptions)
      : convertLegacyToMultisigKeys(signersAddresses);
  return getStakeCredentialHashFromMultisig(keys);
}