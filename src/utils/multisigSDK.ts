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

/** Helper to extract payment key hash from an address */
export function paymentKeyHash(address: string): string {
  return resolvePaymentKeyHash(address);
}

/** Helper to extract stake key hash from a stake address */
export function stakeKeyHash(address: string): string {
  return resolveStakeKeyHash(address);
}

/**
 * Minimal MultisigKey type.
 */
export interface MultisigKey {
  keyHash: string;
  role: number;
  name: string;
}

/**
 * MultisigWallet class utilizing native scripts.
 */
export class MultisigWallet {
  name: string;
  description: string;
  keys: MultisigKey[];
  required: number;
  network: number;

  constructor(
    name: string,
    keys: MultisigKey[],
    description?: string,
    required?: number,
    network?: number,
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
  }

  /**
   * Generates the multisig script with corresponding stake script.
   * @returns The multisig address and cbor.
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
      this.stakingEnabled() ? stakeCredentialHash : undefined,
      this.stakingEnabled(),
    );
  }

  getPaymentScript(): string {
    const paymentScript = this.buildScript(0);
    if (!paymentScript) {
      console.warn("MultisigWallet keys:", this.keys);
      console.warn("buildScript(0) result:", paymentScript);
      throw new Error(
        "Cannot build multisig script: no valid payment keys provided.",
      );
    }
    return getScript(paymentScript, this.network).scriptCbor;
  }

  getStakingScript(): string {
    const stakingScript = this.buildScript(2);
    if (!stakingScript) {
      console.warn("MultisigWallet keys:", this.keys);
      console.warn("buildScript(0) result:", stakingScript);
      throw new Error(
        "Cannot build multisig script: no valid payment keys provided.",
      );
    }
    return getScript(stakingScript, this.network).scriptCbor;
  }


  /**
   * Filters the stored keys for the specified role.
   *
   * @param role - The role of the keys to include in the script. (0 - payment, 2 - staking, 3 - dRep, 4,5) TD enum
   * @returns The multisig keys list.
   */
  getKeysByRole(role: number): MultisigKey[] | undefined {
    const filteredKeys = this.keys.filter((key) => key.role === role);
    return filteredKeys.length === 0 ? undefined : filteredKeys;
  }

  /**
   * Builds the multisig script for keys for the specified role.
   *
   * @param role - The role of the keys to include in the script. (0 - payment, 2 - staking, 3 - dRep, 4,5) TD enum
   * @returns The multisig NativeScript.
   */
  buildScript(role: number): NativeScript | undefined {
    // Filter keys by the given role
    const filteredKeys = this.getKeysByRole(role);
    if (!filteredKeys) return undefined;
    // Build the script using only the keys of the specified role
    return buildNativeScript(filteredKeys, this.required);
  }

  stakingEnabled(): boolean {
    const paymentKeyCount = this.getKeysByRole(0)?.length;
    const stakeKeyCount = this.getKeysByRole(2)?.length;
    if (!paymentKeyCount || !stakeKeyCount) return false;
    return paymentKeyCount === stakeKeyCount;
  }

  /**
   * Returns the stake credential hash for the wallet by collecting all keys with role 2.
   * It builds a multisig script from these staking keys, then computes the hash of the script.
   *
   * @returns The stake credential hash as a string or undefined if no stake script.
   */
  getStakeCredentialHash(): string | undefined {
    // Builds script with stake key hashes
    const stakeScript = this.buildScript(2);
    if (!stakeScript) return undefined;
    // Compute the stake credential hash by hashing the native script
    // using the resolveNativeScriptHash function from @meshsdk/core.
    const stakeCredentialHash = resolveNativeScriptHash(stakeScript);
    return stakeCredentialHash;
  }

  /**
   * Returns the stake address (reward address) of the wallet.
   *
   * This is derived from the stake credential hash computed from role-2 keys (staking keys),
   * and then serialized into a reward address. Returns `undefined` if no staking script is available.
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
    return resolveScriptHashDRepId(
      resolveNativeScriptHash(this.buildScript(0)!), // Still Wrong should be 3 -> for drep keys.
    );
  }

  /**
   * Generates CIP-0146 JSON metadata for the wallet.
   *
   * @returns An object with JSON metadata.
   */
  getJsonMetadata(): object {
    // Collect unique types (roles) from the wallet keys.
    const types = Array.from(new Set(this.keys.map((key) => key.role)));
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
 * Returns the address of a given multisig script for the specified network.
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
    enabled,
  );
  if (!scriptCbor) {
    throw new Error("Failed to serialize multisig script");
  }
  return { address, scriptCbor };
}

export function checkValidAddress(address: string) {
  try {
    resolvePaymentKeyHash(address);
    return true;
  } catch (e) {
    return false;
  }
}

export function checkValidStakeKey(stakeKey: string) {
  try {
    resolveStakeKeyHash(stakeKey);
    return true;
  } catch (e) {
    return false;
  }
}
