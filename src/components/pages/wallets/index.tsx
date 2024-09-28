import { Button } from "@/components/ui/button";
import Link from "next/link";
import PageHeader from "@/components/common/page-header";
import useUserWallets from "@/hooks/useUserWallets";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { getFirstAndLast } from "@/lib/strings";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import { useState } from "react";

export default function PageWallets() {
  const { wallets } = useUserWallets();
  const [showArchived, setShowArchived] = useState(false);

  return (
    <>
      <>
        <PageHeader pageTitle="Wallets">
          <Button size="sm" asChild>
            <Link href="/wallets/new-wallet">New Wallet</Link>
          </Button>
          {wallets && wallets.some((wallet) => wallet.isArchived) && (
            <Button
              variant={showArchived ? "default" : "secondary"}
              onClick={() => setShowArchived(!showArchived)}
            >
              {showArchived ? "Hide Archived" : "Show Archived"}
            </Button>
          )}
        </PageHeader>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {wallets && wallets.length === 0 && (
            <div className="col-span-3 text-center text-muted-foreground">
              No wallets,{" "}
              <Link href="/wallets/new-wallet">
                <b className="cursor-pointer text-white">create one</b>
              </Link>
              ?
            </div>
          )}
          {wallets &&
            wallets
              .filter((wallet) => showArchived || !wallet.isArchived)
              .sort((a, b) =>
                a.isArchived === b.isArchived
                  ? a.name.localeCompare(b.name)
                  : a.isArchived
                    ? 1
                    : -1,
              )
              .map((wallet) => (
                <CardWallet key={wallet.id} wallet={wallet as Wallet} />
              ))}
        </div>
      </>
    </>
  );
}

function CardWallet({ wallet }: { wallet: Wallet }) {
  const { transactions: pendingTransactions } = usePendingTransactions({
    walletId: wallet.id,
  });

  return (
    <Link href={`/wallets/${wallet.id}`}>
      <CardUI
        title={`${wallet.name} ${wallet.isArchived && "(Archived)"}`}
        description={wallet.description}
        cardClassName=""
      >
        <RowLabelInfo
          label="Address"
          value={getFirstAndLast(wallet.address)}
          copyString={wallet.address}
        />
        <RowLabelInfo
          label="DRep ID"
          value={getFirstAndLast(wallet.dRepId)}
          copyString={wallet.dRepId}
        />
        {pendingTransactions && pendingTransactions.length > 0 && (
          <RowLabelInfo
            label="Pending Transactions"
            value={pendingTransactions.length}
          />
        )}
      </CardUI>
    </Link>
  );
}
