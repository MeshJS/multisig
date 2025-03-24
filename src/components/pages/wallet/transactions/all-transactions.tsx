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
import { dateToFormatted, getFirstAndLast, lovelaceToAda } from "@/lib/strings";
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
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import useTransaction from "@/hooks/useTransaction";
import { useEffect, useState } from "react";

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
          <Button size="sm">
            View All
            <ArrowUpRight className="h-4 w-4" />
          </Button>
        </LinkCardanoscan>
      }
      cardClassName="col-span-3"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead></TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Signers</TableHead>
            <TableHead></TableHead>
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
          // decimals: userAssetMetadata[outputValue.unit]?.decimals ?? 0,
          // assetName:
          //   userAssetMetadata[outputValue.unit]?.assetName ?? outputValue.unit,
          decimals: 0,
          assetName: outputValue.unit,
        });
      });
    });
    setTransactionOutputs(outputs);
  }, [transaction]);
  console.log("transaction row", transactionOutputs);
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
        {transaction.outputs.map((output: any, i) => {
          const isSpend = transaction.inputs.some(
            (input: any) => input.address === appWallet.address,
          );
          if (isSpend && output.address != appWallet.address) {
            return (
              <div key={i} className="flex gap-2">
                <div className="text-red-400">
                  -
                  {lovelaceToAda(
                    output.amount.find((unit: any) => unit.unit === "lovelace")
                      .quantity,
                  )}
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
                  {lovelaceToAda(
                    output.amount.find((unit: any) => unit.unit === "lovelace")
                      .quantity,
                  )}
                </div>
              </div>
            );
          }
        })}
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
