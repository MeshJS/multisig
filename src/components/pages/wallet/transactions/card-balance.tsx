import Button from "@/components/common/button";
import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { numberWithCommas } from "@/utils/strings";
import { useWalletsStore } from "@/lib/zustand/wallets";
import type { Wallet } from "@/types/wallet";
import Link from "next/link";
import { useEffect, useState } from "react";
import { getBalanceFromUtxos } from "@/utils/getBalance";
import { Upload } from "lucide-react";
import ImportTransactionDialog from "./import-transaction-dialog";
import NewTransactionDialog from "./new-transaction-dialog";

export default function CardBalance({ appWallet }: { appWallet: Wallet }) {
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const walletAssets = useWalletsStore((state) => state.walletAssets);
  const utxos = walletsUtxos[appWallet.id];
  const [balance, setBalance] = useState<number>(0);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [newTransactionDialogOpen, setNewTransactionDialogOpen] = useState(false);

  useEffect(() => {
    if(!utxos) return
    const balance = getBalanceFromUtxos(utxos)
    if(!balance) return
    setBalance(balance);
  }, [utxos]);

  const nonAdaAssets = walletAssets?.filter(
    (asset) => asset.unit !== "lovelace",
  );

  return (
    <CardUI title="Balance" icon={`₳`}>
      <RowLabelInfo
        value={`₳ ${numberWithCommas(balance)}`}
        className="text-2xl font-bold"
      />
      <div>
        {nonAdaAssets?.length > 0 && (
          <p className="mb-2 text-sm text-muted-foreground">
            + {nonAdaAssets.length} asset{nonAdaAssets.length > 1 ? "s" : ""}
          </p>
        )}
        {balance <= 0 && (
          <p className="mb-2 text-sm text-muted-foreground">
            Please deposit fund to this script address before continuing
          </p>
        )}
        <div className="flex flex-col sm:flex-row gap-2 sm:space-x-2 sm:space-y-0">
          <Link href={`/wallets/${appWallet.id}/transactions/deposit`} className="w-full sm:w-auto">
            <Button size="sm" className="w-full sm:w-auto">Deposit Funds</Button>
          </Link>
          <Button 
            size="sm" 
            disabled={balance == 0} 
            className="w-full sm:w-auto"
            onClick={() => setNewTransactionDialogOpen(true)}
          >
            New Transaction
          </Button>
          <Button
            onClick={() => setImportDialogOpen(true)}
            size="sm"
            className="w-full sm:w-auto"
          >
            <Upload className="mr-2 h-4 w-4" />
            Import Transaction
          </Button>
        </div>
        <ImportTransactionDialog
          open={importDialogOpen}
          onOpenChange={setImportDialogOpen}
          walletId={appWallet.id}
        />
        <NewTransactionDialog
          open={newTransactionDialogOpen}
          onOpenChange={setNewTransactionDialogOpen}
          walletId={appWallet.id}
        />

        {/* Suggesting to disable the button if the balance is less than 0, or no previous transactions */}
        {/* <Button
          onClick={() => {
            window.location.href = `/wallets/${appWallet.id}/transactions/new`;
          }}
          disabled={balance <= 0}
          size="sm"
        >
          New Transaction
        </Button> */}
      </div>
    </CardUI>
  );
}
