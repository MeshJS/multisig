import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { ArrowUpRight } from "lucide-react";
import LinkCardanoscan from "@/components/common/link-cardanoscan";
import { Wallet } from "@/types/wallet";
import useAllTransactions from "@/hooks/useAllTransactions";
import { Transaction } from "@prisma/client";
import { dateToFormatted, getFirstAndLast, lovelaceToAda } from "@/lib/strings";
import CardUI from "@/components/common/card-content";
import { getProvider } from "@/components/common/cardano-objects";
import { useEffect } from "react";

// how to pull from blockchain, because this is from database, and cannot show receiving

export default function AllTransactions({ appWallet }: { appWallet: Wallet }) {
  const { transactions } = useAllTransactions({ walletId: appWallet.id });

  async function getTransactionsOnChain() {
    const blockchainProvider = getProvider();
    const transactions = await blockchainProvider.get(
      `/addresses/${appWallet.address}/transactions`,
    );
    console.log(transactions);
  }

  useEffect(() => {
    if (appWallet) getTransactionsOnChain();
  }, [appWallet]);

  return (
    <CardUI
      title="Transactions"
      description={appWallet.description}
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
      cardClassName="col-span-2"
    >
      <Table>
        <TableBody>
          {transactions &&
            transactions.map((tx) => (
              <TransactionRow key={tx.id} transaction={tx} />
            ))}
        </TableBody>
      </Table>
    </CardUI>
  );

  // return (
  //   <Card className="col-span-2 self-start xl:col-span-2">
  //     <CardHeader className="flex flex-row items-center">
  //       <div className="grid gap-2">
  //         <CardTitle className="text-xl font-medium">Transactions</CardTitle>
  //       </div>
  //       <LinkCardanoscan
  //         url={`address/${appWallet.address}`}
  //         className="ml-auto gap-1"
  //       >
  //         <Button size="sm">
  //           View All
  //           <ArrowUpRight className="h-4 w-4" />
  //         </Button>
  //       </LinkCardanoscan>
  //     </CardHeader>
  //     <CardContent>
  //       <Table>
  //         <TableBody>
  //           {transactions &&
  //             transactions.map((tx) => (
  //               <TransactionRow key={tx.id} transaction={tx} />
  //             ))}
  //         </TableBody>
  //       </Table>
  //     </CardContent>
  //   </Card>
  // );
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const txJson = JSON.parse(transaction.txJson);
  return (
    <TableRow style={{ backgroundColor: "none" }}>
      <TableCell>
        <div className="flex justify-between">
          <div className="font-medium">{transaction.description}</div>
          <div className="flex gap-2 text-sm text-muted-foreground md:inline">
            <LinkCardanoscan
              url={`transaction/${transaction.txHash}`}
              className="flex gap-1"
            >
              {dateToFormatted(transaction.createdAt)}
              <ArrowUpRight className="h-3 w-3" />
            </LinkCardanoscan>
          </div>
        </div>

        <Table>
          <TableBody>
            {txJson.outputs.map((output: any) => (
              <TableRow key={output.address} className="border-none">
                <TableCell>
                  <div className="text-sm text-muted-foreground">
                    {getFirstAndLast(output.address)}
                  </div>
                </TableCell>
                <TableCell className="text-right text-red-400">
                  -
                  {lovelaceToAda(
                    output.amount.find((unit: any) => unit.unit === "lovelace")
                      .quantity,
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCell>
    </TableRow>
  );
}
