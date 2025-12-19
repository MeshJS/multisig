import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpRight, MoreHorizontal, Award, UserMinus, UserPlus, UserCog } from "lucide-react";
import LinkCardanoscan from "@/components/common/link-cardanoscan";
import { Wallet } from "@/types/wallet";
import useAllTransactions from "@/hooks/useAllTransactions";
import { dateToFormatted, getFirstAndLast, lovelaceToAda, truncateTokenSymbol } from "@/utils/strings";
import CardUI from "@/components/ui/card-content";
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
import React, { useEffect, useMemo, useState } from "react";
import ResponsiveTransactionsTable from "./responsive-transactions-table";

export default function AllTransactions({ appWallet }: { appWallet: Wallet }) {
  const { transactions: dbTransactions } = useAllTransactions({
    walletId: appWallet.id,
  });

  const _walletTransactions = useWalletsStore(
    (state) => state.walletTransactions,
  );

  const walletTransactions = _walletTransactions[appWallet.id];

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
          <Button size="sm" className="text-xs sm:text-sm">
            <span className="hidden sm:inline">View All</span>
            <span className="sm:hidden">All</span>
            <ArrowUpRight className="h-3 w-3 sm:h-4 sm:w-4" />
          </Button>
        </LinkCardanoscan>
      }
      cardClassName="w-full"
    >
      {/* Mobile & Tablet: Responsive card layout */}
      <div className="lg:hidden">
        <ResponsiveTransactionsTable
                  appWallet={appWallet}
          walletTransactions={walletTransactions}
          dbTransactions={dbTransactions}
                />
      </div>

      {/* Desktop: Compact table without horizontal scroll */}
      <div className="hidden lg:block w-full overflow-visible">
        <div className="w-full">
          <Table className="w-full">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[30%]">Transaction</TableHead>
              <TableHead className="w-[25%]">Amount</TableHead>
              <TableHead className="w-[35%]">Signers</TableHead>
              <TableHead className="w-[10%]"></TableHead>
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
        </div>
      </div>
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

  const outputList = useMemo((): React.ReactElement => {
    return (
      <>
        {transaction.outputs.map((output: any, i) => {
          const isSpend = transaction.inputs.some(
            (input: any) => input.address === appWallet.address,
          );
          if (isSpend && output.address != appWallet.address) {
            return (
              <div key={i} className="flex flex-col gap-0.5">
                <div className="text-red-400 font-medium text-sm truncate">
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
                </div>
                <div className="text-xs text-muted-foreground font-mono truncate">
                  to {getFirstAndLast(output.address)}
                </div>
              </div>
            );
          } else if (!isSpend && output.address == appWallet.address) {
            return (
              <div key={i} className="text-green-400 font-medium text-sm truncate">
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
        })}
      </>
    );
  }, [transaction, appWallet, walletAssetMetadata]);

  const certificatesInfo = useMemo(() => {
    if (!dbTransaction?.txJson) return null;
    try {
      const txJson = JSON.parse(dbTransaction.txJson);
      if (!txJson.certificates || txJson.certificates.length === 0) return null;

      return txJson.certificates.map((cert: any) => {
        const certType = cert.certType?.type;
        if (certType === "DRepDeregistration") {
          return { type: "DRepDeregistration", icon: UserMinus, label: "DRep Deregistration", color: "text-orange-500" };
        } else if (certType === "DRepRegistration") {
          return { type: "DRepRegistration", icon: UserPlus, label: "DRep Registration", color: "text-blue-500" };
        } else if (certType === "DRepUpdate") {
          return { type: "DRepUpdate", icon: UserCog, label: "DRep Update", color: "text-purple-500" };
        }
        return { type: "Certificate", icon: Award, label: "Certificate", color: "text-muted-foreground" };
      });
    } catch (e) {
      return null;
    }
  }, [dbTransaction]);

  return (
    <TableRow style={{ backgroundColor: "none" }} className="hover:bg-muted/50">
      <TableCell className="align-top py-4">
        <div className="flex flex-col gap-1.5 min-w-0">
          <LinkCardanoscan
            url={`transaction/${transaction.hash}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors group"
          >
            <span className="font-mono text-xs truncate">
              {transaction.hash.substring(0, 8)}...{transaction.hash.slice(-8)}
            </span>
            <ArrowUpRight className="h-3.5 w-3.5 flex-shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />
          </LinkCardanoscan>
          <span className="text-xs text-muted-foreground">
            {dateToFormatted(new Date(transaction.tx.block_time * 1000))}
          </span>
        {dbTransaction && (
            <div className="text-sm font-medium break-words line-clamp-2">
            {dbTransaction.description}
          </div>
        )}
        {certificatesInfo && certificatesInfo.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {certificatesInfo.map((certInfo, idx) => {
              const Icon = certInfo.icon;
              return (
                <Badge key={idx} variant="outline" className={`text-xs ${certInfo.color} border-current/30`}>
                  <Icon className="h-3 w-3 mr-1" />
                  {certInfo.label}
                </Badge>
              );
            })}
          </div>
        )}
        </div>
      </TableCell>
      <TableCell className="align-top py-4">
        <div className="space-y-1.5 min-w-0">
        {outputList}
        {dbTransaction && dbTransaction.description && (
          <>
            {dbTransaction.description == "DRep registration" && (
                <div className="text-red-400 font-medium text-sm">
                  -{lovelaceToAda(500000000)} ₳
              </div>
            )}
            {dbTransaction.description == "DRep retirement" && (
                <div className="text-green-400 font-medium text-sm">
                  +{lovelaceToAda(500000000)} ₳
              </div>
            )}
          </>
        )}
        </div>
      </TableCell>
      <TableCell className="align-top py-4">
        <div className="flex flex-wrap gap-1.5 min-w-0">
        {dbTransaction &&
          dbTransaction.signedAddresses.map((address) => (
              <Badge 
                variant="outline" 
                key={address}
                className="text-xs font-normal"
              >
              {appWallet.signersDescriptions.find(
                (signer, index) =>
                  appWallet.signersAddresses[index] === address,
              ) || getFirstAndLast(address)}
            </Badge>
          ))}
          {(!dbTransaction || dbTransaction.signedAddresses.length === 0) && (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      </TableCell>
      <TableCell className="align-top py-4">
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
