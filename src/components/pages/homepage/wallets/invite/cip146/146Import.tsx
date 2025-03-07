// src/components/pages/homepage/wallets/invite/cip146/146Import.tsx
import React, { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ImportProps {
  onImport: (accountKeyHex: string) => void;
}

const ImportComponent: React.FC<ImportProps> = ({ onImport }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [directInput, setDirectInput] = useState("");

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
        alert("Invalid file. Account key not found.");
      } catch (error) {
        console.error(error);
        alert("Failed to import account key.");
      }
    };
    fileReader.readAsText(file);
  };

  const handleFileImport = () => {
    fileInputRef.current?.click();
  };

  const handleDirectImport = () => {
    if (!directInput.trim()) {
      alert("Please enter an account key.");
      return;
    }
    // Simply pass the direct input to the callback.
    onImport(directInput.trim());
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
        <Label htmlFor="directKey">Or paste account key:</Label>
        <Input
          id="directKey"
          type="text"
          placeholder="Enter account key hex"
          value={directInput}
          onChange={(e) => setDirectInput(e.target.value)}
        />
        <Button onClick={handleDirectImport} variant="outline">
          Import Account Key (Text)
        </Button>
      </div>
    </div>
  );
};

export default ImportComponent;