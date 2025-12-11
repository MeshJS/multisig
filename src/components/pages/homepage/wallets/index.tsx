import { useState, useMemo } from "react";

import Link from "next/link";
import usePendingTransactions from "@/hooks/usePendingTransactions";
import useUserWallets from "@/hooks/useUserWallets";
import useWalletBalances from "@/hooks/useWalletBalances";
import { Wallet } from "@/types/wallet";
import { getFirstAndLast } from "@/utils/strings";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { buildMultisigWallet } from "@/utils/common";
import { addressToNetwork } from "@/utils/multisigSDK";

import { Button } from "@/components/ui/button";
import PageHeader from "@/components/common/page-header";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import SectionTitle from "@/components/common/section-title";
import WalletBalance from "./WalletBalance";
import EmptyWalletsState from "./EmptyWalletsState";
import SectionExplanation from "./SectionExplanation";


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

  // Filter wallets for balance fetching (only non-archived or all if showing archived)
  const walletsForBalance = wallets?.filter(
    (wallet) => showArchived || !wallet.isArchived,
  ) as Wallet[] | undefined;

  // Fetch balances with rate limiting
  const { balances, loadingStates } = useWalletBalances(walletsForBalance);

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
          {wallets && wallets.length === 0 && <EmptyWalletsState />}
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
              .map((wallet) => {
                const walletBalance = balances[wallet.id] ?? null;
                const walletLoadingState = loadingStates[wallet.id] ?? "idle";
                // Debug log
                if (process.env.NODE_ENV === "development") {
                  console.log(`Wallet ${wallet.id}: balance=${walletBalance}, loadingState=${walletLoadingState}`);
                }
                return (
                  <CardWallet
                    key={wallet.id}
                    wallet={wallet as Wallet}
                    balance={walletBalance}
                    loadingState={walletLoadingState}
                  />
                );
              })}
        </div>

        {newPendingWallets && newPendingWallets.length > 0 && (
          <>
            <SectionTitle>New Wallets to be created</SectionTitle>
            <SectionExplanation
              description="These are wallets you have initiated but not yet created on-chain. Complete the wallet creation process to deploy them."
            />
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
            <SectionExplanation
              description="These are wallets you have been invited to join as a signer. You can view details and accept or decline the invitation."
            />
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

function CardWallet({
  wallet,
  balance,
  loadingState,
}: {
  wallet: Wallet;
  balance: number | null;
  loadingState: "idle" | "loading" | "loaded" | "error";
}) {
  const network = useSiteStore((state) => state.network);
  const { transactions: pendingTransactions } = usePendingTransactions({
    walletId: wallet.id,
  });

  // Rebuild the multisig wallet to get the correct canonical address for display
  // This ensures we show the correct address even if wallet.address was built incorrectly
  const displayAddress = useMemo(() => {
    try {
      const walletNetwork = wallet.signersAddresses.length > 0 
        ? addressToNetwork(wallet.signersAddresses[0]!)
        : network;
      const mWallet = buildMultisigWallet(wallet, walletNetwork);
      if (mWallet) {
        return mWallet.getScript().address;
      }
    } catch (error) {
      console.error(`Error building wallet for display: ${wallet.id}`, error);
    }
    // Fallback to wallet.address if rebuild fails (legacy support)
    return wallet.address;
  }, [wallet, network]);

  return (
    <Link href={`/wallets/${wallet.id}`}>
      <CardUI
        title={`${wallet.name}${wallet.isArchived ? " (Archived)" : ""}`}
        description={wallet.description}
        cardClassName=""
      >
        <WalletBalance balance={balance} loadingState={loadingState} />
        <RowLabelInfo
          label="Address"
          value={getFirstAndLast(displayAddress)}
          copyString={displayAddress}
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
