import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { Wallet } from "@/types/wallet";
import { Send } from "lucide-react";

export default function CardPendingTx({ appWallet }: { appWallet: Wallet }) {
  const { transactions } = usePendingTransactions({ walletId: appWallet.id });

  return (
    <Card className="self-start">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">
          Pending Transactions
        </CardTitle>
        <div className="h-4 w-4 text-muted-foreground">
          <Send className="h-4 w-4 text-muted-foreground" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {transactions && transactions.length}
        </div>
      </CardContent>
    </Card>
  );
}
