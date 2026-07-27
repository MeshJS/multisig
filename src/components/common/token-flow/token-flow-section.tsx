import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, RotateCcw } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import useAddressLabels from "@/hooks/useAddressLabels";
import { useResolvedInputs, useTxFlowData } from "@/hooks/useTxFlowData";
import { useWalletsStore } from "@/lib/zustand/wallets";
import type { Wallet } from "@/types/wallet";
import {
  onChainTxToTokenFlow,
  pendingTxToTokenFlow,
} from "@/utils/token-flow";
import TokenFlowViz from "./index";

export type TokenFlowSource =
  | { type: "onchain"; txHash: string; description?: string | null }
  | { type: "pending"; txId: string; txJson: any; description?: string | null };

/**
 * Fetches (lazily) and renders the token flow for one transaction. Mount
 * this only when the flow should actually be shown — mounting triggers the
 * Blockfrost fetches. `TokenFlowSection` below adds the collapsible chrome
 * used on cards; table rows with their own toggle render this directly.
 */
export function TokenFlowContent({
  source,
  appWallet,
  testIdSuffix = "",
}: {
  source: TokenFlowSource;
  appWallet?: Wallet;
  /** Disambiguates testids when several surfaces render the same tx. */
  testIdSuffix?: string;
}) {
  const { labelAddress } = useAddressLabels(appWallet);
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );

  const onChainQuery = useTxFlowData(
    source.type === "onchain" ? source.txHash : undefined,
  );

  const unresolvedRefs = useMemo(() => {
    if (source.type !== "pending" || !Array.isArray(source.txJson?.inputs))
      return [];
    return source.txJson.inputs
      .filter((input: any) => input?.txIn && !(input.txIn.address && input.txIn.amount))
      .map((input: any) => ({
        txHash: input.txIn.txHash as string,
        txIndex: input.txIn.txIndex as number,
      }));
  }, [source]);
  const { resolvedInputs, isLoading: resolvingInputs } = useResolvedInputs(
    unresolvedRefs,
    { enabled: source.type === "pending" && unresolvedRefs.length > 0 },
  );

  const flow = useMemo(() => {
    if (source.type === "pending") {
      return pendingTxToTokenFlow(source.txJson, {
        labelAddress,
        txId: source.txId,
        description: source.description,
        resolvedInputs,
      });
    }
    if (!onChainQuery.data) return null;
    return onChainTxToTokenFlow(onChainQuery.data, {
      labelAddress,
      description: source.description ?? undefined,
    });
  }, [source, labelAddress, resolvedInputs, onChainQuery.data]);

  const txKey = source.type === "onchain" ? source.txHash : source.txId;

  if (source.type === "onchain" && onChainQuery.isError) {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground">
        <span>Could not load transaction flow.</span>
        <button
          type="button"
          onClick={() => void onChainQuery.refetch()}
          className="flex items-center gap-1 font-medium text-foreground hover:underline"
        >
          <RotateCcw className="h-3 w-3" /> Retry
        </button>
      </div>
    );
  }

  if (!flow || (source.type === "pending" && resolvingInputs)) {
    return (
      <div className="h-72 w-full animate-pulse rounded-lg border border-border/50 bg-muted/30 sm:h-80" />
    );
  }

  return (
    <TokenFlowViz
      flow={flow}
      walletAssetMetadata={walletAssetMetadata}
      data-testid={`tx-flow-canvas-${txKey}${testIdSuffix}`}
    />
  );
}

/**
 * Collapsible "Token Flow" section following the transactions-page house
 * pattern. Content (and its Blockfrost fetches + the React Flow chunk)
 * mounts only after the first expansion.
 */
export default function TokenFlowSection({
  source,
  appWallet,
  testIdSuffix = "",
}: {
  source: TokenFlowSource;
  appWallet?: Wallet;
  /** Disambiguates testids when several surfaces render the same tx. */
  testIdSuffix?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);

  // A pending tx whose txJson failed to parse has nothing to visualize.
  if (source.type === "pending" && !source.txJson) return null;

  const txKey = source.type === "onchain" ? source.txHash : source.txId;

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) setHasOpened(true);
      }}
    >
      <CollapsibleTrigger
        data-testid={`tx-flow-toggle-${txKey}${testIdSuffix}`}
        className="group flex w-full items-center justify-between rounded-lg border border-border/50 bg-muted/30 p-3 transition-colors hover:bg-muted/50"
      >
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Token Flow
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground transition-transform" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        {hasOpened && (
          <TokenFlowContent
            source={source}
            appWallet={appWallet}
            testIdSuffix={testIdSuffix}
          />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
