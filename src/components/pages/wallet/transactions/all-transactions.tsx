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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import LinkCardanoscan from "@/components/common/link-cardanoscan";
import { Wallet } from "@/types/wallet";
import useAllTransactions from "@/hooks/useAllTransactions";
import { Transaction } from "@prisma/client";
import { getFirstAndLast, lovelaceToAda } from "@/lib/strings";

// how to pull from blockchain, because this is from database, and cannot show receiving

export default function AllTransactions({ appWallet }: { appWallet: Wallet }) {
  const { transactions } = useAllTransactions({ walletId: appWallet.id });

  return (
    <Card className="col-span-2 self-start xl:col-span-2">
      <CardHeader className="flex flex-row items-center">
        <div className="grid gap-2">
          <CardTitle>Transactions</CardTitle>
        </div>
        <LinkCardanoscan
          url={`address/${appWallet.address}`}
          className="ml-auto gap-1"
        >
          <Button size="sm">
            View All
            <ArrowUpRight className="h-4 w-4" />
          </Button>
        </LinkCardanoscan>
      </CardHeader>
      <CardContent>
        <Table>
          <TableBody>
            {transactions &&
              transactions.map((tx) => (
                <TransactionRow key={tx.id} transaction={tx} />
              ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  const txJson = JSON.parse(transaction.txJson);

  return (
    <TableRow>
      <TableCell>
        <div className="font-medium">{transaction.description}</div>
        <div className="text-sm text-muted-foreground md:inline">
          {transaction.createdAt.toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "numeric",
          })}
        </div>

        <Table>
          <TableBody>
            {txJson.outputs.map((output: any) => (
              <TableRow key={output.address}>
                <TableCell>
                  <div className="font-medium">
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

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Address</TableHead>
      <TableHead className="text-right">Amount</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody></TableBody>
</Table>;
