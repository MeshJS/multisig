import React, { useState, useCallback } from "react";
import { Bip32PrivateKey } from "@emurgo/cardano-serialization-lib-browser";
import * as bip39 from "bip39";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClipboardCopy } from "lucide-react";
import ImportComponent from "./146Import";
import GenAcct, { DerivedAccountKeys } from "./146GenAcct";

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
  const [generatedMnemonic, setGeneratedMnemonic] = useState("");
  const [showCopied, setShowCopied] = useState(false);
  const [derivedKeys, setDerivedKeys] = useState<DerivedAccountKeys | null>(null);
  const handleKeysDerived = useCallback((keys: DerivedAccountKeys) => {
    setDerivedKeys(keys);
  }, []);

  const generateWallet = () => {
    // Generate a 24-word mnemonic (256 bits of entropy)
    const newMnemonic = bip39.generateMnemonic(256);
    setGeneratedMnemonic(newMnemonic);

    // Convert mnemonic to entropy hex and then to Uint8Array
    const entropyHex = bip39.mnemonicToEntropy(newMnemonic);
    const entropy = hexToUint8Array(entropyHex);

    // Derive the root key from the entropy
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

  const handleCopyMnemonic = () => {
    navigator.clipboard.writeText(generatedMnemonic);
    setShowCopied(true);
    // Hide the “Copied!” message after 2 seconds
    setTimeout(() => setShowCopied(false), 2000);
  };

  return (
  <Card className="max-w-lg mx-auto">
      <CardHeader>
        <CardTitle>CIP-0146 Wallet</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {/* Root Key Generation and Mnemonic Section */}
          <div className="flex flex-col gap-2">
            <Button onClick={generateWallet} variant="outline">
              Generate New Wallet
            </Button>

            <div className="flex flex-col gap-1">
              {/* Generated Mnemonic (24 words) */}
              {generatedMnemonic && (
                <>
                  <Label>Generated Mnemonic (24 words):</Label>
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                    {/* Make mnemonic wrap nicely on mobile */}
                    <span className="text-sm break-all flex-1">
                      {generatedMnemonic}
                    </span>
                    <Button
                      onClick={handleCopyMnemonic}
                      variant="outline"
                      size="icon"      // smaller icon button
                      className="w-8 h-8"
                    >
                      <ClipboardCopy className="w-4 h-4" />
                    </Button>
                  </div>
                  {showCopied && (
                    <span className="text-xs text-green-600">Copied!</span>
                  )}
                </>
              )}

              {/* Existing Mnemonic Input */}
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

          {/* Import for Account Key */}
          <div className="flex gap-2">
            <ImportComponent
              onImport={(importedAccountKeyHex) => {
                // Update account key state instead of root key.
                setAccountKeyHex(importedAccountKeyHex);
              }}
            />
          </div>

           {/* Display Derived Account and Role Keys using GenAcct */}
           {rootKeyHex && !accountKeyHex && (
            <GenAcct rootKeyHex={rootKeyHex} index={accountIndex} roleIds={[0, 2, 3]} onKeysDerived={handleKeysDerived} />
          )}
          {accountKeyHex && (
            <GenAcct accountKeyHex={accountKeyHex} roleIds={[0, 2, 3]} onKeysDerived={handleKeysDerived} />
          )}
        
        </div>
      </CardContent>
    </Card>
  );
};

export default KeyGenerator;