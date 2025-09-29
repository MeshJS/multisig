import { useMemo, useState } from "react";

import { useWalletsStore } from "@/lib/zustand/wallets";
import { cn } from "@/lib/utils";

import { resolveAdaHandle } from "@/components/common/cardano-objects/resolve-adahandle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TableCell, TableRow } from "@/components/ui/table";
import { X } from "lucide-react";
/*
 * RecipientRow is a component that allows senders to configure information about an individual recipient in a transaction. The sender configures the recipient address and amount.
 * @param recipientAddresses - An array of recipient addresses.
 * @param setRecipientAddresses - A function to update the recipientAddresses array.
 * @param amounts - An array of amounts for each recipient.
 * @param setAmounts - A function to update the amounts array.
 * @param disableAdaAmountInput - A boolean indicating whether ADA amount input should be disabled.
 */
function RecipientRow({
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

  const appWalletAssets = useMemo(() => {
    // Always include ADA/lovelace as the first option
    const assets = [
      {
        unit: "lovelace",
        assetName: "ADA",
        decimals: 6,
        amount: "0",
      }
    ];

    // Add other assets from walletAssets if available
    if (walletAssets && walletAssets.length > 0) {
      walletAssets.forEach((asset) => {
        if (asset.unit !== "lovelace") {
          assets.push({
            unit: asset.unit,
            assetName: walletAssetMetadata[asset.unit]?.assetName || asset.unit,
            decimals: walletAssetMetadata[asset.unit]?.decimals ?? 0,
            amount: asset.quantity,
          });
        }
      });
    }

    return assets;
  }, [walletAssets, walletAssetMetadata]);


  return (
    <TableRow className="hidden sm:table-row">
      <TableCell>
        <div className="flex flex-col gap-1">
          <Input
            type="string"
            placeholder="addr1... or $handle"
            value={recipientAddresses[index]}
            onChange={(e) => {
              void handleAddressChange(e.target.value);
            }}
          />
          {adaHandle && <div className="text-xs text-muted-foreground">{adaHandle}</div>}
        </div>
      </TableCell>
      <TableCell className="w-[120px] sm:w-[140px]">
        <div
          className="flex flex-col"
          style={{ minHeight: adaHandle ? "76px" : "auto" }}
        >
          <Input
            type="number"
            value={amounts[index]}
            onChange={(e) => {
              const newAmounts = [...amounts];
              newAmounts[index] = e.target.value;
              setAmounts(newAmounts);
            }}
            placeholder=""
            disabled={disableAdaAmountInput}
          />
        </div>
      </TableCell>
      <TableCell className="w-[140px] sm:w-[180px]">
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
      </TableCell>
      <TableCell className="w-[60px] sm:w-[80px]">
        <div
          className="flex flex-col"
          style={{ minHeight: adaHandle ? "76px" : "auto" }}
        >
          <Button
            size="icon"
            variant="ghost"
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
      </TableCell>
    </TableRow>
  );
}

export default RecipientRow;
