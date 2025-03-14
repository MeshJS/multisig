// src/components/pages/homepage/wallets/invite/cip146/146GenAcct.tsx
import React, { useState, useEffect } from "react";
import {
  Bip32PrivateKey,
  Bip32PublicKey,
} from "@emurgo/cardano-serialization-lib-browser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSiteStore } from "@/lib/zustand/site";
import { getPubKeyHash } from "@/lib/helper/getPubKeyHash";
import { lookupWallet } from "./146lookup";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface DerivedAccountKeys {
  accountKey: string;
  derivedKeys: {
    [role: number]: {
      xsk: string;
      xvk: string;
      used: boolean;
      index: number;
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
  multisigIndex: number,
): DerivedAccountKeys {
  const rootKey = Bip32PrivateKey.from_hex(rootKeyHex);
  const accountKey = rootKey
    .derive(1854 | 0x80000000)
    .derive(1815 | 0x80000000)
    .derive(index | 0x80000000);
  const derivedKeys: { [role: number]: { xsk: string; xvk: string, used:boolean, index: number } } = {};
  roleIds.forEach((role) => {
    const roleKey = accountKey.derive(role).derive(multisigIndex);
    derivedKeys[role] = {
      xsk: roleKey.to_hex(),
      xvk: roleKey.to_public().to_hex(),
      used: false,
      index: 0,
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
  multisigIndex: number,
): { [role: number]: { xsk: string; xvk: string; used: boolean; index: number } } {
  const accountKey = Bip32PrivateKey.from_hex(accountKeyHex);
  const derivedKeys: { [role: number]: { xsk: string; xvk: string; used: boolean; index: number } } = {};
  roleIds.forEach((role) => {
    const roleKey = accountKey.derive(role).derive(multisigIndex);
    derivedKeys[role] = {
      xsk: roleKey.to_hex(),
      xvk: roleKey.to_public().to_hex(),
      used: false,
      index: 0,
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
  onKeysDerived?: (keys: DerivedAccountKeys) => void;
}

const GenAcct: React.FC<GenAcctProps> = ({
  rootKeyHex,
  accountKeyHex,
  index,
  roleIds,
  onKeysDerived,
}) => {
  const [derived, setDerived] = useState<DerivedAccountKeys | null>(null);
  const [mounted, setMounted] = useState(false);
  const [usedKeys, setUsedKeys] = useState<{ [role: number]: boolean }>({});
  const lookupPerformed = React.useRef(false);
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
          derivedKeys: deriveRoleKeysFromAccount(accountKeyHex, roleIds, 0),
        });
      } catch (err) {
        // If that fails, assume it's a public key.
        const pubKey = Bip32PublicKey.from_hex(accountKeyHex);
        const derivedKeys: { [role: number]: { xsk: string; xvk: string; used: boolean; index: number } } = {};
        roleIds.forEach((role) => {
          // Public derivation: derive child public keys.
          // Note: Only public keys (xvk) can be derived from a public key.
          const rolePub = pubKey.derive(role).derive(0);
          derivedKeys[role] = { xsk: "", xvk: rolePub.to_hex(), used: false, index: role };
        });
        setDerived({
          accountKey: accountKeyHex,
          derivedKeys,
        });
      }
    } else if (rootKeyHex && index !== undefined) {
      setDerived(deriveAccountKeys(rootKeyHex, index, roleIds, 0));
    } else {
      setDerived(null);
    }
  }, [rootKeyHex, accountKeyHex, index, roleIds]);

  const hasEmitted = React.useRef(false);
  useEffect(() => {
    if (derived && onKeysDerived && !hasEmitted.current) {
      onKeysDerived(derived);
      hasEmitted.current = true;
    }
  }, [derived, onKeysDerived]);

  useEffect(() => {
    async function fetchUsedKeys() {
      if (derived && !lookupPerformed.current) {
        // Extract pub key hashes for each role
        const pubKeyHashes = roleIds.map((role) =>
          getPubKeyHash(derived.derivedKeys[role]!.xvk).toLowerCase(),
        );
        // Lookup metadata using network id 0 (preprod)
        const lookupResult = await lookupWallet(network, pubKeyHashes);
        const used: { [role: number]: boolean } = {};
        // For each role, mark as used if its pubkey hash is found in any lookupResult participants
        roleIds.forEach((role) => {
          const keyHash = getPubKeyHash(derived.derivedKeys[role]!.xvk).toLowerCase();
          used[role] = lookupResult.some((item) => {
            const participants = item.json_metadata.participants;
            return Object.keys(participants).some(
              (hash) => hash.toLowerCase() === keyHash,
            );
          });
        });
        // Update derived state with the new used values, ensuring 'used' is always a boolean
        setDerived((prev) => {
          if (!prev) return prev;
          const updatedDerivedKeys = { ...prev.derivedKeys };
          roleIds.forEach((role) => {
            updatedDerivedKeys[role] = {
              ...updatedDerivedKeys[role]!,
              used: used[role] ?? false,
            };
          });
          return { ...prev, derivedKeys: updatedDerivedKeys };
        });
        // Also update the separate usedKeys state if needed
        setUsedKeys(used);
        lookupPerformed.current = true;
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
          <h3 className="mb-2 text-lg font-semibold">
            Account Key (acct_shared_xsk):
          </h3>
          <div className="mb-4 break-all rounded p-2 font-mono text-sm">
            {shortenKey(derived.accountKey)}
          </div>
          <h3 className="mb-2 text-lg font-semibold">Derived Role Keys:</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Role</TableHead>
                <TableHead>XVK Hash</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {roleIds.map((role) => (
                <TableRow key={role}>
                  <TableCell>Role {role}</TableCell>
                  <TableCell>
                    <code className="break-all rounded p-1 font-mono text-sm">
                      {shortenKey(
                        getPubKeyHash(derived.derivedKeys[role]!.xvk),
                      )}
                    </code>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded px-2 py-1 text-xs ${usedKeys[role] ? "bg-red-500 text-white" : "bg-green-500 text-white"}`}
                    >
                      {usedKeys[role] ? "Used" : "Unused"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
};

export default GenAcct;