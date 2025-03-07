// src/components/pages/homepage/wallets/invite/cip146/ExportMultisig.tsx
import React from "react";
import { Button } from "@/components/ui/button";
import { Bip32PrivateKey } from "@emurgo/cardano-serialization-lib-browser";
import { deriveAccountKeys } from "./146GenAcct";

interface ExportMultisigProps {
  rootKeyHex: string;
  exportType: "public" | "private";
  index: number;
}

const ExportMultisig: React.FC<ExportMultisigProps> = ({
  rootKeyHex,
  exportType,
  index,
}) => {
  const handleExport = () => {
    if (!rootKeyHex) {
      alert(
        "No root key available. Please generate or import a root key first.",
      );
      return;
    }
    // Use the provided index and roles [0,2,3]
    const derived = deriveAccountKeys(rootKeyHex, index, [0, 2, 3]);
    let acctKey: string, paymentKey: string, stakeKey: string, drepKey: string;
    if (exportType === "private") {
      // Use extended secret keys.
      acctKey = derived.accountKey;
      paymentKey = derived.derivedKeys[0].xsk;
      stakeKey = derived.derivedKeys[2].xsk;
      drepKey = derived.derivedKeys[3].xsk;
    } else {
      // Use extended verification keys.
      const acctPublic = Bip32PrivateKey.from_hex(derived.accountKey)
        .to_public()
        .to_hex();
      acctKey = acctPublic;
      paymentKey = derived.derivedKeys[0].xvk;
      stakeKey = derived.derivedKeys[2].xvk;
      drepKey = derived.derivedKeys[3].xvk;
    }
    // Use the first 20 characters of acctKey as the wallet/account id.
    const walletId = acctKey.slice(0, 20);
    // Construct the wallet data object with only the fields as modified.
    let walletData;
    if (exportType === "private") {
      walletData = {
        wallet: {
          id: walletId,
          networkId: "preprod",
          signType: "mnemonic",
          multiSig: [
            {
              priv: acctKey,
              path: [1854, 1815, index],
              keys: {
                payment: [
                  {
                    path: [1854, 1815, index, 0, 0],
                    cred: paymentKey,
                    used: false,
                  },
                ],
                stake: [
                  {
                    path: [1854, 1815, index, 2, 0],
                    cred: stakeKey,
                    used: false,
                  },
                ],
                drep: [
                  {
                    priv: drepKey,
                    path: [1854, 1815, index, 3, 0],
                  },
                ],
              },
            },
          ],
        },
      };
    } else {
      walletData = {
        wallet: {
          id: walletId,
          networkId: "preprod",
          signType: "mnemonic",
          multiSig: [
            {
              pub: acctKey,
              path: [1854, 1815, index],
              keys: {
                payment: [
                  {
                    path: [1854, 1815, index, 0, 0],
                    cred: paymentKey,
                    used: false,
                  },
                ],
                stake: [
                  {
                    path: [1854, 1815, index, 2, 0],
                    cred: stakeKey,
                    used: false,
                  },
                ],
                drep: [
                  {
                    pub: drepKey,
                    path: [1854, 1815, index, 3, 0],
                  },
                ],
              },
            },
          ],
        },
      };
    }
    const dataStr = JSON.stringify(walletData, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download =
      exportType === "private"
        ? "wallet_data_private.json"
        : "wallet_data_public.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button onClick={handleExport} variant="outline">
      {exportType === "private"
        ? "Export Private Wallet Data"
        : "Export Public Wallet Data"}
    </Button>
  );
};

export default ExportMultisig;
