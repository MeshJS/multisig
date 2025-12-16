import { Button } from "@/components/ui/button";
import { ArrowUpRight, MoreHorizontal } from "lucide-react";
import LinkCardanoscan from "@/components/common/link-cardanoscan";
import { Wallet } from "@/types/wallet";
import { dateToFormatted, getFirstAndLast, truncateTokenSymbol } from "@/utils/strings";
import { OnChainTransaction } from "@/types/transaction";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { Transaction } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/utils/get-tx-builder";
import useTransaction from "@/hooks/useTransaction";
import { useMemo } from "react";

interface ResponsiveTransactionsTableProps {
  appWallet: Wallet;
  walletTransactions: OnChainTransaction[];
  dbTransactions?: Transaction[];
}

export default function ResponsiveTransactionsTable({
  appWallet,
  walletTransactions,
  dbTransactions,
}: ResponsiveTransactionsTableProps) {
  return (
    <div className="space-y-4">
      {/* Mobile view - Card layout */}
      <div className="space-y-3">
        {walletTransactions.map((tx) => (
          <TransactionCard
            key={tx.hash}
            transaction={tx}
            appWallet={appWallet}
            dbTransaction={
              dbTransactions &&
              dbTransactions.find((t: Transaction) => t.txHash === tx.hash)
            }
          />
        ))}
      </div>
    </div>
  );
}

function TransactionCard({
  transaction,
  appWallet,
  dbTransaction,
}: {
  transaction: OnChainTransaction;
  appWallet: Wallet;
  dbTransaction?: Transaction;
}) {
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );

  const outputList = useMemo(() => {
    return transaction.outputs.map((output: any, i) => {
      const isSpend = transaction.inputs.some(
        (input: any) => input.address === appWallet.address,
      );
      if (isSpend && output.address != appWallet.address) {
        return (
          <div key={i} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <span className="text-red-400 font-medium">
              -
              {output.amount.map((unit: any, j: number) => {
                const assetMetadata = walletAssetMetadata[unit.unit];
                const decimals =
                  unit.unit === "lovelace"
                    ? 6
                    : (assetMetadata?.decimals ?? 0);
                const assetName =
                  unit.unit === "lovelace"
                    ? "₳"
                    : assetMetadata?.ticker
                      ? `$${truncateTokenSymbol(assetMetadata.ticker)}`
                      : truncateTokenSymbol(unit.unit);
                return (
                  <span key={unit.unit}>
                    {j > 0 && ", "}
                    {unit.quantity / Math.pow(10, decimals)} {assetName}
                  </span>
                );
              })}
            </span>
            <span className="text-xs text-muted-foreground">
              to {getFirstAndLast(output.address)}
            </span>
          </div>
        );
      } else if (!isSpend && output.address == appWallet.address) {
        return (
          <div key={i} className="text-green-400 font-medium">
            +
            {output.amount.map((unit: any, j: number) => {
              const assetMetadata = walletAssetMetadata[unit.unit];
              const decimals =
                unit.unit === "lovelace"
                  ? 6
                  : (assetMetadata?.decimals ?? 0);
              const assetName =
                unit.unit === "lovelace"
                  ? "₳"
                  : assetMetadata?.ticker
                    ? `$${truncateTokenSymbol(assetMetadata.ticker)}`
                    : truncateTokenSymbol(unit.unit);
              return (
                <span key={unit.unit}>
                  {j > 0 && ", "}
                  {unit.quantity / Math.pow(10, decimals)} {assetName}
                </span>
              );
            })}
          </div>
        );
      }
      return null;
    }).filter(Boolean);
  }, [transaction, appWallet, walletAssetMetadata]);

  return (
    <div className="rounded-lg border p-4 space-y-3 bg-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <LinkCardanoscan
            url={`transaction/${transaction.hash}`}
            className="inline-flex items-center gap-1 text-sm font-medium hover:underline break-all"
          >
            <span className="break-all">
              {transaction.hash.substring(0, 8)}...
              {transaction.hash.slice(-8)}
            </span>
            <ArrowUpRight className="h-3 w-3 flex-shrink-0" />
          </LinkCardanoscan>
          <div className="text-xs text-muted-foreground mt-1">
            {dateToFormatted(new Date(transaction.tx.block_time * 1000))}
          </div>
        </div>
        <div className="flex-shrink-0">
        <RowAction transaction={transaction} appWallet={appWallet} />
        </div>
      </div>
      
      {dbTransaction && (
        <div className="text-sm break-words">{dbTransaction.description}</div>
      )}
      
      <div className="space-y-2">{outputList}</div>
      
      {dbTransaction && dbTransaction.signedAddresses.length > 0 && (
        <div>
          <div className="text-xs text-muted-foreground mb-2 font-medium">Signers:</div>
          <div className="flex flex-wrap gap-1.5">
            {dbTransaction.signedAddresses.map((address) => (
              <Badge variant="outline" key={address} className="text-xs">
                {appWallet.signersDescriptions.find(
                  (signer, index) =>
                    appWallet.signersAddresses[index] === address,
                ) || getFirstAndLast(address)}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RowAction({
  transaction,
  appWallet,
}: {
  transaction: OnChainTransaction;
  appWallet: Wallet;
}) {
  const network = useSiteStore((state) => state.network);
  const { newTransaction } = useTransaction();

  async function returnToSender() {
    const allTxInputsFromSameAddress = transaction.inputs.every(
      (input) => input.address === transaction.inputs[0]!.address,
    );

    if (allTxInputsFromSameAddress) {
      const txBuilder = getTxBuilder(network);

      const _amount: { [unit: string]: number } = {};

      for (const output of transaction.outputs) {
        if (output.address === appWallet.address) {
          for (const unit of output.amount) {
            if (!_amount[unit.unit]) {
              _amount[unit.unit] = 0;
            }
            _amount[unit.unit]! += parseInt(unit.quantity);
          }
        }
      }

      for (const output of transaction.outputs) {
        if (output.address === appWallet.address) {
          txBuilder
            .txIn(
              transaction.tx.tx_hash,
              output.output_index,
              output.amount,
              appWallet.address,
            )
            .txInScript(appWallet.scriptCbor);
        }
      }

      txBuilder.changeAddress(transaction.inputs[0]!.address);

      await newTransaction({
        txBuilder,
        description: `Return to sender`,
      });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex h-8 w-8 p-0 data-[state=open]:bg-muted"
        >
          <MoreHorizontal />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]">
        <DropdownMenuItem onClick={() => returnToSender()}>
          Return to sender
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}