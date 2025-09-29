import { useState } from "react";
import { Check, MoreVertical, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import CardUI from "@/components/ui/card-content";
import { Button } from "@/components/ui/button";
import EditSigners from "./card-edit-signers";
import ShowSigners from "./card-show-signers";
import { Wallet } from "@/types/wallet";

export default function CardSigners({ appWallet }: { appWallet: Wallet }) {
  const [showEdit, setShowEdit] = useState(false);

  return (
    <CardUI
      title="Signers"
      description={
        <>
          {(() => {
            const signersCount = appWallet.signersAddresses.length;
            if (appWallet.type === 'all') {
              return (
                <>
                  <b className="text-foreground">All signers</b> (of {signersCount}) must approve each transaction.
                </>
              );
            } else if (appWallet.type === 'any') {
              return (
                <>
                  <b className="text-foreground">Any signer</b> (of {signersCount}) can approve each transaction.
                </>
              );
            } else {
              return (
                <>
                  This wallet requires{" "}
                  <b className="text-foreground">{appWallet.numRequiredSigners}</b> of {signersCount} signers{" "}
                  to sign a transaction.
                </>
              );
            }
          })()}
        </>
      }
      headerDom={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" aria-haspopup="true" variant="ghost">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowEdit(!showEdit)}>
              {showEdit ? "Close Edit" : "Edit Signers"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      cardClassName="col-span-2"
    >
      {showEdit ? (
        <EditSigners appWallet={appWallet} setShowEdit={setShowEdit} />
      ) : (
        <ShowSigners appWallet={appWallet} />
      )}
    </CardUI>
  );
}
