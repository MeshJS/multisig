import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowUpRight } from "lucide-react";
import LinkCardanoscan from "@/components/common/link-cardanoscan";
import { Wallet } from "@/types/wallet";
import useAllTransactions from "@/hooks/useAllTransactions";
import { dateToFormatted, getFirstAndLast, lovelaceToAda } from "@/lib/strings";
import CardUI from "@/components/common/card-content";
import { OnChainTransaction } from "@/types/transaction";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { Transaction } from "@prisma/client";
import { Badge } from "@/components/ui/badge";

export default function AllTransactions({ appWallet }: { appWallet: Wallet }) {
  const { transactions: dbTransactions } = useAllTransactions({
    walletId: appWallet.id,
  });

  const _walletTransactions = useWalletsStore(
    (state) => state.walletTransactions,
  );

  const walletTransactions = _walletTransactions[appWallet.id];

  if (walletTransactions === undefined) return <></>;

  return (
    <CardUI
      title="Transactions"
      description={`Latest 10 transactions`}
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
  return (
    <TableRow style={{ backgroundColor: "none" }}>
      <TableCell>
        <div className="flex gap-2 text-sm text-muted-foreground md:inline">
          <LinkCardanoscan
            url={`transaction/${transaction.hash}`}
            className="flex w-44 gap-1"
          >
            {dateToFormatted(new Date(transaction.tx.block_time * 1000))}
            <ArrowUpRight className="h-3 w-3" />
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
    </TableRow>
  );
}

function TransactionRowOld({
  transaction,
  appWallet,
  dbTransaction,
}: {
  transaction: OnChainTransaction;
  appWallet: Wallet;
  dbTransaction?: Transaction;
}) {
  return (
    <TableRow style={{ backgroundColor: "none" }}>
      <TableCell>
        <div className="flex justify-between">
          <div className="overflow-auto break-all font-medium">
            {dbTransaction && dbTransaction.description}
          </div>
          <div className="flex gap-2 text-sm text-muted-foreground md:inline">
            <LinkCardanoscan
              url={`transaction/${transaction.hash}`}
              className="flex w-44 gap-1"
            >
              {dateToFormatted(new Date(transaction.tx.block_time * 1000))}
              <ArrowUpRight className="h-3 w-3" />
            </LinkCardanoscan>
          </div>
        </div>

        <Table>
          <TableBody>
            {transaction.outputs.map((output: any, i) => {
              const isSpend = transaction.inputs.some(
                (input: any) => input.address === appWallet.address,
              );
              if (isSpend && output.address != appWallet.address) {
                return (
                  <div key={i}>
                    <TableRow key={output.address} className="border-none">
                      <TableCell>
                        <div className="text-sm text-muted-foreground">
                          {getFirstAndLast(output.address)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-red-400">
                        -
                        {lovelaceToAda(
                          output.amount.find(
                            (unit: any) => unit.unit === "lovelace",
                          ).quantity,
                        )}
                      </TableCell>
                    </TableRow>
                  </div>
                );
              } else if (!isSpend && output.address == appWallet.address) {
                return (
                  <TableRow key={output.address} className="border-none">
                    <TableCell></TableCell>
                    <TableCell className="text-right text-green-400">
                      +
                      {lovelaceToAda(
                        output.amount.find(
                          (unit: any) => unit.unit === "lovelace",
                        ).quantity,
                      )}
                    </TableCell>
                  </TableRow>
                );
              }
            })}
          </TableBody>
        </Table>

        {dbTransaction && (
          <>
            <div className="font-semibold">Signers</div>
            <Table>
              <TableBody>
                <TableRow className="border-none">
                  <TableCell className="flex gap-2">
                    {dbTransaction.signedAddresses.map((address) => (
                      <Badge variant="outline" key={address}>
                        {appWallet.signersDescriptions.find(
                          (signer, index) =>
                            appWallet.signersAddresses[index] === address,
                        ) || getFirstAndLast(address)}
                      </Badge>
                    ))}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}
