import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PlusCircle, X } from "lucide-react";
import RecipientRow from "./RecipientRow";

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

  function updateRecipient(index: number, value: string) {
    const newAddresses = [...recipientAddresses];
    newAddresses[index] = value;
    setRecipientAddresses(newAddresses);
  }

  function updateAmount(index: number, value: string) {
    const newAmounts = [...amounts];
    newAmounts[index] = value;
    setAmounts(newAmounts);
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
            <RecipientRow
              key={index}
              index={index}
              recipientAddresses={recipientAddresses}
              setRecipientAddresses={setRecipientAddresses}
              amounts={amounts}
              setAmounts={setAmounts}
              disableAdaAmountInput={disableAdaAmountInput}
            />
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
