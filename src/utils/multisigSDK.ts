/**
 * @fileoverview MultisigSDK - A comprehensive library for creating and managing Cardano multisig wallets
 * 
 * This module provides functionality for:
 * - Creating multisig wallets with native scripts
 * - Managing different key roles (payment, staking, DRep)
 * - Generating Cardano addresses and scripts
 * - Supporting external stake credentials
 * - CIP-0146 metadata generation
 * 
 * @author MultisigSDK Team
 * @version 1.0.0
 * @since 1.0.0
 */

import {
  NativeScript,
  resolveNativeScriptHash,
  resolvePaymentKeyHash,
  resolveScriptHashDRepId,
  resolveStakeKeyHash,
  serializeNativeScript,
  serializeRewardAddress,
} from "@meshsdk/core";
import { getDRepIds } from "@meshsdk/core-cst";

/**
 * Extracts the payment key hash from a Cardano address.
 * 
 * @param address - A valid Cardano address (mainnet or testnet)
 * @returns The 28-byte payment key hash as a hex string
 * @throws {Error} If the address is invalid or malformed
 * 
 * @example
 * ```typescript
 * const address = "addr1qx3w7rh2p447qkx34x0p0vlr6z34r3n8e8r9qxrl6nw7rh2p447qkx34x0p0vlr6z34r3n8e8r9qxrl6nw7rh2p447qkx34x0";
 * const keyHash = paymentKeyHash(address);
 * console.log(keyHash); // "4fa1dd19be215b14a30f2a73f8b29e25bc917fbb2b3325b18394dca7"
 * ```
 */
export function paymentKeyHash(address: string): string {
  return resolvePaymentKeyHash(address);
}

/**
 * Extracts the stake key hash from a Cardano stake address.
 * 
 * @param stakeAddress - A valid Cardano stake address (mainnet or testnet)
 * @returns The 28-byte stake key hash as a hex string
 * @throws {Error} If the stake address is invalid or malformed
 * 
 * @example
 * ```typescript
 * const stakeAddress = "stake1u9p447qkx34x0p0vlr6z34r3n8e8r9qxrl6nw7rh2p447qkx34x0";
 * const stakeKeyHash = stakeKeyHash(stakeAddress);
 * console.log(stakeKeyHash); // "46372a4ff5367202aeb69ff561d8c3d45ac71cccc85060a02c61ecc9"
 * ```
 */
export function stakeKeyHash(stakeAddress: string): string {
  return resolveStakeKeyHash(stakeAddress);
}

/**
 * Represents a key in a multisig wallet with its role and metadata.
 * 
 * @interface MultisigKey
 * 
 * @property {string} keyHash - The 28-byte Ed25519 key hash as a hex string (56 characters)
 * @property {number} role - The role of the key in the multisig wallet:
 *   - `0`: Payment key (required for all wallets)
 *   - `2`: Staking key (for staking functionality)
 *   - `3`: DRep key (for governance participation)
 *   - `4`: Other role (custom use)
 *   - `5`: Other role (custom use)
 * @property {string} name - Human-readable name for the key (for metadata and display)
 * 
 * @example
 * ```typescript
 * const paymentKey: MultisigKey = {
 *   keyHash: "4fa1dd19be215b14a30f2a73f8b29e25bc917fbb2b3325b18394dca7",
 *   role: 0,
 *   name: "Alice Payment Key"
 * };
 * 
 * const stakeKey: MultisigKey = {
 *   keyHash: "46372a4ff5367202aeb69ff561d8c3d45ac71cccc85060a02c61ecc9",
 *   role: 2,
 *   name: "Alice Stake Key"
 * };
 * ```
 */
export interface MultisigKey {
  /** The 28-byte Ed25519 key hash as a hex string (56 characters) */
  keyHash: string;
  /** The role of the key: 0=payment, 2=staking, 3=DRep, 4-5=custom */
  role: number;
  /** Human-readable name for the key */
  name: string;
}

/**
 * A comprehensive multisig wallet implementation using Cardano native scripts.
 * 
 * This class provides functionality for creating and managing multisig wallets with support for:
 * - Multiple key roles (payment, staking, DRep)
 * - Configurable signature requirements
 * - External stake credentials
 * - CIP-0146 metadata generation
 * - Network-specific address generation
 * 
 * @class MultisigWallet
 * 
 * @example
 * ```typescript
 * // Create a simple 2-of-3 multisig wallet
 * const keys = [
 *   { keyHash: "key1...", role: 0, name: "Alice" },
 *   { keyHash: "key2...", role: 0, name: "Bob" },
 *   { keyHash: "key3...", role: 0, name: "Charlie" }
 * ];
 * 
 * const wallet = new MultisigWallet(
 *   "Team Wallet",
 *   keys,
 *   "Our team's shared wallet",
 *   2, // require 2 signatures
 *   1  // mainnet
 * );
 * 
 * const { address, scriptCbor } = wallet.getScript();
 * console.log("Multisig address:", address);
 * ```
 */
export class MultisigWallet {
  /** Human-readable name of the wallet */
  name: string;
  /** Optional description of the wallet */
  description: string;
  /** Array of keys with their roles, sorted lexicographically by keyHash */
  keys: MultisigKey[];
  /** Number of signatures required to authorize transactions */
  required: number;
  /** Network identifier: 0=testnet, 1=mainnet */
  network: number;
  /** Optional external stake credential hash (28-byte hex string) */
  stakeCredentialHash: string | undefined;
  /** Script type: "all", "any", or "atLeast" */
  type: "all" | "any" | "atLeast";

  /**
   * Creates a new MultisigWallet instance.
   * 
   * @param name - Human-readable name for the wallet
   * @param keys - Array of keys with their roles and metadata
   * @param description - Optional description of the wallet
   * @param required - Number of signatures required (default: 1)
   * @param network - Network identifier: 0=testnet, 1=mainnet (default: 1)
   * @param stakeCredentialHash - Optional external stake credential hash (28-byte hex string)
   * @param type - Script type: "all", "any", or "atLeast" (default: "atLeast")
   * 
   * @throws {Error} If no valid payment keys are provided
   * 
   * @example
   * ```typescript
   * // Basic wallet with payment keys only
   * const wallet1 = new MultisigWallet(
   *   "Simple Wallet",
   *   [{ keyHash: "key1...", role: 0, name: "Alice" }]
   * );
   * 
   * // Advanced wallet with staking and external stake credential
   * const wallet2 = new MultisigWallet(
   *   "Advanced Wallet",
   *   [
   *     { keyHash: "key1...", role: 0, name: "Alice Payment" },
   *     { keyHash: "key2...", role: 2, name: "Alice Stake" }
   *   ],
   *   "Wallet with staking capabilities",
   *   2, // require 2 signatures
   *   0, // testnet
   *   "external_stake_credential_hash",
   *   "all" // all signers must approve
   * );
   * ```
   */
  constructor(
    name: string,
    keys: MultisigKey[],
    description?: string,
    required?: number,
    network?: number,
    stakeCredentialHash?: string,
    type: "all" | "any" | "atLeast" = "atLeast",
  ) {
    this.name = name;
    // Filter out any keys that are not valid
    const filteredKeys = keys.filter(
      (k) => k.keyHash && k.keyHash !== "undefined" && !isNaN(k.role),
    );
    // Sort the keys lexicographically per CIP‑1854
    this.keys = [...filteredKeys].sort((a, b) =>
      a.keyHash.localeCompare(b.keyHash),
    );
    this.description = description ? description : "";
    this.required = required ? required : 1;
    this.network = network !== undefined ? network : 1;
    this.stakeCredentialHash = stakeCredentialHash;
    this.type = type;
  }

  /**
   * Generates the complete multisig script with address and CBOR representation.
   * 
   * This is the primary method for getting the wallet's address and script data.
   * It builds the payment script from role-0 keys and optionally includes staking
   * functionality if stake keys are present or an external stake credential is provided.
   * 
   * @returns Object containing the multisig address and script CBOR
   * @returns {string} address - The Cardano address for this multisig wallet
   * @returns {string} scriptCbor - The CBOR-encoded native script (hex string)
   * 
   * @throws {Error} If no valid payment keys are provided
   * 
   * @example
   * ```typescript
   * const wallet = new MultisigWallet("My Wallet", keys);
   * const { address, scriptCbor } = wallet.getScript();
   * 
   * console.log("Address:", address);
   * console.log("Script CBOR:", scriptCbor);
   * 
   * // Use the address to receive funds
   * // Use the scriptCbor for transaction building
   * ```
   */
  getScript(): {
    address: string;
    scriptCbor: string | undefined;
  } {
    const paymentScript = this.buildScript(0);
    if (!paymentScript) {
      console.warn("MultisigWallet keys:", this.keys);
      console.warn("buildScript(0) result:", paymentScript);
      throw new Error(
        "Cannot build multisig script: no valid payment keys provided.",
      );
    }
    const stakeCredentialHash = this.getStakeCredentialHash();

    return getScript(
      paymentScript,
      this.network,
      this.stakingEnabled()
        ? stakeCredentialHash
        : this.stakeCredentialHash === undefined
          ? undefined
          : this.stakeCredentialHash,
      this.stakingEnabled(),
    );
  }

  getPaymentScript(): string | undefined {
    const paymentScript = this.buildScript(0);
    if (!paymentScript) {
      console.warn("MultisigWallet keys:", this.keys);
      console.warn("buildScript(0) result:", paymentScript);
      console.error(
        "Cannot build multisig script: no valid payment keys provided.",
      );
      return undefined;
    }
    return getScript(paymentScript, this.network, ).scriptCbor;
  }

  getStakingScript(): string | undefined {
    const stakingScript = this.buildScript(2);
    if (!stakingScript) {
      console.warn("MultisigWallet keys:", this.keys);
      console.warn("buildScript(0) result:", stakingScript);
      console.error(
        "Cannot build multisig script: no valid staking keys provided.",
      );
      return undefined;
    }
    return getScript(stakingScript, this.network).scriptCbor;
  }

  /**
   * Filters and returns keys with the specified role.
   * 
   * @param role - The role to filter by:
   *   - `0`: Payment keys (required for all wallets)
   *   - `2`: Staking keys (for staking functionality)
   *   - `3`: DRep keys (for governance participation)
   *   - `4-5`: Custom roles
   * @returns Array of keys with the specified role, or `undefined` if no keys found
   * 
   * @example
   * ```typescript
   * const wallet = new MultisigWallet("Wallet", keys);
   * 
   * // Get all payment keys
   * const paymentKeys = wallet.getKeysByRole(0);
   * console.log("Payment keys:", paymentKeys);
   * 
   * // Get all staking keys
   * const stakeKeys = wallet.getKeysByRole(2);
   * console.log("Staking keys:", stakeKeys);
   * ```
   */
  getKeysByRole(role: number): MultisigKey[] | undefined {
    const filteredKeys = this.keys.filter((key) => key.role === role);
    return filteredKeys.length === 0 ? undefined : filteredKeys;
  }

  /**
   * Builds a native script for keys with the specified role.
   * 
   * This method creates a Cardano native script that requires the specified number
   * of signatures from the keys with the given role. The script type is "atLeast"
   * meaning any combination of the required number of keys can authorize transactions.
   * 
   * @param role - The role of keys to include in the script:
   *   - `0`: Payment keys (required for all wallets)
   *   - `2`: Staking keys (for staking functionality)
   *   - `3`: DRep keys (for governance participation)
   *   - `4-5`: Custom roles
   * @returns Native script object, or `undefined` if no keys found for the role
   * 
   * @example
   * ```typescript
   * const wallet = new MultisigWallet("Wallet", keys, "", 2); // require 2 signatures
   * 
   * // Build payment script (requires 2 of any payment keys)
   * const paymentScript = wallet.buildScript(0);
   * console.log("Payment script:", paymentScript);
   * 
   * // Build staking script (requires 2 of any staking keys)
   * const stakeScript = wallet.buildScript(2);
   * console.log("Staking script:", stakeScript);
   * ```
   */
  buildScript(role: number): NativeScript | undefined {
    // Filter keys by the given role
    const filteredKeys = this.getKeysByRole(role);
    if (!filteredKeys) return undefined;
    // Build the script using only the keys of the specified role
    return buildNativeScript(filteredKeys, this.required, this.type);
  }

  /**
   * Determines if staking is enabled for this wallet.
   * 
   * Staking is enabled when:
   * - The wallet has both payment keys (role 0) and staking keys (role 2)
   * - The number of payment keys equals the number of staking keys
   * 
   * This ensures that each payment key has a corresponding staking key,
   * which is required for proper staking functionality.
   * 
   * @returns `true` if staking is enabled, `false` otherwise
   * 
   * @example
   * ```typescript
   * const wallet = new MultisigWallet("Wallet", [
   *   { keyHash: "key1...", role: 0, name: "Alice Payment" },
   *   { keyHash: "key2...", role: 0, name: "Bob Payment" },
   *   { keyHash: "key3...", role: 2, name: "Alice Stake" },
   *   { keyHash: "key4...", role: 2, name: "Bob Stake" }
   * ]);
   * 
   * console.log("Staking enabled:", wallet.stakingEnabled()); // true
   * 
   * // If we only had payment keys:
   * const paymentOnlyWallet = new MultisigWallet("Wallet", [
   *   { keyHash: "key1...", role: 0, name: "Alice Payment" }
   * ]);
   * console.log("Staking enabled:", paymentOnlyWallet.stakingEnabled()); // false
   * ```
   */
  stakingEnabled(): boolean {
    const paymentKeyCount = this.getKeysByRole(0)?.length;
    const stakeKeyCount = this.getKeysByRole(2)?.length;
    if (!paymentKeyCount || !stakeKeyCount) return false;
    return paymentKeyCount === stakeKeyCount;
  }

  /**
   * Determines if governance (DRep) is enabled for this wallet.
   * 
   * Governance via DRep keys is considered enabled when:
   * - The wallet has payment keys (role 0) and DRep keys (role 3)
   * - The number of DRep keys equals the number of payment keys
   * 
   * This mirrors the staking check and ensures that each participant can also
   * be represented for governance decisions.
   * 
   * @returns `true` if DRep governance is enabled, `false` otherwise
   */
  drepEnabled(): boolean {
    const paymentKeyCount = this.getKeysByRole(0)?.length;
    const drepKeyCount = this.getKeysByRole(3)?.length;
    if (!paymentKeyCount || !drepKeyCount) return false;
    return paymentKeyCount === drepKeyCount;
  }

  /**
   * Determines if this wallet uses an external stake credential.
   * 
   * An external stake credential is a pre-defined stake credential hash
   * that is not derived from individual signer stake keys. When an external
   * stake credential is used, the wallet cannot be upgraded to add individual
   * signer stake keys.
   * 
   * @returns `true` if an external stake credential is set, `false` otherwise
   */
  hasExternalStakeCredential(): boolean {
    return this.stakeCredentialHash !== undefined;
  }

  /**
   * Returns the stake credential hash for the wallet.
   * 
   * This method returns the stake credential hash in the following priority:
   * 1. External stake credential hash (if provided during construction)
   * 2. Computed hash from staking keys (role 2) if staking is enabled
   * 3. `undefined` if no staking capability
   * 
   * The stake credential hash is a 28-byte value that identifies the staking
   * authority for the wallet. It's used to generate stake addresses and
   * participate in staking operations.
   * 
   * @returns The 28-byte stake credential hash as a hex string, or `undefined`
   * 
   * @example
   * ```typescript
   * // Wallet with external stake credential
   * const wallet1 = new MultisigWallet("Wallet", keys, "", 1, 1, "external_hash");
   * console.log("Stake credential:", wallet1.getStakeCredentialHash()); // "external_hash"
   * 
   * // Wallet with staking keys
   * const wallet2 = new MultisigWallet("Wallet", [
   *   { keyHash: "key1...", role: 0, name: "Payment" },
   *   { keyHash: "key2...", role: 2, name: "Stake" }
   * ]);
   * console.log("Stake credential:", wallet2.getStakeCredentialHash()); // computed hash
   * 
   * // Payment-only wallet
   * const wallet3 = new MultisigWallet("Wallet", [
   *   { keyHash: "key1...", role: 0, name: "Payment" }
   * ]);
   * console.log("Stake credential:", wallet3.getStakeCredentialHash()); // undefined
   * ```
   */
  getStakeCredentialHash(): string | undefined {
    if (this.stakeCredentialHash) return this.stakeCredentialHash;
    // Builds script with stake key hashes
    const stakeScript = this.buildScript(2);
    if (!stakeScript) return undefined;
    // Compute the stake credential hash by hashing the native script
    // using the resolveNativeScriptHash function from @meshsdk/core.
    const stakeCredentialHash = resolveNativeScriptHash(stakeScript);
    return stakeCredentialHash;
  }

  /**
   * Returns the stake address (reward address) for the wallet.
   * 
   * The stake address is derived from the stake credential hash and is used for:
   * - Receiving staking rewards
   * - Participating in staking operations
   * - Delegating to stake pools
   * 
   * The address format depends on the network:
   * - Mainnet: `stake1...`
   * - Testnet: `stake_test1...`
   * 
   * @returns The stake address as a string, or `undefined` if no staking capability
   * 
   * @example
   * ```typescript
   * const wallet = new MultisigWallet("Wallet", [
   *   { keyHash: "key1...", role: 0, name: "Payment" },
   *   { keyHash: "key2...", role: 2, name: "Stake" }
   * ], "", 1, 0); // testnet
   * 
   * const stakeAddress = wallet.getStakeAddress();
   * console.log("Stake address:", stakeAddress); // "stake_test1..."
   * 
   * // Use this address to delegate to a stake pool
   * // or to receive staking rewards
   * ```
   */
  getStakeAddress(): string | undefined {
    const stakeCredentialHash = this.getStakeCredentialHash()!;
    if (!stakeCredentialHash) return;
    return serializeRewardAddress(
      stakeCredentialHash,
      true,
      this.network ? 1 : 0,
    );
  }

  getDRepId(): string | undefined {
    return getDRepIds(this.getDRepId105()!).cip129;
  }

  /**
   * Computes the CIP-105 format DRep ID by hashing the native script
   * built from role-3 keys (DRep keys). Throws if no script is built.
   */
  getDRepId105(): string | undefined {
    // Build DRep script when enabled; otherwise fall back to payment (role 0) script
    const script = this.drepEnabled() ? this.buildScript(3) : this.buildScript(0);
    if (!script) return undefined;
    return resolveScriptHashDRepId(resolveNativeScriptHash(script));
  }
  /**
   * Returns the unique key roles (types) available in the wallet.
   * 
   * This method extracts all unique role numbers from the wallet's keys
   * and returns them as a sorted array. The roles represent different
   * types of keys and their purposes in the multisig wallet.
   * 
   * @returns Array of unique role numbers present in the wallet
   * 
   * @example
   * ```typescript
   * const wallet = new MultisigWallet("Wallet", [
   *   { keyHash: "key1...", role: 0, name: "Alice Payment" },
   *   { keyHash: "key2...", role: 0, name: "Bob Payment" },
   *   { keyHash: "key3...", role: 2, name: "Alice Stake" },
   *   { keyHash: "key4...", role: 3, name: "Alice DRep" }
   * ]);
   * 
   * const types = wallet.getAvailableTypes();
   * console.log("Available types:", types); // [0, 2, 3]
   * 
   * // Check if wallet has specific capabilities
   * const hasPayment = types.includes(0); // true
   * const hasStaking = types.includes(2); // true
   * const hasDRep = types.includes(3); // true
   * ```
   */
  getAvailableTypes() {
    return Array.from(new Set(this.keys.map((key) => key.role)));
  }

  /**
   * Generates CIP-0146 compliant JSON metadata for the wallet.
   * 
   * This method creates standardized metadata that can be used for:
   * - Wallet identification and display
   * - Participant management
   * - Integration with wallet applications
   * - On-chain metadata storage
   * 
   * The metadata follows the CIP-0146 standard and includes:
   * - Wallet name and description
   * - Available key types (roles)
   * - Participant information with key hashes and names
   * 
   * @returns Object containing CIP-0146 compliant metadata
   * 
   * @example
   * ```typescript
   * const wallet = new MultisigWallet("Team Wallet", [
   *   { keyHash: "key1...", role: 0, name: "Alice" },
   *   { keyHash: "key2...", role: 0, name: "Bob" },
   *   { keyHash: "key3...", role: 2, name: "Alice Stake" }
   * ], "Our team's shared wallet");
   * 
   * const metadata = wallet.getJsonMetadata();
   * console.log(metadata);
   * // {
   * //   name: "Team Wallet",
   * //   description: "Our team's shared wallet",
   * //   types: [0, 2],
   * //   participants: {
   * //     "key1...": { name: "Alice" },
   * //     "key2...": { name: "Bob" },
   * //     "key3...": { name: "Alice Stake" }
   * //   }
   * // }
   * ```
   */
  getJsonMetadata(): object {
    // Collect unique types (roles) from the wallet keys.
    const types = this.getAvailableTypes();
    // Build participants mapping using keyHash and the key's name.
    const participants = this.keys.reduce(
      (acc, key) => {
        acc[key.keyHash] = { name: key.name || "" };
        return acc;
      },
      {} as Record<string, { name: string }>,
    );

    return {
      name: this.name,
      description: this.description,
      participants: participants,
      types: types,
    };
  }
}

/**
 * Builds a multisig script from an array of keys and a required number of signers.
 *
 * This minimal implementation sorts the keys lexicographically per CIP‑1854,
 * and constructs an "atLeast", "all", or "any" script from individual "sig" scripts.
 *
 * @param keys - Array of multisig keys.
 * @param requiredSigners - Number of signers required.
 * @param type - Multisig script type: "all", "any", or "atLeast". Defaults to "atLeast".
 * @returns The multisig NativeScript.
 */
function buildNativeScript(
  keys: MultisigKey[],
  requiredSigners: number,
  type: "all" | "any" | "atLeast" = "atLeast",
): NativeScript {
  // Sort keys lexicographically by keyHash.
  const sortedKeys = [...keys].sort((a, b) =>
    a.keyHash.localeCompare(b.keyHash),
  );
  // Build individual sig scripts.
  const sigScripts = sortedKeys.map(
    (key): { type: "sig"; keyHash: string } => ({
      type: "sig",
      keyHash: key.keyHash,
    }),
  );

  let script: NativeScript;
  if (type === "all") {
    script = { type: "all", scripts: sigScripts };
  } else if (type === "any") {
    script = { type: "any", scripts: sigScripts };
  } else {
    script = {
      type: "atLeast",
      required: requiredSigners,
      scripts: sigScripts,
    };
  }
  return script;
}

/**
 * Returns the address and cbor of a given multisig script for the specified network.
 *
 * @param script - The NativeScript.
 * @param network - Network identifier (e.g., 1 for mainnet, 0 for testnet).
 * @param stakeCredentialHash - (Optional) stake credential hash.
 * @returns The script address.
 */
function getScript(
  script: NativeScript,
  network: number,
  stakeCredentialHash?: string,
  enabled: boolean = false,
): { address: string; scriptCbor: string } {
  const { address, scriptCbor } = serializeNativeScript(
    script,
    stakeCredentialHash,
    network,
    enabled
  );
  if (!scriptCbor) {
    throw new Error("Failed to serialize multisig script");
  }
  return { address, scriptCbor };
}

/**
 * Determines the network type from a Cardano address.
 * 
 * @param address - A Cardano address (payment or stake)
 * @returns Network identifier: 0 for testnet, 1 for mainnet
 * 
 * @example
 * ```typescript
 * const testnetAddr = "addr_test1qp86rhgehcs4k99rpu48879jncjmeytlhv4nxfd3sw2def6xxu4ylafkwgp2ad5l74sa3s75ttr3enxg2ps2qtrpanyswgshl2";
 * const mainnetAddr = "addr1qx3w7rh2p447qkx34x0p0vlr6z34r3n8e8r9qxrl6nw7rh2p447qkx34x0p0vlr6z34r3n8e8r9qxrl6nw7rh2p447qkx34x0";
 * 
 * console.log(addressToNetwork(testnetAddr)); // 0 (testnet)
 * console.log(addressToNetwork(mainnetAddr)); // 1 (mainnet)
 * ```
 */
export function addressToNetwork(address: string): number {
  return address.includes("test") ? 0 : 1;
}

/**
 * Validates a Cardano payment address.
 * 
 * This function attempts to extract the payment key hash from the address.
 * If successful, the address is valid; if it throws an error, the address is invalid.
 * 
 * @param address - The address to validate
 * @returns `true` if the address is valid, `false` otherwise
 * 
 * @example
 * ```typescript
 * const validAddr = "addr1qx3w7rh2p447qkx34x0p0vlr6z34r3n8e8r9qxrl6nw7rh2p447qkx34x0p0vlr6z34r3n8e8r9qxrl6nw7rh2p447qkx34x0";
 * const invalidAddr = "invalid_address";
 * 
 * console.log(checkValidAddress(validAddr)); // true
 * console.log(checkValidAddress(invalidAddr)); // false
 * ```
 */
export function checkValidAddress(address: string) {
  try {
    resolvePaymentKeyHash(address);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Validates a Cardano stake address.
 * 
 * This function attempts to extract the stake key hash from the stake address.
 * If successful, the stake address is valid; if it throws an error, the address is invalid.
 * 
 * @param stakeKey - The stake address to validate
 * @returns `true` if the stake address is valid, `false` otherwise
 * 
 * @example
 * ```typescript
 * const validStakeAddr = "stake1u9p447qkx34x0p0vlr6z34r3n8e8r9qxrl6nw7rh2p447qkx34x0";
 * const invalidStakeAddr = "invalid_stake_address";
 * 
 * console.log(checkValidStakeKey(validStakeAddr)); // true
 * console.log(checkValidStakeKey(invalidStakeAddr)); // false
 * ```
 */
export function checkValidStakeKey(stakeKey: string) {
  try {
    resolveStakeKeyHash(stakeKey);
    return true;
  } catch (e) {
    return false;
  }
}
