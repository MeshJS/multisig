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
import GlobePageWrapper from "@/components/pages/homepage/wallets/new-wallet-flow/shared/GlobePageWrapper";


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
    <GlobePageWrapper>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 md:gap-8">
      <PageHeader pageTitle="Wallets">
        <Button size="sm" asChild>
          <Link href="/wallets/new-wallet-flow/save">New Wallet</Link>
        </Button>
      </PageHeader>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {(() => {
          const activeWallets = wallets
            ? wallets.filter((wallet) => !wallet.isArchived)
            : [];

          if (activeWallets.length === 0) {
            return (
              <div className="backdrop-blur-[10px] backdrop-saturate-150 bg-white/80 dark:bg-gray-900/50 border border-gray-200/20 dark:border-white/10 rounded-xl p-6">
                <h3 className="text-xl font-medium text-foreground mb-4">
                  No active wallet yet
                </h3>
                <p className="text-muted-foreground mb-6">
                  Add and create a wallet to get started.
                </p>
                <Button asChild>
                  <Link href="/wallets/new-wallet-flow/save">
                    Add wallet
                  </Link>
                </Button>
              </div>
            );
          }

          return activeWallets
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((wallet) => (
              <CardWallet key={wallet.id} wallet={wallet as Wallet} />
            ));
        })()}
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

        {wallets && wallets.some((wallet) => wallet.isArchived) && !showArchived && (
          <div className="flex justify-start">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowArchived(true)}
            >
              Show Archived
            </Button>
          </div>
        )}

        {showArchived && wallets && wallets.some((wallet) => wallet.isArchived) && (
          <>
            <div className="flex items-center gap-4">
              <SectionTitle>Archived Wallets</SectionTitle>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowArchived(false)}
              >
                Hide
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {wallets
                .filter((wallet) => wallet.isArchived)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((wallet) => (
                  <CardWallet key={wallet.id} wallet={wallet as Wallet} />
                ))}
            </div>
          </>
        )}
      </div>
    </GlobePageWrapper>
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
