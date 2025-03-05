import React, { useState, useRef } from 'react';
import { Bip32PrivateKey } from '@emurgo/cardano-serialization-lib-browser';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

const KeyGenerator = () => {
  const [keys, setKeys] = useState({
    rootPrivateKey: '',
    rootPublicKey: '',
    utxoPubKey: '',
    stakeKey: '',
    drepKey: ''
  });
  const fileInputRef = useRef(null);

  // Helper to derive all keys from the root key.
  const deriveKeys = (rootKey) => {
    const rootPublicKey = rootKey.to_public();
    const accountKey = rootKey
      .derive(1854 | 0x80000000)
      .derive(1815 | 0x80000000)
      .derive(0 | 0x80000000);
    const utxoPubKey = accountKey.derive(0).derive(0).to_public();
    const stakeKey = accountKey.derive(2).derive(0).to_public();
    const drepKey = accountKey.derive(3).derive(0).to_public();
    return {
      rootPrivateKey: rootKey.to_hex(),
      rootPublicKey: rootPublicKey.to_hex(),
      utxoPubKey: utxoPubKey.to_hex(),
      stakeKey: stakeKey.to_hex(),
      drepKey: drepKey.to_hex()
    };
  };

  // Generate a new root key and derive its keys.
  const generateKeys = () => {
    const entropy = new Uint8Array(32);
    window.crypto.getRandomValues(entropy);
    const rootKey = Bip32PrivateKey.from_bip39_entropy(entropy, new Uint8Array());
    const newKeys = deriveKeys(rootKey);
    setKeys(newKeys);
  };

  // Export only the root private key as JSON.
  const exportKeys = () => {
    if (!keys.rootPrivateKey) {
      alert('No keys to export. Please generate keys first.');
      return;
    }
    const dataStr = JSON.stringify({ rootPrivateKey: keys.rootPrivateKey }, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'keys.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  // Import the root key, then re-derive all keys.
  const importKeys = (e) => {
    const fileReader = new FileReader();
    fileReader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (importedData.rootPrivateKey) {
          const rootKey = Bip32PrivateKey.from_hex(importedData.rootPrivateKey);
          const newKeys = deriveKeys(rootKey);
          setKeys(newKeys);
        } else {
          alert('Invalid key file. Root key not found.');
        }
      } catch (error) {
        console.error(error);
        alert('Failed to import keys.');
      }
    };
    if (e.target.files && e.target.files.length > 0) {
      fileReader.readAsText(e.target.files[0]);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Generate New Keys</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          <Button onClick={generateKeys} variant="outline">
            Generate Keys
          </Button>
          <div className="flex gap-2">
            <Button onClick={exportKeys} variant="outline">
              Export Root Key
            </Button>
            <Button
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              variant="outline"
            >
              Import Root Key
            </Button>
            <input
              type="file"
              accept=".json"
              ref={fileInputRef}
              onChange={importKeys}
              style={{ display: 'none' }}
            />
          </div>
        </div>
        {keys.rootPrivateKey && (
          <div className="mt-4 space-y-2">
            <h3 className="text-lg font-semibold">Derived Keys:</h3>
            <p>
              <span className="font-medium">Root Private Key:</span> {keys.rootPrivateKey}
            </p>
            <p>
              <span className="font-medium">Root Public Key:</span> {keys.rootPublicKey}
            </p>
            <p>
              <span className="font-medium">UTXO Public Key:</span> {keys.utxoPubKey}
            </p>
            <p>
              <span className="font-medium">Stake Key:</span> {keys.stakeKey}
            </p>
            <p>
              <span className="font-medium">Drep Key:</span> {keys.drepKey}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default KeyGenerator;