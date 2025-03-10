import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PlusCircle, X, Search, Loader } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { resolveAdaHandle } from "@/components/common/cardano-objects/resolve-adahandle";
import { useSiteStore } from "@/lib/zustand/site";



  
interface RecipientSelectorProps {
  recipientAddresses: string[];
  setRecipientAddresses: (value: string[]) => void;
  amounts: string[];
  setAmounts: (value: string[]) => void;
  disableAdaAmountInput: boolean;
}

export default function RecipientSelector({
  recipientAddresses,
  setRecipientAddresses,
  amounts,
  setAmounts,
  disableAdaAmountInput,
}: RecipientSelectorProps) {
  const network = useSiteStore((state) => state.network);
  
  function addNewRecipient() {
    setRecipientAddresses([...recipientAddresses, ""]);
    setAmounts([...amounts, ""]);
  }

  function removeRecipient(index: number) {
    const newAddresses = [...recipientAddresses];
    newAddresses.splice(index, 1);
    setRecipientAddresses(newAddresses);

    const newAmounts = [...amounts];
    newAmounts.splice(index, 1);
    setAmounts(newAmounts);
  }

  // Removed unused functions: updateRecipient and updateAmount

  function RecipientRow({ index }: { index: number }) {
    // Local state for the input value
  const [localAddress, setLocalAddress] = useState(recipientAddresses[index] || "");
  const [adaHandle, setAdaHandle] = useState<string>("");
  const [lookupLoading, setLookupLoading] = useState(false);
  
    // Sync localAddress if parent's value changes externally
    useEffect(() => {
      setLocalAddress(recipientAddresses[index] || "");
    }, [recipientAddresses[index]]);
  
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      setLocalAddress(e.target.value);
    };
  
    const updateParentAddress = (value: string) => {
      const newAddresses = [...recipientAddresses];
      newAddresses[index] = value;
      setRecipientAddresses(newAddresses);
    };
  
  const triggerLookup = async (value: string) => {
    // Do not perform handle lookup if network is 0
    if (network === 0) return;
    if (value.startsWith("$") && value.length > 1) {
      setLookupLoading(true);
      await resolveAdaHandle(
        setAdaHandle,
        setRecipientAddresses,
        recipientAddresses,
        index,
        value
      );
      setLookupLoading(false);
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
      updateParentAddress(localAddress);
      if (network !== 0) {
        triggerLookup(localAddress);
      }
    }
  };
  
    return (
      <TableRow>
        <TableCell>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Input
                type="text"
                placeholder={(network===1)?"addr1... or $handle":"addr1"}
                value={localAddress}
                onChange={handleInputChange}
                onBlur={handleInputBlur}
                onKeyDown={handleKeyDown}
              />
              {network !== 0 && (
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={async () => {
                    updateParentAddress(localAddress);
                    await triggerLookup(localAddress);
                  }}
                >
                  {lookupLoading ? (
                    <Loader className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                </Button>
              )}
            </div>
            {adaHandle && <div className="text-sm text-gray-500">{adaHandle}</div>}
          </div>
        </TableCell>
        <TableCell>
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
        </TableCell>
        <TableCell>
          <Button size="icon" variant="ghost" onClick={() => removeRecipient(index)}>
            <X className="h-4 w-4" />
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <div className="w-full">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Address</TableHead>
            <TableHead className="w-[120px]">Amount in ADA</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recipientAddresses.map((_, index) => (
            <RecipientRow key={index} index={index} />
          ))}
          <TableRow>
            <TableCell colSpan={3}>
              <Button
                size="sm"
                variant="ghost"
                className="gap-1"
                onClick={addNewRecipient}
                disabled={disableAdaAmountInput}
              >
                <PlusCircle className="h-3.5 w-3.5" />
                Add Recipient
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}