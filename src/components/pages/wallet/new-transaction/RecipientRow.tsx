import { useMemo, useState } from "react";

import { useWalletsStore } from "@/lib/zustand/wallets";
import { cn } from "@/lib/utils";

import { resolveAdaHandle } from "@/components/common/cardano-objects/resolve-adahandle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
    return walletAssets.map((asset) => {
      return {
        unit: asset.unit,
        assetName: walletAssetMetadata[asset.unit]?.assetName,
        decimals: walletAssetMetadata[asset.unit]?.decimals ?? 0,
        amount: asset.quantity,
      };
    });
  }, [walletAssets, walletAssetMetadata]);

  const assetOptions = useMemo(() => {
    return (
      <>
        {appWalletAssets.map((appWalletAssets) => {
          return (
            <option key={appWalletAssets.unit} value={appWalletAssets.unit}>
              {appWalletAssets.unit === "lovelace"
                ? "ADA"
                : appWalletAssets.assetName}
            </option>
          );
        })}
      </>
    );
  }, [appWalletAssets]);

  return (
    <TableRow>
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
          {adaHandle && <TableCell>{adaHandle}</TableCell>}
        </div>
      </TableCell>
      <TableCell>
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
      <TableCell className="w-[240px]">
        <select
          value={assets[index]}
          onChange={(e) => {
            const newAssets = [...assets];
            newAssets[index] = e.target.value;
            setAssets(newAssets);
          }}
          disabled={disableAdaAmountInput}
          className={cn(
            "flex h-9 w-full rounded-md border border-zinc-200 bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:placeholder:text-zinc-400 dark:focus-visible:ring-zinc-300",
          )}
        >
          {assetOptions}
        </select>
      </TableCell>
      <TableCell>
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
