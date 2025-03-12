// src/components/pages/homepage/wallets/invite/cip146/146GenAcct.tsx
import React, { useState, useEffect } from "react";
import {
  Bip32PrivateKey,
  Bip32PublicKey,
} from "@emurgo/cardano-serialization-lib-browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSiteStore } from "@/lib/zustand/site";
import { lookupWallet } from "./146lookup";

export interface DerivedAccountKeys {
  accountKey: string;
  derivedKeys: {
    [role: number]: {
      xsk: string;
      xvk: string;
    };
  };
}

/**
 * Derives an account key from a root key using the CIP‑1854 path: m/1854'/1815'/index'
 * and then derives role keys for each role in roleIds.
 */
export function deriveAccountKeys(
  rootKeyHex: string,
  index: number,
  roleIds: number[],
): DerivedAccountKeys {
  const rootKey = Bip32PrivateKey.from_hex(rootKeyHex);
  const accountKey = rootKey
    .derive(1854 | 0x80000000)
    .derive(1815 | 0x80000000)
    .derive(index | 0x80000000);
  const derivedKeys: { [role: number]: { xsk: string; xvk: string } } = {};
  roleIds.forEach((role) => {
    const roleKey = accountKey.derive(role).derive(0);
    derivedKeys[role] = {
      xsk: roleKey.to_hex(),
      xvk: roleKey.to_public().to_hex(),
    };
  });
  return {
    accountKey: accountKey.to_hex(),
    derivedKeys,
  };
}

/**
 * Derives role keys directly from an already derived account key (private version).
 */
export function deriveRoleKeysFromAccount(
  accountKeyHex: string,
  roleIds: number[],
): { [role: number]: { xsk: string; xvk: string } } {
  const accountKey = Bip32PrivateKey.from_hex(accountKeyHex);
  const derivedKeys: { [role: number]: { xsk: string; xvk: string } } = {};
  roleIds.forEach((role) => {
    const roleKey = accountKey.derive(role).derive(0);
    derivedKeys[role] = {
      xsk: roleKey.to_hex(),
      xvk: roleKey.to_public().to_hex(),
    };
  });
  return derivedKeys;
}

interface GenAcctProps {
  /** Either provide a rootKeyHex (with an account index) OR an already derived accountKeyHex */
  rootKeyHex?: string;
  accountKeyHex?: string;
  index?: number;
  roleIds: number[];
}

const GenAcct: React.FC<GenAcctProps> = ({
  rootKeyHex,
  accountKeyHex,
  index,
  roleIds,
}) => {
  const [derived, setDerived] = useState<DerivedAccountKeys | null>(null);
  const [mounted, setMounted] = useState(false);
  const [usedKeys, setUsedKeys] = useState<{ [role: number]: boolean }>({});
  const network = useSiteStore((state) => state.network);

  

  const shortenKey = (key: string): string => {
    return key.length > 20
      ? key.substring(0, 10) + " ... " + key.substring(key.length - 10)
      : key;
  };

  useEffect(() => {
    // Ensure derivation happens only on the client to avoid hydration issues.
    setMounted(true);
    if (accountKeyHex) {
      try {
        // Try to treat the account key as a private key.
        Bip32PrivateKey.from_hex(accountKeyHex);
        setDerived({
          accountKey: accountKeyHex,
          derivedKeys: deriveRoleKeysFromAccount(accountKeyHex, roleIds),
        });
      } catch (err) {
        // If that fails, assume it's a public key.
        const pubKey = Bip32PublicKey.from_hex(accountKeyHex);
        const derivedKeys: { [role: number]: { xsk: string; xvk: string } } =
          {};
        roleIds.forEach((role) => {
          // Public derivation: derive child public keys.
          // Note: Only public keys (xvk) can be derived from a public key.
          const rolePub = pubKey.derive(role).derive(0);
          derivedKeys[role] = { xsk: "", xvk: rolePub.to_hex() };
        });
        setDerived({
          accountKey: accountKeyHex,
          derivedKeys,
        });
      }
    } else if (rootKeyHex && index !== undefined) {
      setDerived(deriveAccountKeys(rootKeyHex, index, roleIds));
    } else {
      setDerived(null);
    }
  }, [rootKeyHex, accountKeyHex, index, roleIds]);

  const getPubKeyHash = (xvk: string): string => {
    try {
      const bip32Pub = Bip32PublicKey.from_hex(xvk);
      return bip32Pub.to_raw_key().hash().to_hex();
    } catch (error) {
      console.error("Error generating pub key hash", error);
      return "";
    }
  };

  useEffect(() => {
    async function fetchUsedKeys() {
      if (derived) {
        // Extract pub key hashes for each role
        const pubKeyHashes = roleIds.map((role) =>
          getPubKeyHash(derived.derivedKeys[role]!.xvk).toLowerCase()
        );
        // Lookup metadata using network id 0 (preprod)
        const lookupResult = await lookupWallet(network, pubKeyHashes);
        const used: { [role: number]: boolean } = {};
        // For each role, mark as used if its pubkey hash is found in any lookupResult participants
        roleIds.forEach((role) => {
          const keyHash = getPubKeyHash(derived.derivedKeys[role]!.xvk).toLowerCase();
          used[role] = lookupResult.some((item) => {
            const participants = item.json_metadata.participants;
            return Object.keys(participants).some((hash) => hash.toLowerCase() === keyHash);
          });
        });
        setUsedKeys(used);
      }
    }
    fetchUsedKeys();
  }, [derived, roleIds, network]);

  if (!mounted) return null;
  if (!derived) return <div>No account key available.</div>;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account and Role Keys</CardTitle>
      </CardHeader>
      <CardContent>
        <div>
          <h3>Account Key (acct_shared_xsk):</h3>
          <pre>{shortenKey(derived.accountKey)}</pre>
          <h3>Derived Role Keys:</h3>
          <ul>
            {roleIds.map((role) => (
              <li key={role}>
                <strong>Role {role}:</strong>
                <div>
                  <span>XSK: </span>
                  <pre>{shortenKey(derived.derivedKeys[role]!.xsk)}</pre>
                </div>
                <div>
                  <span>XVK: </span>
                  <pre>{shortenKey(derived.derivedKeys[role]!.xvk)}</pre>
                </div>
                <div>
                  <span>XVK Hash: </span>
                  <pre>{shortenKey(getPubKeyHash(derived.derivedKeys[role]!.xvk))}</pre>
                </div>
                <div>
                  <span>Status: </span>
                  <pre>{usedKeys[role] ? "Used" : "Unused"}</pre>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
};

export default GenAcct;
