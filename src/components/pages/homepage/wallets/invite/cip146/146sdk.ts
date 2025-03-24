import {
  Bip32PrivateKey,
  Bip32PublicKey,
  EnterpriseAddress,
  Address,
  Credential,
  BaseAddress,
} from "@emurgo/cardano-serialization-lib-browser";
import * as bip39 from "bip39";
import { bech32 } from "bech32";

import { getProvider } from "@/components/common/cardano-objects/get-provider";

/**
 * A flexible Wallet type that can optionally hold a mnemonic and a collection of key objects,
 * keyed by their derivation path string.
 */
export interface IWallet {
  mnemonic?: string;
  rootKey?: string;
  keyObjects: KeyObject[];
}

/**
 * Represents a key object, containing its derivation path and associated key pair.
 */
export interface KeyObject {
  derivationPath: DerivationPath;
  publicKey?: string;
  privateKey?: string;
  used?: boolean;
}

/**
 * Interface representing the components of a derivation path.
 * Example: For Cardano CIP-1852, with purpose=1852, coinType=1815, accountIndex=0,
 * and optionally role and index (e.g. role=0, index=0), the resulting path string is "m/1852'/1815'/0'/0/0".
 * If role and index are omitted, the path will be formatted as "m/1852'/1815'/0'".
 */
export interface DerivationPath {
  purpose: number;
  coinType: number;
  accountIndex: number;
  role?: number;
  index?: number;
}

export class WalletConstructor implements IWallet {
  mnemonic?: string;
  rootKey?: string;
  keyObjects: KeyObject[];

  /**
   * Creates a new wallet.
   * - No arguments: Generates a new wallet with a new mnemonic and root key.
   * - String argument: Auto-detects if it is a mnemonic, root key, or acct_shared_xvk.
   * - KeyObject argument: Initializes the wallet with the given KeyObject.
   * @param arg1 Optional mnemonic, root key, acct_shared_xvk, or KeyObject.
   */
  constructor(arg1?: string | KeyObject) {
    this.keyObjects = [];

    if (!arg1) {
      // No arguments provided; generate a new wallet with mnemonic and root key.
      const newMnemonic = bip39.generateMnemonic(256);
      this.mnemonic = newMnemonic;
      this.rootKey = mnemonicToRootKey(newMnemonic);
    } else if (typeof arg1 === "string") {
      // Determine if the string is a mnemonic, root key, or acct_shared_xvk.
      const trimmedArg = arg1.trim();

      if (bip39.validateMnemonic(trimmedArg)) {
        // Treat the argument as a mnemonic.
        this.mnemonic = trimmedArg;
        this.rootKey = mnemonicToRootKey(trimmedArg);
      } else if (trimmedArg.startsWith("acct_shared_xvk")) {
        // Treat the argument as an acct_shared_xvk.
        const keyObj = createKeyObjectFromBech32(trimmedArg, {
          purpose: 1854,
          coinType: 1815,
          accountIndex: 0,
        });
        this.keyObjects.push(keyObj);
      } else {
        // Otherwise, assume it's a root key.
        this.rootKey = trimmedArg;
      }
    } else if (typeof arg1 === "object" && "derivationPath" in arg1) {
      // Treat the argument as a KeyObject and add it to keyObjects.
      this.keyObjects.push(arg1);
    }
  }

  /**
   * Combined derive function that accepts either a Wallet or a KeyObject and an array of target derivation paths.
   *
   * - If a Wallet is provided, its mnemonic or rootKey is used to derive new KeyObjects for each target path and added
   *   to the wallet’s keyObjects collection.
   * - If a KeyObject is provided, additional key objects are derived from that object (using private derivation if possible,
   *   or public derivation if the private key is absent) and a new Wallet containing both the original and derived key objects is returned.
   *
   * @param input - A Wallet or a KeyObject.
   * @param targetPaths - An array of target derivation paths.
   * @returns A Wallet object containing all derived key objects.
   */
  public deriveKeys(targetPaths: DerivationPath[]): void {
    // Ensure the wallet has at least one of mnemonic, rootKey, or key objects.
    if (
      !(
        this.mnemonic ||
        this.rootKey ||
        (this.keyObjects && this.keyObjects.length > 0)
      )
    ) {
      throw new Error(
        "Wallet must have either mnemonic, rootKey, or key objects for derivation",
      );
    }

    // If a mnemonic is present but no rootKey, generate the rootKey.
    if (!this.rootKey && this.mnemonic) {
      this.rootKey = mnemonicToRootKey(this.mnemonic);
    }

    // If we have a rootKey, derive using it.
    if (this.rootKey) {
      // For each target path, only add a new key if one with the same derivation path doesn't exist.
      for (const path of targetPaths) {
        const pathStr = derivationPathToString(path);
        if (
          !this.keyObjects.find(
            (k) => derivationPathToString(k.derivationPath) === pathStr,
          )
        ) {
          const newKeyObj = deriveKeyObjectFromRoot(this.rootKey, path);
          this.keyObjects.push(newKeyObj);
        }
      }
    } else if (this.keyObjects && this.keyObjects.length > 0) {
      // Fallback: use the first keyObject as the parent for derivation.
      const parentKeyObj = this.keyObjects[0];
      const parentPath = parentKeyObj!.derivationPath;
      for (const path of targetPaths) {
        // Avoid re-deriving the parent itself.
        if (
          derivationPathToString(path) !== derivationPathToString(parentPath)
        ) {
          let newKeyObj: KeyObject;
          if (parentKeyObj!.privateKey) {
            const parentKey = Bip32PrivateKey.from_hex(parentKeyObj!.privateKey);
            newKeyObj = deriveKeyObjectFromParent(parentKey, parentPath, path);
          } else if (parentKeyObj!.publicKey) {
            const parentPub = Bip32PublicKey.from_hex(parentKeyObj!.publicKey);
            newKeyObj = deriveKeyObjectFromParentPublic(
              parentPub,
              parentPath,
              path,
            );
          } else {
            throw new Error("KeyObject must contain at least a publicKey");
          }
          this.keyObjects.push(newKeyObj);
        }
      }
    } else {
      throw new Error("Wallet has no available keys for derivation.");
    }
  }

  /**
   * Adds an acct_shared_xvk to this wallet by creating a KeyObject from the provided Bech32 string.
   * @param bech32String - The acct_shared_xvk as a Bech32 encoded string.
   */
  public addAcctSharedXVK(bech32String: string): void {
    const targetPath = { purpose: 1854, coinType: 1815, accountIndex: 0 };
    const keyObj = createKeyObjectFromBech32(bech32String, targetPath);
    this.keyObjects!.push(keyObj);
  }
  
  public deriveNextMultisig(): KeyObject[] {
    // Step 1: Ensure the parent multisig key "m/1854'/1815'/0'" exists.
    const parentPath = parseDerivationPath("m/1854'/1815'/0'");
    let parentKey = this.findKeyObjectByPath(parentPath);
    if (!parentKey) {
      // Derive the parent key if not present.
      this.deriveKeys([parentPath]);
      parentKey = this.findKeyObjectByPath(parentPath);
      if (!parentKey) {
        throw new Error("Failed to derive parent multisig key.");
      }
    }
  
    // Step 2: Find existing child keys under the parent that have role 0.
    // We assume the parent's base is the first three segments.
    const parentStr = derivationPathToString(parentPath); // e.g., "m/1854'/1815'/0'"
    const multisigChildKeys = this.keyObjects.filter((ko) => {
      const dp = ko.derivationPath;
      const baseStr = `m/${dp.purpose}'/${dp.coinType}'/${dp.accountIndex}'`;
      return baseStr === parentStr && dp.role === 0 && typeof dp.index === "number";
    });
  
    // Determine the maximum index among these keys (default to -1 if none exist).
    const maxIndex = multisigChildKeys.reduce((max, ko) => {
      return Math.max(max, ko.derivationPath.index as number);
    }, -1);
    const newIndex = maxIndex + 1;
  
    // Step 3: Derive the next triplet of keys for roles 0, 2, and 3 with the new index.
    const newTargetPaths = [
      parseDerivationPath(`m/1854'/1815'/0'/0/${newIndex}`),
      parseDerivationPath(`m/1854'/1815'/0'/2/${newIndex}`),
      parseDerivationPath(`m/1854'/1815'/0'/3/${newIndex}`),
    ];
    this.deriveKeys(newTargetPaths);
  
    // Return the newly derived keys (filter key objects with index equal to newIndex).
    return this.keyObjects.filter((ko) => ko.derivationPath.index === newIndex);
  }

  /**
   * Finds a KeyObject in this wallet by its derivation path.
   * @param targetPath - The derivation path to search for.
   * @returns The matching KeyObject if found, otherwise undefined.
   */
  public findKeyObjectByPath(
    targetPath: DerivationPath,
  ): KeyObject | undefined {
    return this.keyObjects?.find(
      (ko) =>
        derivationPathToString(ko.derivationPath) ===
        derivationPathToString(targetPath),
    );
  }
  /**
   * Instance method: Looks up multisig metadata for this wallet's key objects.
   * It filters keys using filterBy (for purpose 1854) and ensures each key has a complete derivation path
   * (i.e. both role and index defined with exactly 6 parts). It then performs a lookup using the provided
   * network (or both networks if undefined) and sets the `used` property on each matching key object.
   *
   * @param network - Optional network id; if undefined, both networks are queried.
   * @returns A promise that resolves to an array of MetadataItem objects.
   */
  public lookupMultisigKeys(network?: number): Promise<MetadataItem[]> {
    if (!this.keyObjects) return Promise.resolve([]);

    // Filter key objects that have purpose 1854 using filterBy.
    const multisigKeys = this.filterBy([{ level: 0, targetValue: 1854 }])
      // Further ensure keys have defined role and index, and the derivation path is complete.
      .filter((ko) => {
        const dpString = derivationPathToString(ko.derivationPath);
        const parts = dpString.split("/");
        return (
          typeof ko.derivationPath.role === "number" &&
          typeof ko.derivationPath.index === "number" &&
          parts.length === 6
        );
      });

    // Get the public key hashes (in lowercase) for these multisig keys.
    const pubKeyHashes = multisigKeys
      .map((ko) =>
        ko.publicKey ? getPubKeyHash(ko.publicKey).toLowerCase() : "",
      )
      .filter((hash) => hash !== "");

    // Perform lookup: if network is defined, use it; otherwise, query both networks.
    const lookupPromise =
      network !== undefined
        ? lookupWallet(network, pubKeyHashes)
        : Promise.all([
            lookupWallet(0, pubKeyHashes),
            lookupWallet(1, pubKeyHashes),
          ]).then((results) => results.flat());

    // After lookup, mark each multisig key object as used if any metadata item matches.
    return lookupPromise.then((metadataItems: MetadataItem[]) => {
      multisigKeys.forEach((ko) => {
        if (ko.publicKey) {
          const keyHash = getPubKeyHash(ko.publicKey).toLowerCase();
          const isUsed = metadataItems.some((item: MetadataItem) => {
            const participants = item.json_metadata?.participants || {};
            return Object.keys(participants).some(
              (hash) => hash.toLowerCase() === keyHash,
            );
          });
          ko.used = isUsed;
        }
      });
      return metadataItems;
    });
  }

  /**
   * Returns the key objects with the specified account index.
   * By default, keys that are at the parent level (i.e. without child derivation)
   * are included. If `parent` is false, only keys with child derivations (with defined role and index)
   * are returned.
   * @param index - The account index to filter by.
   * @param parent - Whether to include parent keys (default: true).
   * @returns An array of KeyObject instances matching the account index.
   */
  public getByAcctIndex(index: number, parent: boolean = true): KeyObject[] {
    if (!this.keyObjects) return [];
    return this.keyObjects.filter((ko) => {
      const { accountIndex, role, index: childIndex } = ko.derivationPath;
      if (accountIndex !== index) return false;
      // If parent is false, only include keys that have child-level derivation (role and index defined)
      if (!parent) {
        return typeof role === "number" && typeof childIndex === "number";
      }
      return true;
    });
  }

  /**
   * Returns the key objects for multisig usage.
   * It filters for keys that have an account index of 0 (level 2)
   * and a child index (level 4) equal to the provided index.
   * @param index - The target index for level 4.
   * @returns An array of KeyObject instances matching the multisig index.
   */
  public getByMultisigIndex(index: number): KeyObject[] {
    if (!this.keyObjects) return [];
    return this.keyObjects.filter((ko) => {
      const dp = ko.derivationPath;
      // Check that accountIndex (level 2) is zero and index (level 4) matches the given value.
      return (
        dp.accountIndex === 0 &&
        typeof dp.index === "number" &&
        dp.index === index
      );
    });
  }

  /**
   * Helper function that filters key objects by a specified list of derivation path filters.
   * Each filter is an object with `level` and `targetValue`. For each key object,
   * the derivation path must match all specified filters.
   *
   * Levels:
   * - 0: purpose
   * - 1: coinType
   * - 2: accountIndex
   * - 3: role
   * - 4: index
   *
   * @param filters - An array of objects each containing `level` and `targetValue`.
   * @returns An array of KeyObject instances that match all filters.
   */
  public filterBy(
    filters: Array<{ level: number; targetValue: number }>,
  ): KeyObject[] {
    if (!this.keyObjects) return [];
    return this.keyObjects.filter((ko) => {
      const { derivationPath } = ko;
      return filters.every(({ level, targetValue }) => {
        switch (level) {
          case 0:
            return derivationPath.purpose === targetValue;
          case 1:
            return derivationPath.coinType === targetValue;
          case 2:
            return derivationPath.accountIndex === targetValue;
          case 3:
            return (
              typeof derivationPath.role === "number" &&
              derivationPath.role === targetValue
            );
          case 4:
            return (
              typeof derivationPath.index === "number" &&
              derivationPath.index === targetValue
            );
          default:
            throw new Error("Invalid level: must be between 0 and 4.");
        }
      });
    });
  }
}

/**
 * Helper: Converts a mnemonic phrase to a root key hex string.
 * @param mnemonic - A valid mnemonic phrase.
 * @returns The root key in hex format.
 */
export function mnemonicToRootKey(mnemonic: string): string {
  const entropyHex = bip39.mnemonicToEntropy(mnemonic.trim());
  const entropy = hexToUint8Array(entropyHex);
  const rootKey = Bip32PrivateKey.from_bip39_entropy(entropy, new Uint8Array());
  return rootKey.to_hex();
}

/**
 * Helper: Converts a hexadecimal string to a Uint8Array.
 * @param hex A valid hex string.
 * @returns The Uint8Array representation of the hex string.
 */
function hexToUint8Array(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Invalid hex string");
  }
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return arr;
}

/**
 * Helper: Derives a KeyObject from a root key hex and a derivation path.
 * Uses hardened derivation for purpose, coinType, and accountIndex,
 * and non-hardened derivation for role and index if provided.
 * @param rootKeyHex - The root key in hex format.
 * @param path - The target derivation path.
 * @returns A KeyObject with the derived key pair.
 */
export function deriveKeyObjectFromRoot(
  rootKeyHex: string,
  path: DerivationPath,
): KeyObject {
  const rootKey = Bip32PrivateKey.from_hex(rootKeyHex);
  let derived = rootKey;
  // Derive hardened segments: purpose, coinType, accountIndex.
  derived = derived.derive(path.purpose | 0x80000000);
  derived = derived.derive(path.coinType | 0x80000000);
  derived = derived.derive(path.accountIndex | 0x80000000);
  // If role and index are provided, derive them non-hardened.
  if (path.role !== undefined && path.index !== undefined) {
    derived = derived.derive(path.role).derive(path.index);
  }
  return {
    derivationPath: path,
    publicKey: derived.to_public().to_hex(),
    privateKey: derived.to_hex(),
  };
}

/**
 * Helper: Derives a KeyObject from a parent Bip32PrivateKey and an additional target derivation path.
 * Assumes that the parent's derivation path is a prefix of the target path.
 * @param parentKey - The parent's Bip32PrivateKey.
 * @param parentPath - The derivation path of the parent key.
 * @param targetPath - The target derivation path which should extend the parent's path.
 * @returns A KeyObject representing the derived key.
 */
function deriveKeyObjectFromParent(
  parentKey: Bip32PrivateKey,
  parentPath: DerivationPath,
  targetPath: DerivationPath,
): KeyObject {
  // Ensure the parent's path is a prefix of the target path.
  const parentStr = derivationPathToString(parentPath);
  const targetStr = derivationPathToString(targetPath);
  if (!targetStr.startsWith(parentStr)) {
    throw new Error(
      "Target derivation path is not a deeper extension of the parent.",
    );
  }
  // Derive additional steps from the parent's key.
  let derived = parentKey;
  // If parent's role is undefined and target provides one, derive that step.
  if (parentPath.role === undefined && targetPath.role !== undefined) {
    derived = derived.derive(targetPath.role);
  }
  // Similarly for index.
  if (parentPath.index === undefined && targetPath.index !== undefined) {
    derived = derived.derive(targetPath.index);
  }
  return {
    derivationPath: targetPath,
    publicKey: derived.to_public().to_hex(),
    privateKey: derived.to_hex(),
  };
}

/**
 * Helper: Derives a KeyObject from a parent Bip32PublicKey and an additional target derivation path.
 * This is used when the parent KeyObject does not contain a private key.
 * Public derivation can only derive non-hardened children.
 * @param parentPub - The parent's Bip32PublicKey.
 * @param parentPath - The derivation path of the parent key.
 * @param targetPath - The target derivation path which should extend the parent's path.
 * @returns A KeyObject representing the derived key with only a public key.
 */
function deriveKeyObjectFromParentPublic(
  parentPub: Bip32PublicKey,
  parentPath: DerivationPath,
  targetPath: DerivationPath,
): KeyObject {
  const parentStr = derivationPathToString(parentPath);
  const targetStr = derivationPathToString(targetPath);
  if (!targetStr.startsWith(parentStr)) {
    throw new Error(
      "Target derivation path is not a deeper extension of the parent.",
    );
  }
  let derived = parentPub;
  if (parentPath.role === undefined && targetPath.role !== undefined) {
    derived = derived.derive(targetPath.role);
  }
  if (parentPath.index === undefined && targetPath.index !== undefined) {
    derived = derived.derive(targetPath.index);
  }
  return {
    derivationPath: targetPath,
    publicKey: derived.to_hex(),
    privateKey: undefined,
  };
}

/**
 * Formats a DerivationPath object into a derivation path string.
 * If both role and index are provided, they are appended; otherwise only the base path is returned.
 * @param path - The derivation path components.
 * @returns A derivation path string.
 */
export function derivationPathToString(path: DerivationPath): string {
  let base = `m/${path.purpose}'/${path.coinType}'/${path.accountIndex}'`;
  if (path.role !== undefined && path.index !== undefined) {
    base += `/${path.role}/${path.index}`;
  }
  return base;
}

/**
 * Parses a derivation path string into a DerivationPath object.
 * Expected formats:
 * - "m/1852'/1815'/0'" or
 * - "m/1852'/1815'/0'/0/0"
 * @param pathStr - The derivation path string.
 * @returns A DerivationPath object.
 */
export function parseDerivationPath(
  pathStr: string | undefined,
): DerivationPath {
  if (!pathStr) {
    throw new Error("Derivation path string is undefined");
  }
  if (!pathStr.startsWith("m/")) {
    throw new Error("Invalid derivation path: must start with 'm/'");
  }
  const parts = pathStr.substring(2).split("/");
  if (parts.length !== 3 && parts.length !== 5) {
    throw new Error(
      "Invalid derivation path: expected 3 or 5 components after 'm/'",
    );
  }

  const parsePart = (part: string): number => {
    if (part.endsWith("'")) {
      part = part.slice(0, -1);
    }
    const num = parseInt(part, 10);
    if (isNaN(num)) {
      throw new Error(`Invalid number in derivation path: ${part}`);
    }
    return num;
  };

  const purpose = parsePart(parts[0]!);
  const coinType = parsePart(parts[1]!);
  const accountIndex = parsePart(parts[2]!);

  if (parts.length === 3) {
    return { purpose, coinType, accountIndex };
  }

  const role = parseInt(parts[3]!, 10);
  const index = parseInt(parts[4]!, 10);
  if (isNaN(role) || isNaN(index)) {
    throw new Error("Invalid role or index in derivation path.");
  }
  return { purpose, coinType, accountIndex, role, index };
}

/**
 * Constructs a KeyObject from a provided Bech32 encoded extended account public key.
 * If the provided string starts with 'acct_shared_xvk', it is decoded using the bech32 library.
 * @param bech32String - The Bech32 encoded public key string.
 * @param derivationPath - The derivation path associated with this key.
 * @returns A new KeyObject instance with the decoded public key and no private key.
 */
export function createKeyObjectFromBech32(
  bech32String: string,
  derivationPath?: DerivationPath,
): KeyObject {
  if (!bech32String.startsWith("acct_shared_xvk")) {
    throw new Error(
      "Provided key is not a valid acct_shared_xvk bech32 string.",
    );
  }
  derivationPath = parseDerivationPath("m/1854'/1815'/0'");
  // Decode the bech32 string
  const decoded = bech32.decode(bech32String, 200);
  const dataBytes = new Uint8Array(bech32.fromWords(decoded.words));

  // Convert the bytes to a hexadecimal string
  const bytesToHex = (bytes: Uint8Array): string =>
    bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");
  const pubKeyHex = bytesToHex(dataBytes);

  return {
    derivationPath,
    publicKey: pubKeyHex,
    privateKey: undefined,
  };
}

/**
 * Returns the public key hash for a given extended verification key string.
 * @param key - The extended verification key as a hexadecimal string.
 * @returns The public key hash as a hexadecimal string.
 */
export function getPubKeyHash(key: string): string {
  try {
    const bip32Pub = Bip32PublicKey.from_hex(key);
    return bip32Pub.to_raw_key().hash().to_hex();
  } catch (error) {
    console.error("Error generating pub key hash", error);
    return "";
  }
}

/**
 * Generates a bech32 Cardano address from the given KeyObject's public key.
 * @param key - The KeyObject containing the public key.
 * @param network - A boolean flag where false corresponds to Testnet (0) and true corresponds to Mainnet (1).
 * @returns The bech32-encoded Cardano address, or "N/A" if the public key is missing.
 */

export function pubKeyToAddr(
  paymentKey: KeyObject,
  stakeKey: KeyObject, // new parameter for stake key
  network: boolean
): string {
  if (!paymentKey.publicKey || !stakeKey.publicKey) return "N/A";
  const networkId = network ? 1 : 0;
  const bip32Payment = Bip32PublicKey.from_hex(paymentKey.publicKey);
  const paymentHash = bip32Payment.to_raw_key().hash();
  const bip32Stake = Bip32PublicKey.from_hex(stakeKey.publicKey);
  const stakeHash = bip32Stake.to_raw_key().hash();
  const paymentCred = Credential.from_keyhash(paymentHash);
  const stakeCred = Credential.from_keyhash(stakeHash);
  const baseAddr = BaseAddress.new(networkId, paymentCred, stakeCred);
  return baseAddr.to_address().to_bech32();
}

/**
 * Interface representing a metadata item returned from a lookup.
 */
export interface MetadataItem {
  tx_hash: string;
  json_metadata: {
    name: string;
    types: number[];
    participants: {
      [pubKeyHash: string]: {
        name: string;
      };
    };
  };
  network: boolean;
}

/**
 * Looks up wallet metadata using the given network id and an array of public key hashes.
 * It fetches metadata labeled with 1854 and returns only the items that have valid participants
 * and at least one participant matching one of the provided pubKeyHashes.
 *
 * @param network - The network id.
 * @param pubKeyHashes - An array of public key hashes.
 * @returns A promise that resolves to an array of MetadataItem objects.
 */
export async function lookupWallet(
  network: number,
  pubKeyHashes: string[],
): Promise<MetadataItem[]> {
  const provider = getProvider(network);
  try {
    const response = await provider.get("/metadata/txs/labels/1854");
    if (!Array.isArray(response)) {
      throw new Error("Invalid response format from provider");
    }

    // Filter valid items: only consider items that have non-empty participants in json_metadata
    const validItems = response.filter((item: any) => {
      const participants = item.json_metadata?.participants;
      return participants && Object.keys(participants).length > 0;
    });
    // Match items if any participant's key matches one of the provided pubKeyHashes
    const matchedItems = validItems.filter((item: any) => {
      const participants = item.json_metadata.participants;
      return Object.keys(participants).some((hash: string) =>
        pubKeyHashes.includes(hash.toLowerCase()),
      );
    });
    // Add the network field: false for Testnet (0), true for Mainnet (1)
    return matchedItems.map((item: any) => ({
      ...item,
      network: network === 1,
    }));
  } catch (error) {
    console.error("lookupWallet error:", error);
    return [];
  }
}
