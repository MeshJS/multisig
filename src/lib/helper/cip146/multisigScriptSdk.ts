import {
  NativeScript,
  resolveNativeScriptHash,
  resolveScriptHashDRepId,
  serializeNativeScript,
} from "@meshsdk/core";
import { getDRepIds } from "@meshsdk/core-cst";

/**
 * Minimal MultisigKey type.
 */
export interface MultisigKey {
  keyHash: string;
  role: number;
  name: string;
}

/**
 * Builds a multisig script from an array of keys and a required number of signers.
 *
 * This minimal implementation sorts the keys lexicographically per CIP‑1854,
 * and constructs an "atLeast" script from individual "sig" scripts.
 *
 * @param keys - Array of multisig keys.
 * @param requiredSigners - Number of signers required.
 * @returns The multisig NativeScript.
 */
export function buildMultisigScript(
  keys: MultisigKey[],
  requiredSigners: number,
): NativeScript {
  // Sort keys lexicographically by keyHash.
  const sortedKeys = [...keys].sort((a, b) =>
    a.keyHash.localeCompare(b.keyHash),
  );
  // Build individual sig scripts.
  const sigScripts = sortedKeys.map((key) => ({
    type: "sig" as "sig",
    keyHash: key.keyHash,
  }));
  // Create an "atLeast" multisig script.
  const script: NativeScript = {
    type: "atLeast",
    required: requiredSigners,
    scripts: sigScripts,
  };
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
export function getScript(
  script: NativeScript,
  network: number,
  stakeCredentialHash?: string,
): {
  address: string;
  scriptCbor: string | undefined;
} {
  return serializeNativeScript(script, stakeCredentialHash, network);
}

/**
 * Minimal MultisigWallet class.
 */
export class MultisigWallet {
  name: string;
  keys: MultisigKey[];
  required: number;
  network: number;

  constructor(
    name: string,
    keys: MultisigKey[],
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
    this.required = required ? required : 1;
    this.network = network ? network : 1;
  }

  /**
   * Builds the multisig script for keys with the specified role.
   *
   * @param role - The role of the keys to include in the script. (0 - payment, 2 - staking, 3 - dRep, 4,5) TD enum
   * @returns The multisig NativeScript.
   */
  buildScript(role: number): NativeScript {
    // Filter keys by the given role
    const filteredKeys = this.keys.filter((key) => key.role === role);
    if (filteredKeys.length === 0) {
      throw new Error(`No keys found for role ${role}`);
    }
    // Build the script using only the keys of the specified role
    let script = buildMultisigScript(filteredKeys, this.required);
    return script;
  }

  getScript(): {
    address: string;
    scriptCbor: string | undefined;
  }  {
    return getScript(
      this.buildScript(0),
      this.network,
      this.getStakeCredentialHash(),
    );
  }

  /**
   * Returns the stake credential hash for the wallet by collecting all keys with role 2.
   * It builds a multisig script from these staking keys, then computes the hash of the script.
   *
   * @returns The stake credential hash as a string.
   */
  getStakeCredentialHash(): string {
    // Builds script with stake key hashes
    const stakeScript = this.buildScript(2);
    // Compute the stake credential hash by hashing the native script
    // using the resolveNativeScriptHash function from @meshsdk/core.
    const stakeCredentialHash = resolveNativeScriptHash(stakeScript);
    return stakeCredentialHash;
  }

  /**
   * Generates JSON metadata for the wallet.
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
      json_metadata: {
        name: this.name,
        types: types,
        participants: participants,
      },
    };
  }
}
