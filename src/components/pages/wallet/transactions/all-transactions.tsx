import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpRight, MoreHorizontal } from "lucide-react";
import LinkCardanoscan from "@/components/common/link-cardanoscan";
import { Wallet } from "@/types/wallet";
import useAllTransactions from "@/hooks/useAllTransactions";
import { dateToFormatted, getFirstAndLast, lovelaceToAda } from "@/utils/strings";
import CardUI from "@/components/common/card-content";
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
import { useEffect, useMemo, useState } from "react";
import ResponsiveTransactionsTable from "./responsive-transactions-table";
import ScrollableTableWrapper from "./scrollable-table-wrapper";

export default function AllTransactions({ appWallet }: { appWallet: Wallet }) {
  const { transactions: dbTransactions } = useAllTransactions({
    walletId: appWallet.id,
  });

  const _walletTransactions = useWalletsStore(
    (state) => state.walletTransactions,
  );

  const walletTransactions = _walletTransactions[appWallet.id];
  
  // Toggle between responsive and scrollable table
  const [useResponsiveTable, setUseResponsiveTable] = useState(false);

  if (walletTransactions === undefined)
    return <div className="text-center">No transactions yet</div>;

  return (
    <CardUI
      title="Transactions"
      description={``}
      headerDom={
        <LinkCardanoscan
          url={`address/${appWallet.address}`}
          className="ml-auto gap-1"
        >
          <Button size="sm">
            View All
            <ArrowUpRight className="h-4 w-4" />
          </Button>
        </LinkCardanoscan>
      }
      cardClassName="col-span-3"
    >
      {/* Option 1: Using the ScrollableTableWrapper component with shadow indicators */}
      <ScrollableTableWrapper>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Transaction</TableHead>
              <TableHead className="min-w-[150px]">Amount</TableHead>
              <TableHead className="min-w-[200px]">Signers</TableHead>
              <TableHead className="min-w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {walletTransactions &&
              walletTransactions.map((tx) => (
                <TransactionRow
                  key={tx.hash}
                  transaction={tx}
                  appWallet={appWallet}
                  dbTransaction={
                    dbTransactions &&
                    dbTransactions.find((t: Transaction) => t.txHash === tx.hash)
                  }
                />
              ))}
          </TableBody>
        </Table>
      </ScrollableTableWrapper>

      {/* Option 2: CSS-based force scroll (uncomment to use) */}
      {/* <div className="force-scroll-container">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px]">Transaction</TableHead>
              <TableHead className="min-w-[150px]">Amount</TableHead>
              <TableHead className="min-w-[200px]">Signers</TableHead>
              <TableHead className="min-w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {walletTransactions &&
              walletTransactions.map((tx) => (
                <TransactionRow
                  key={tx.hash}
                  transaction={tx}
                  appWallet={appWallet}
                  dbTransaction={
                    dbTransactions &&
                    dbTransactions.find((t: Transaction) => t.txHash === tx.hash)
                  }
                />
              ))}
          </TableBody>
        </Table>
      </div> */}

      {/* Option 3: Responsive table without scroll (uncomment to use) */}
      {/* <ResponsiveTransactionsTable
        appWallet={appWallet}
        walletTransactions={walletTransactions}
        dbTransactions={dbTransactions}
      /> */}
    </CardUI>
  );
}

function TransactionRow({
  transaction,
  appWallet,
  dbTransaction,
}: {
  transaction: OnChainTransaction;
  appWallet: Wallet;
  dbTransaction?: Transaction;
}) {
  const [transactionOutputs, setTransactionOutputs] = useState<
    {
      unit: string;
      quantity: number;
      decimals: number;
      assetName: string;
    }[]
  >([]);

  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );
  const walletAssets = useWalletsStore((state) => state.walletAssets);

  useEffect(() => {
    const outputs: {
      unit: string;
      quantity: number;
      decimals: number;
      assetName: string;
    }[] = [];
    transaction.outputs.map((output) => {
      Object.values(output.amount).map((outputValue) => {
        outputs.push({
          unit: outputValue.unit,
          quantity: Number(outputValue.quantity),
          decimals: walletAssetMetadata[outputValue.unit]?.decimals ?? 0,
          assetName:
            walletAssetMetadata[outputValue.unit]?.assetName ??
            outputValue.unit,
        });
      });
    });
    setTransactionOutputs(outputs);
  }, [transaction, walletAssetMetadata]);

  const outputList = useMemo((): JSX.Element => {
    return (
      <>
        {transaction.outputs.map((output: any, i) => {
          const isSpend = transaction.inputs.some(
            (input: any) => input.address === appWallet.address,
          );
          if (isSpend && output.address != appWallet.address) {
            return (
              <div key={i} className="flex gap-2">
                <div className="text-red-400">
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
                          ? `$${assetMetadata?.ticker}`
                          : unit.unit;
                    return (
                      <span key={unit.unit}>
                        {j > 0 && ", "}
                        {unit.quantity / Math.pow(10, decimals)} {assetName}
                      </span>
                    );
                  })}
                </div>
                <div className="text-sm text-muted-foreground">
                  {getFirstAndLast(output.address)}
                </div>
              </div>
            );
          } else if (!isSpend && output.address == appWallet.address) {
            return (
              <div key={i} className="flex gap-2">
                <div className="text-green-400">
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
                          ? `$${assetMetadata?.ticker}`
                          : unit.unit;
                    return (
                      <span key={unit.unit}>
                        {j > 0 && ", "}
                        {unit.quantity / Math.pow(10, decimals)} {assetName}
                      </span>
                    );
                  })}
                </div>
              </div>
            );
          }
        })}
      </>
    );
  }, [transaction, appWallet, walletAssetMetadata]);

  return (
    <TableRow style={{ backgroundColor: "none" }}>
      <TableCell>
        <div className="flex gap-2 text-sm text-muted-foreground md:inline">
          <LinkCardanoscan
            url={`transaction/${transaction.hash}`}
            className="flex w-44 flex-col gap-1"
          >
            <span className="flex gap-1">
              <span>
                {transaction.hash.substring(0, 6)}...
                {transaction.hash.slice(-6)}
              </span>
              <ArrowUpRight className="h-3 w-3" />
            </span>
            <span className="text-xs">
              {dateToFormatted(new Date(transaction.tx.block_time * 1000))}
            </span>
          </LinkCardanoscan>
        </div>
        {dbTransaction && (
          <div className="overflow-auto break-all font-medium">
            {dbTransaction.description}
          </div>
        )}
      </TableCell>
      <TableCell>
        {outputList}
        {dbTransaction && dbTransaction.description && (
          <>
            {dbTransaction.description == "DRep registration" && (
              <div className="flex gap-2">
                <div className="text-red-400">-{lovelaceToAda(500000000)}</div>
              </div>
            )}
            {dbTransaction.description == "DRep retirement" && (
              <div className="flex gap-2">
                <div className="text-green-400">{lovelaceToAda(500000000)}</div>
              </div>
            )}
          </>
        )}
      </TableCell>
      <TableCell>
        {dbTransaction &&
          dbTransaction.signedAddresses.map((address) => (
            <Badge variant="outline" key={address}>
              {appWallet.signersDescriptions.find(
                (signer, index) =>
                  appWallet.signersAddresses[index] === address,
              ) || getFirstAndLast(address)}
            </Badge>
          ))}
      </TableCell>
      <TableCell>
        <RowAction transaction={transaction} appWallet={appWallet} />
      </TableCell>
    </TableRow>
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

// function TransactionRowOld({
//   transaction,
//   appWallet,
//   dbTransaction,
// }: {
//   transaction: OnChainTransaction;
//   appWallet: Wallet;
//   dbTransaction?: Transaction;
// }) {
//   return (
//     <TableRow style={{ backgroundColor: "none" }}>
//       <TableCell>
//         <div className="flex justify-between">
//           <div className="overflow-auto break-all font-medium">
//             {dbTransaction && dbTransaction.description}
//           </div>
//           <div className="flex gap-2 text-sm text-muted-foreground md:inline">
//             <LinkCardanoscan
//               url={`transaction/${transaction.hash}`}
//               className="flex w-44 gap-1"
//             >
//               {dateToFormatted(new Date(transaction.tx.block_time * 1000))}
//               <ArrowUpRight className="h-3 w-3" />
//             </LinkCardanoscan>
//           </div>
//         </div>

//         <Table>
//           <TableBody>
//             {transaction.outputs.map((output: any, i) => {
//               const isSpend = transaction.inputs.some(
//                 (input: any) => input.address === appWallet.address,
//               );
//               if (isSpend && output.address != appWallet.address) {
//                 return (
//                   <div key={i}>
//                     <TableRow key={output.address} className="border-none">
//                       <TableCell>
//                         <div className="text-sm text-muted-foreground">
//                           {getFirstAndLast(output.address)}
//                         </div>
//                       </TableCell>
//                       <TableCell className="text-right text-red-400">
//                         -
//                         {lovelaceToAda(
//                           output.amount.find(
//                             (unit: any) => unit.unit === "lovelace",
//                           ).quantity,
//                         )}
//                       </TableCell>
//                     </TableRow>
//                   </div>
//                 );
//               } else if (!isSpend && output.address == appWallet.address) {
//                 return (
//                   <TableRow key={output.address} className="border-none">
//                     <TableCell></TableCell>
//                     <TableCell className="text-right text-green-400">
//                       +
//                       {lovelaceToAda(
//                         output.amount.find(
//                           (unit: any) => unit.unit === "lovelace",
//                         ).quantity,
//                       )}
//                     </TableCell>
//                   </TableRow>
//                 );
//               }
//             })}
//           </TableBody>
//         </Table>

//         {dbTransaction && (
//           <>
//             <div className="font-semibold">Signers</div>
//             <Table>
//               <TableBody>
//                 <TableRow className="border-none">
//                   <TableCell className="flex gap-2">
//                     {dbTransaction.signedAddresses.map((address) => (
//                       <Badge variant="outline" key={address}>
//                         {appWallet.signersDescriptions.find(
//                           (signer, index) =>
//                             appWallet.signersAddresses[index] === address,
//                         ) || getFirstAndLast(address)}
//                       </Badge>
//                     ))}
//                   </TableCell>
//                 </TableRow>
//               </TableBody>
//             </Table>
//           </>
//         )}
//       </TableCell>
//     </TableRow>
//   );
// }
