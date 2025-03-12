// src/components/pages/homepage/wallets/invite/cip146/146Wallet.tsx
import React, { useState } from "react";
import { Bip32PrivateKey } from "@emurgo/cardano-serialization-lib-browser";
import bip39 from "bip39";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ImportComponent from "./146Import";
import ExportMultisig from "./146Export";
import GenAcct from "./146GenAcct";

const hexToUint8Array = (hex: string): Uint8Array => {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return arr;
};

const KeyGenerator = () => {
  const [rootKeyHex, setRootKeyHex] = useState("");
  const [accountIndex, setAccountIndex] = useState(0);
  const [mnemonic, setMnemonic] = useState("");
  const [accountKeyHex, setAccountKeyHex] = useState("");

  const generateRootKey = () => {
    const entropy = new Uint8Array(32);
    window.crypto.getRandomValues(entropy);
    const rootKey = Bip32PrivateKey.from_bip39_entropy(entropy, new Uint8Array());
    setRootKeyHex(rootKey.to_hex());
  };

  const importFromMnemonic = () => {
    if (!mnemonic.trim()) {
      alert("Please enter a mnemonic phrase.");
      return;
    }
    try {
      const entropyHex = bip39.mnemonicToEntropy(mnemonic.trim());
      const entropy = hexToUint8Array(entropyHex);
      const rootKey = Bip32PrivateKey.from_bip39_entropy(entropy, new Uint8Array());
      setRootKeyHex(rootKey.to_hex());
    } catch (error) {
      console.error(error);
      alert("Failed to import from mnemonic. Please ensure the mnemonic is valid.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Wallet Derivation</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {/* Root Key Generation and Mnemonic Import */}
          <div className="flex flex-col gap-2">
            <Button onClick={generateRootKey} variant="outline">
              Generate Root Key
            </Button>
            <div className="flex flex-col gap-1">
              <Label htmlFor="mnemonic">Mnemonic Phrase:</Label>
              <Input
                id="mnemonic"
                type="text"
                placeholder="Enter mnemonic phrase"
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
              />
              <Button onClick={importFromMnemonic} variant="outline" size="sm">
                Import from Mnemonic
              </Button>
            </div>
            {rootKeyHex && (
              <p className="break-all">
                <span className="font-medium">Root Key:</span> {rootKeyHex}
              </p>
            )}
          </div>
          {/* Account Index Input */}
          <div className="flex items-center gap-2">
            <Label htmlFor="accountIndex">Account Index:</Label>
            <Input
              id="accountIndex"
              type="number"
              min="0"
              value={accountIndex}
              onChange={(e) => setAccountIndex(Number(e.target.value))}
              className="w-20"
            />
          </div>
          {/* Display Derived Account and Role Keys using GenAcct */}
          {rootKeyHex && !accountKeyHex && (
            <GenAcct rootKeyHex={rootKeyHex} index={accountIndex} roleIds={[0, 2, 3]} />
          )}
          {accountKeyHex && (
            <GenAcct accountKeyHex={accountKeyHex} roleIds={[0, 2, 3]} />
          )}
          {/* Import for Account Key */}
          <div className="flex gap-2">
            <ImportComponent
              onImport={(importedAccountKeyHex) => {
                // Update account key state instead of root key.
                setAccountKeyHex(importedAccountKeyHex);
              }}
            />
          </div>
          {/* Export Multisig Wallet Data */}
          <div className="flex gap-2">
            {rootKeyHex && (
              <>
                <ExportMultisig
                  rootKeyHex={rootKeyHex}
                  exportType="public"
                  index={accountIndex}
                />
                <ExportMultisig
                  rootKeyHex={rootKeyHex}
                  exportType="private"
                  index={accountIndex}
                />
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default KeyGenerator;