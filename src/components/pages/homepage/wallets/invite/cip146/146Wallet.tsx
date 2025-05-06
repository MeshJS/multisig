import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import MultiSigSelector from "./146MultiSigSelector";
import { WalletConstructor, MetadataItem, getPubKeyHash, parseDerivationPath, pubKeyToAddr } from "@/lib/helper/cip146/146sdk";

interface WalletComponentProps {
  onSelectChildKeys: (childKeys: any[]) => void;
}

const WalletComponent: React.FC<WalletComponentProps> = ({
  onSelectChildKeys = () => { /* noop */ },
}) => {
  const [wallet, setWallet] = useState<WalletConstructor | null>(null);
  const [mnemonicInput, setMnemonicInput] = useState<string>("");
  const [acctXvkInput, setAcctXvkInput] = useState<string>("");
  const [lookupResults, setLookupResults] = useState<{
    [publicKey: string]: MetadataItem[];
  }>({});
  const [lookupNetworkInfo, setLookupNetworkInfo] = useState<string>("");
  // Dummy state to force re-render
  const [reRenderCounter, setReRenderCounter] = useState<number>(0);

  const importOrGenerateWallet = () => {
    try {
      let walletInstance: WalletConstructor;
      if (acctXvkInput.trim()) {
        walletInstance = new WalletConstructor(acctXvkInput.trim());
      } else if (mnemonicInput.trim()) {
        walletInstance = new WalletConstructor(mnemonicInput.trim());
      } else {
        walletInstance = new WalletConstructor();
      }
      // Derive an initial multisig group.
      walletInstance.deriveNextMultisig();
      setWallet(walletInstance);
      setReRenderCounter((c) => c + 1);
    } catch (error) {
      console.error("Failed to import or generate wallet:", error);
    }
  };

  // Button handler: derive the next multisig group and force re-render.
  const deriveNextMultisigHandler = () => {
    if (!wallet) return;
    try {
      const newKeys = wallet.deriveNextMultisig();
      setReRenderCounter((c) => c + 1);
    } catch (error) {
      console.error("Error deriving next multisig keys:", error);
    }
  };

  // Perform multisig lookup after wallet is set or updated.
  useEffect(() => {
    if (wallet) {
      wallet
        .lookupMultisigKeys()
        .then((metadataItems: MetadataItem[]) => {
          const updatedResults: { [publicKey: string]: MetadataItem[] } = {};
          wallet.keyObjects.forEach((keyObj) => {
            if (keyObj.publicKey) {
              const dp = keyObj.derivationPath;
              if (
                dp.purpose === 1854 &&
                typeof dp.role === "number" &&
                typeof dp.index === "number"
              ) {
                const pubHash = getPubKeyHash(keyObj.publicKey).toLowerCase();
                const itemsForKey = metadataItems.filter((item) => {
                  const participants = item.json_metadata?.participants || {};
                  return Object.keys(participants).some(
                    (hash) => hash.toLowerCase() === pubHash,
                  );
                });
                updatedResults[keyObj.publicKey] = itemsForKey;
              }
            }
          });
          setLookupResults(updatedResults);
          const networksFound = new Set(
            metadataItems.map((item) => (item.network ? "Mainnet" : "Testnet")),
          );
          if (networksFound.size === 0) {
            setLookupNetworkInfo("No metadata found on any network.");
          } else {
            setLookupNetworkInfo(
              "Lookup found metadata on: " +
                Array.from(networksFound).join(", "),
            );
          }
        })
        .catch((err) => {
          console.error("Lookup error:", err);
        });
    }
  }, [wallet, reRenderCounter]);

  return (
    <div className="">
      <Card className="mx-auto max-w-xl rounded-lg border border-slate-200 shadow">
        <CardHeader className="rounded-t-lg border-b border-slate-200 px-4 py-3">
          <CardTitle className="text-lg font-semibold">
            Wallet (146-SDK‑Based)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          {wallet ? (
            <div className="space-y-6">
              <div className="rounded-md border border-slate-200 p-4">
                <Label className="mb-1 text-sm font-semibold">Mnemonic</Label>
                <p className="break-all text-sm">{wallet.mnemonic || "N/A"}</p>
              </div>
              <div className="flex flex-col gap-4">
                {/* MultiSigSelector: emits selected child keys upward */}
                <MultiSigSelector wallet={wallet} onSelectChildKeys={onSelectChildKeys} />
                {/* Button to derive the next multisig group */}
                <Button
                  onClick={deriveNextMultisigHandler}
                  variant="outline"
                  className="w-full px-4 py-2 text-sm font-medium"
                >
                  Derive Next Multisig
                </Button>
              </div>
              <div className="pt-4">
                <Label className="text-sm font-semibold">
                  Lookup Network Info:
                </Label>
                <p className="text-sm text-slate-700">{lookupNetworkInfo}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="mnemonic" className="text-sm font-semibold">
                  Mnemonic (optional)
                </Label>
                <Input
                  id="mnemonic"
                  type="text"
                  className="text-sm"
                  placeholder="Enter mnemonic phrase"
                  value={mnemonicInput}
                  onChange={(e) => setMnemonicInput(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="acctXvk" className="text-sm font-semibold">
                  acct_shared_xvk (optional)
                </Label>
                <Input
                  id="acctXvk"
                  type="text"
                  className="text-sm"
                  placeholder="Enter acct_shared_xvk"
                  value={acctXvkInput}
                  onChange={(e) => setAcctXvkInput(e.target.value)}
                />
              </div>
              <Button
                onClick={importOrGenerateWallet}
                variant="outline"
                className="w-full px-4 py-2 text-sm font-medium"
              >
                Import / New Wallet
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default WalletComponent;
