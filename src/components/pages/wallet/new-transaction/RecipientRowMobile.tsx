import { useState } from "react";

import { useWalletsStore } from "@/lib/zustand/wallets";
import { cn } from "@/lib/utils";

import { resolveAdaHandle } from "@/components/common/cardano-objects/resolve-adahandle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X } from "lucide-react";

/*
 * RecipientRowMobile is a mobile-specific component that renders recipient information in a card layout
 * @param recipientAddresses - An array of recipient addresses.
 * @param setRecipientAddresses - A function to update the recipientAddresses array.
 * @param amounts - An array of amounts for each recipient.
 * @param setAmounts - A function to update the amounts array.
 * @param disableAdaAmountInput - A boolean indicating whether ADA amount input should be disabled.
 */
function RecipientRowMobile({
  index,
  recipientAddresses,
  setRecipientAddresses,
  amounts,
  setAmounts,
  assets,
  setAssets,
  disableAdaAmountInput,
}: {
  index: number;
  recipientAddresses: string[];
  setRecipientAddresses: (value: string[]) => void;
  amounts: string[];
  setAmounts: (value: string[]) => void;
  assets: string[];
  setAssets: (value: string[]) => void;
  disableAdaAmountInput: boolean;
}) {
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);
  const [adaHandle, setAdaHandle] = useState<string>("");

  const walletAssets = useWalletsStore((state) => state.walletAssets);
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );

  const handleAddressChange = async (value: string) => {
    const newAddresses = [...recipientAddresses];
    newAddresses[index] = value;
    setRecipientAddresses(newAddresses);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (value.startsWith("$")) {
      const newTimeoutId = setTimeout(() => {
        void resolveAdaHandle(
          setAdaHandle,
          setRecipientAddresses,
          recipientAddresses,
          index,
          value,
        );
      }, 1000);
      setTimeoutId(newTimeoutId);
    } else {
      setAdaHandle("");
    }
  };

  const appWalletAssets = [
    {
      unit: "lovelace",
      assetName: "ADA",
      decimals: 6,
      amount: "0",
    },
    ...(walletAssets && walletAssets.length > 0
      ? walletAssets
          .filter((asset) => asset.unit !== "lovelace")
          .map((asset) => ({
            unit: asset.unit,
            assetName: walletAssetMetadata[asset.unit]?.assetName || asset.unit,
            decimals: walletAssetMetadata[asset.unit]?.decimals ?? 0,
            amount: asset.quantity,
          }))
      : []),
  ];

  return (
    <div className="border rounded-lg p-4 mb-3 bg-card">
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm font-medium text-muted-foreground">
          Recipient {index + 1}
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 -mt-1 -mr-1"
          onClick={() => {
            const newAddresses = [...recipientAddresses];
            newAddresses.splice(index, 1);
            setRecipientAddresses(newAddresses);
            const newAmounts = [...amounts];
            newAmounts.splice(index, 1);
            setAmounts(newAmounts);
            const newAssets = [...assets];
            newAssets.splice(index, 1);
            setAssets(newAssets);
          }}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground mb-1 block">
            Address
          </label>
          <Input
            type="string"
            placeholder="addr1... or $handle"
            value={recipientAddresses[index]}
            onChange={(e) => {
              void handleAddressChange(e.target.value);
            }}
            className="w-full"
          />
          {adaHandle && (
            <div className="text-xs text-muted-foreground mt-1">
              {adaHandle}
            </div>
          )}
        </div>
        
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Amount
            </label>
            <Input
              type="number"
              value={amounts[index]}
              onChange={(e) => {
                const newAmounts = [...amounts];
                newAmounts[index] = e.target.value;
                setAmounts(newAmounts);
              }}
              placeholder="0"
              disabled={disableAdaAmountInput}
              className="w-full"
            />
          </div>
          
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1 block">
              Asset
            </label>
            <Select
              value={assets[index]}
              onValueChange={(value) => {
                const newAssets = [...assets];
                newAssets[index] = value;
                setAssets(newAssets);
              }}
              disabled={disableAdaAmountInput}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {appWalletAssets.map((asset) => (
                  <SelectItem key={asset.unit} value={asset.unit}>
                    {asset.unit === "lovelace" ? "ADA" : asset.assetName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}

export default RecipientRowMobile;
