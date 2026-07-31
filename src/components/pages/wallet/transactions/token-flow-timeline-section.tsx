import { useMemo } from "react";

import type { Wallet } from "@/types/wallet";
import useAllTransactions from "@/hooks/useAllTransactions";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { FlowSection } from "@/components/common/token-flow/token-flow-section";
import TokenFlowTimeline from "@/components/common/token-flow/timeline";
import { timelineTxsFromOnChain } from "@/utils/token-flow";

/**
 * Collapsed-by-default "Token Flow Timeline" section: the wallet's on-chain
 * transaction list merged into one chronological flow graph. The timeline
 * (and its Blockfrost fetches) mounts only on first expansion.
 */
export default function TokenFlowTimelineSection({
  appWallet,
}: {
  appWallet: Wallet;
}) {
  const walletTransactions = useWalletsStore(
    (state) => state.walletTransactions,
  )[appWallet.id];
  const { transactions: dbTransactions } = useAllTransactions({
    walletId: appWallet.id,
  });

  const timelineTxs = useMemo(() => {
    if (!walletTransactions) return [];
    const descriptions = new Map<string, string | null>(
      (dbTransactions ?? [])
        .filter((tx) => tx.txHash)
        .map((tx) => [tx.txHash!, tx.description]),
    );
    return timelineTxsFromOnChain(walletTransactions, descriptions);
  }, [walletTransactions, dbTransactions]);

  // Nothing to visualize: hide the section entirely rather than showing an
  // empty collapsed shell.
  if (timelineTxs.length === 0) return null;

  return (
    <FlowSection label="Token Flow Timeline" toggleTestId="tx-flow-timeline-toggle">
      <TokenFlowTimeline txs={timelineTxs} appWallet={appWallet} />
    </FlowSection>
  );
}
