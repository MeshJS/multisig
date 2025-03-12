import { resolveAdaHandle } from "@/components/common/cardano-objects/resolve-adahandle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import { X } from "lucide-react";
import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { useSiteStore } from "@/lib/zustand/site";

interface RecipientRowProps {
  index: number;
  recipientAddresses: string[];
  setRecipientAddresses: (value: string[]) => void;
  amounts: string[];
  setAmounts: (value: string[]) => void;
  disableAdaAmountInput: boolean;
}

/*
 * RecipientRow is a component that allows senders to configure information about an individual recipient in a transaction. The sender configures the recipient address and amount.
 * @param recipientAddresses - An array of recipient addresses.
 * @param setRecipientAddresses - A function to update the recipientAddresses array.
 * @param amounts - An array of amounts for each recipient.
 * @param setAmounts - A function to update the amounts array.
 * @param disableAdaAmountInput - A boolean indicating whether ADA amount input should be disabled.
 */
function RecipientRow(props: RecipientRowProps) {
  const {
    index,
    recipientAddresses,
    setRecipientAddresses,
    amounts,
    setAmounts,
    disableAdaAmountInput,
  } = props;
  // Local state for the input value
  const [localAddress, setLocalAddress] = useState(
    recipientAddresses[index] || "",
  );
  const [adaHandle, setAdaHandle] = useState<string>("");
  const [timeoutId, setTimeoutId] = useState<NodeJS.Timeout | null>(null);

  const network = useSiteStore((state) => state.network);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalAddress(e.target.value);
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    // Clear existing timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
      setTimeoutId(null);
    }

    // Set new timeout for lookup
    const newTimeoutId = setTimeout(() => {
      triggerLookup(e.target.value);
    }, 1000);
    setTimeoutId(newTimeoutId);
  };

  const updateParentAddress = (value: string) => {
    const newAddresses = [...recipientAddresses];
    newAddresses[index] = value;
    setRecipientAddresses(newAddresses);
  };

  const triggerLookup = async (value: string) => {
    if (value.startsWith("$") && value.length > 1) {
      // Do not perform handle lookup if network is 0
      if (network === 0) {
        toast({
          title: "ADA Handle Lookup Not Supported",
          description: "ADA Handle lookup is only supported on Mainnet.",
          variant: "destructive",
        });
        return;
      }
      await resolveAdaHandle(
        setAdaHandle,
        setRecipientAddresses,
        recipientAddresses,
        index,
        value,
      );
    } else {
      setAdaHandle("");
    }
  };

  const handleInputBlur = () => {
    updateParentAddress(localAddress);
    if (network !== 0) {
      triggerLookup(localAddress);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      triggerLookup(localAddress);
    }
  };

  function removeRecipient(index: number) {
    const newAddresses = [...recipientAddresses];
    newAddresses.splice(index, 1);
    setRecipientAddresses(newAddresses);

    const newAmounts = [...amounts];
    newAmounts.splice(index, 1);
    setAmounts(newAmounts);
  }

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <div className="flex flex-col gap-1">
              <Input
                type="text"
                placeholder={network === 1 ? "addr1... or $handle" : "addr1"}
                value={localAddress}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
              />
              {adaHandle && <TableCell>{adaHandle}</TableCell>}
            </div>
          </div>
          {adaHandle && (
            <div className="text-sm text-gray-500">{adaHandle}</div>
          )}
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
            placeholder="0"
            disabled={disableAdaAmountInput}
          />
        </div>
      </TableCell>
      <TableCell>
        <div
          className="flex flex-col"
          style={{ minHeight: adaHandle ? "76px" : "auto" }}
        >
          <Button
            size="icon"
            variant="ghost"
            onClick={() => removeRecipient(index)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

export default RecipientRow;
