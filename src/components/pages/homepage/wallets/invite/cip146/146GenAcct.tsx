// src/components/pages/homepage/wallets/invite/cip146/146GenAcct.tsx
import React, { useState, useEffect } from "react";
import { Bip32PrivateKey, Bip32PublicKey } from "@emurgo/cardano-serialization-lib-browser";

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
  roleIds: number[]
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
  roleIds: number[]
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
        const derivedKeys: { [role: number]: { xsk: string; xvk: string } } = {};
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

  if (!mounted) return null;
  if (!derived) return <div>No account key available.</div>;

  return (
    <div>
      <h3>Account Key (acct_shared_xsk):</h3>
      <pre>{derived.accountKey}</pre>
      <h3>Derived Role Keys:</h3>
      <ul>
        {roleIds.map((role) => (
          <li key={role}>
            <strong>Role {role}:</strong>
            <div>
              <span>XSK: </span>
              <pre>{derived.derivedKeys[role].xsk}</pre>
            </div>
            <div>
              <span>XVK: </span>
              <pre>{derived.derivedKeys[role].xvk}</pre>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default GenAcct;