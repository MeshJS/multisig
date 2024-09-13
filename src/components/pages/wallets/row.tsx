import { MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableCell, TableRow } from "@/components/ui/table";
import { Wallet } from "@/types/wallet";
import {
  resolveNativeScriptHash,
  resolveScriptHashDRepId,
} from "@meshsdk/core";
import { getFirstAndLast } from "@/lib/strings";
import { Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import Link from "next/link";

export default function Row({ wallet }: { wallet: Wallet }) {
  const { toast } = useToast();

  const getDrepId = () => {
    if (wallet.nativeScript) {
      return resolveScriptHashDRepId(
        resolveNativeScriptHash(wallet.nativeScript),
      );
    }
    return "N/A";
  };

  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link href={`/wallets/${wallet.id}`}>{wallet.name}</Link>
      </TableCell>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          {getFirstAndLast(wallet.address)}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(wallet.address);
              toast({
                title: "Copied",
                description: "Address copied to clipboard",
                duration: 5000,
              });
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
      <TableCell className="font-medium">
        <div className="flex items-center gap-2">
          {getFirstAndLast(getDrepId())}
          <Button
            size="icon"
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(getDrepId());
              toast({
                title: "Copied",
                description: "dRepId copied to clipboard",
                duration: 5000,
              });
            }}
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
      <TableCell>
        {/* <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-haspopup="true" size="icon" variant="ghost">
              <MoreHorizontal className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem>Edit</DropdownMenuItem>
            <DropdownMenuItem>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu> */}
      </TableCell>
    </TableRow>
  );
}
