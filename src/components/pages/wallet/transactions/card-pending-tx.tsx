import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { Wallet } from "@/types/wallet";
import { Send } from "lucide-react";

export default function CardPendingTx({ appWallet }: { appWallet: Wallet }) {
  const { transactions } = usePendingTransactions({ walletId: appWallet.id });

  return (
    <CardUI title="Pending Transactions" icon={Send}>
      {transactions && (
        <RowLabelInfo
          value={transactions.length.toString()}
          className="text-2xl font-bold"
        />
      )}
    </CardUI>
  );
}
