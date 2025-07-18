import { useState } from "react";

import Link from "next/link";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import useUserWallets from "@/hooks/useUserWallets";
import { Wallet } from "@/types/wallet";
import { getFirstAndLast } from "@/utils/strings";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";

import { Button } from "@/components/ui/button";
import PageHeader from "@/components/common/page-header";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import SectionTitle from "@/components/common/section-title";


export default function PageWallets() {
  const { wallets } = useUserWallets();
  const [showArchived, setShowArchived] = useState(false);
  const userAddress = useUserStore((state) => state.userAddress);

  const { data: newPendingWallets } = api.wallet.getUserNewWallets.useQuery(
    { address: userAddress! },
    {
      enabled: userAddress !== undefined,
    },
  );

  const { data: getUserNewWalletsNotOwner } =
    api.wallet.getUserNewWalletsNotOwner.useQuery(
      { address: userAddress! },
      {
        enabled: userAddress !== undefined,
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <>
        <PageHeader pageTitle="Wallets">
          <Button size="sm" asChild>
            <Link href="/wallets/new-wallet-flow/save">New Wallet</Link>
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
              <Link href="/wallets/new-wallet-flow/save">
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

        {newPendingWallets && newPendingWallets.length > 0 && (
          <>
            <SectionTitle>New Wallets to be created</SectionTitle>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {newPendingWallets
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((wallet) => (
                  <CardWalletInvite
                    key={wallet.id}
                    wallet={wallet}
                    viewOnly={false}
                  />
                ))}
            </div>
          </>
        )}

        {getUserNewWalletsNotOwner && getUserNewWalletsNotOwner.length > 0 && (
          <>
            <SectionTitle>
              New Wallets awaiting creation
            </SectionTitle>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {getUserNewWalletsNotOwner
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((wallet) => (
                  <CardWalletInvite key={wallet.id} wallet={wallet} />
                ))}
            </div>
          </>
        )}
      </>
    </div>
  );
}

function CardWallet({ wallet }: { wallet: Wallet }) {
  const { transactions: pendingTransactions } = usePendingTransactions({
    walletId: wallet.id,
  });

  return (
    <Link href={`/wallets/${wallet.id}`}>
      <CardUI
        title={`${wallet.name}${wallet.isArchived ? " (Archived)" : ""}`}
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

function CardWalletInvite({
  wallet,
  viewOnly = true,
}: {
  wallet: {
    id: string;
    name: string;
    description: string | null;
    signersAddresses: string[];
  };
  viewOnly?: boolean;
}) {
  return (
    <Link
      href={
        viewOnly
          ? `/wallets/invite/${wallet.id}`
          : `/wallets/new-wallet-flow/create/${wallet.id}`
      }
    >
      <CardUI
        title={`${wallet.name}`}
        description={wallet.description}
        cardClassName=""
      >
        <RowLabelInfo
          label="Number of signers"
          value={wallet.signersAddresses.length}
        />
      </CardUI>
    </Link>
  );
}
