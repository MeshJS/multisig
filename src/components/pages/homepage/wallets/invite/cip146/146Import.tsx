// src/components/pages/homepage/wallets/invite/cip146/146Import.tsx
import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Bip32PublicKey, Address } from "@emurgo/cardano-serialization-lib-browser";
import { bech32 } from "bech32"; // used only for debugging the payload

interface ImportProps {
  onImport: (accountKeyHex: string) => void;
}

const ImportComponent: React.FC<ImportProps> = ({ onImport }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [directInput, setDirectInput] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileReader = new FileReader();
    fileReader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target?.result as string);
        // Check for our simple export format: directly exported account key.
        if (importedData.acct_shared_xsk) {
          onImport(importedData.acct_shared_xsk);
          return;
        }
        // Check for our multisig export format.
        if (
          importedData.wallet &&
          importedData.wallet.multiSig &&
          Array.isArray(importedData.wallet.multiSig) &&
          importedData.wallet.multiSig.length > 0
        ) {
          const ms = importedData.wallet.multiSig[0];
          if (ms.priv) {
            onImport(ms.priv);
            return;
          } else if (ms.pub) {
            onImport(ms.pub);
            return;
          }
        }
          setErrorMessage("Invalid file. Account key not found.");
      } catch (error) {
        console.error(error);
        setErrorMessage("Failed to import account key.");
      }
    };
    fileReader.readAsText(file);
  };

  const handleFileImport = () => {
    fileInputRef.current?.click();
  };

  const handleDirectImport = () => {
    if (!directInput.trim()) {
      setErrorMessage("Please enter an account key.");
      return;
    }
    setErrorMessage("");
    // Simply pass the direct input to the callback.
    onImport(directInput.trim());
  };

  const importFromBech32 = () => {
    if (!directInput.trim()) {
      setErrorMessage("Please enter a Bech32 address.");
      return;
    }

    const input = directInput.trim();
    try {
      // Only support extended account keys with prefix 'acct_shared_xvk'
      if (!input.startsWith("acct_shared_xvk")) {
        throw new Error("Unsupported Bech32 format. Expected extended account key with prefix acct_shared_xvk.");
      }

      // Manually decode the Bech32 string using the bech32 library
      const decoded = bech32.decode(input, 200);
      const dataBytes = new Uint8Array(bech32.fromWords(decoded.words));
      const bytesToHex = (bytes: Uint8Array): string =>
        bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");
      const pubKeyHex = bytesToHex(dataBytes);

      // Validate the decoded key by parsing it with from_hex
      const bip32Pub = Bip32PublicKey.from_hex(pubKeyHex);
 
      onImport(pubKeyHex);
      setErrorMessage("");
    } catch (error) {
      console.error("Bech32 decoding error:", error);
      setErrorMessage("Invalid Bech32 address: " + error);
    }
  };

  return (
    <div>
      <div className="flex gap-2">
        <Button onClick={handleFileImport} variant="outline">
          Import Account Key (File)
        </Button>
        <input
          type="file"
          accept=".json"
          ref={fileInputRef}
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>
      <div className="flex flex-col gap-1 mt-2">
        <Label htmlFor="directKey">Or paste account key (Hex or Bech32):</Label>
        <Input
          id="directKey"
          type="text"
          placeholder="Enter account key hex or Bech32 address"
          value={directInput}
          onChange={(e) => setDirectInput(e.target.value)}
        />
        {errorMessage && <p className="text-red-500">{errorMessage}</p>}
        <div className="flex gap-2">
          <Button onClick={handleDirectImport} variant="outline">
            Import Account Key (Hex)
          </Button>
          <Button onClick={importFromBech32} variant="outline">
            Import from Bech32 Address
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ImportComponent;