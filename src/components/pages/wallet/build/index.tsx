import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import { Hammer, Loader2 } from "lucide-react";

import type { BuilderCanvasProps } from "./builder-canvas";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import SectionTitle from "@/components/ui/section-title";
import useAddressLabels from "@/hooks/useAddressLabels";
import useAppWallet from "@/hooks/useAppWallet";
import useAvailableUtxos from "@/hooks/useAvailableUtxos";
import useTransaction from "@/hooks/useTransaction";
import { useToast } from "@/hooks/use-toast";
import { utxoFunds } from "@/lib/tx-draft/assets";
import { applyDraftToTxBuilder } from "@/lib/tx-draft/to-tx-builder";
import { validateDraft } from "@/lib/tx-draft/validate";
import { useSiteStore } from "@/lib/zustand/site";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { api } from "@/utils/api";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { resolveExpectedPaymentScriptCbor } from "@/utils/txSignUtils";
import Inspector from "./inspector";
import ProblemsPanel from "./problems-panel";

const BuilderCanvas = dynamic<BuilderCanvasProps>(
  () => import("./builder-canvas"),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full animate-pulse rounded-lg border border-border/50 bg-muted/30" />
    ),
  },
);

/**
 * Canvas transaction builder: compose a multisig transaction by creating
 * recipient cards and connecting them to the transaction card, then propose
 * it through the standard multisig flow. V1 covers sends; certificates,
 * votes and other actions plug into the TxDraft model later.
 */
export default function PageBuild() {
  const router = useRouter();
  const { toast } = useToast();
  const { appWallet } = useAppWallet();
  const network = useSiteStore((state) => state.network);
  const walletAssetMetadata = useWalletsStore(
    (state) => state.walletAssetMetadata,
  );
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const { labelAddress } = useAddressLabels(appWallet);
  const { newTransaction } = useTransaction();

  const draft = useTxBuilderStore((state) => state.draft);
  const storeWalletId = useTxBuilderStore((state) => state.walletId);
  const resetDraft = useTxBuilderStore((state) => state.resetDraft);
  const touched = useTxBuilderStore((state) => state.touched);

  const [building, setBuilding] = useState(false);

  // One draft per wallet: entering the builder for a different wallet than
  // the draft was started for begins a fresh draft.
  useEffect(() => {
    if (appWallet && storeWalletId !== appWallet.id) resetDraft(appWallet.id);
  }, [appWallet, storeWalletId, resetDraft]);

  const utxos = useMemo(
    () => (appWallet ? (walletsUtxos[appWallet.id] ?? []) : []),
    [appWallet, walletsUtxos],
  );
  const { availableUtxos } = useAvailableUtxos({
    walletId: appWallet?.id,
    utxos,
  });

  const { data: contacts } = api.contact.getAll.useQuery(
    { walletId: appWallet?.id ?? "" },
    { enabled: !!appWallet?.id },
  );
  const contactEntries = useMemo(
    () =>
      (contacts ?? []).map((contact: { address: string; name: string }) => ({
        address: contact.address,
        label: contact.name,
      })),
    [contacts],
  );
  const signerEntries = useMemo(
    () =>
      (appWallet?.signersAddresses ?? []).map((address, index) => ({
        address,
        label:
          appWallet?.signersDescriptions?.[index] || `Signer ${index + 1}`,
      })),
    [appWallet],
  );

  // Funds backing the sufficiency check: exact manual picks, or everything
  // spendable in auto mode. Undefined while UTxOs are still loading so the
  // check doesn't produce a false "insufficient funds".
  const selectedFunds = useMemo(() => {
    if (draft.utxoSelection.mode === "manual") {
      return utxoFunds(draft.utxoSelection.utxos);
    }
    return availableUtxos.length > 0 ? utxoFunds(availableUtxos) : undefined;
  }, [draft.utxoSelection, availableUtxos]);

  const issues = useMemo(
    () => validateDraft(draft, { network, selectedFunds }),
    [draft, network, selectedFunds],
  );
  const errors = issues.filter((issue) => issue.level === "error");

  // A freshly added card legitimately has no address/amount yet — hold those
  // two errors back until the user has edited the card or moved away from it.
  // The Build button still gates on the unfiltered list above.
  const visibleIssues = useMemo(
    () =>
      issues.filter(
        (issue) =>
          !issue.outputId ||
          touched[issue.outputId] ||
          (issue.code !== "missing-address" && issue.code !== "no-amount"),
      ),
    [issues, touched],
  );

  async function buildAndPropose() {
    if (!appWallet?.scriptCbor || errors.length > 0) return;
    setBuilding(true);
    try {
      const txBuilder = await getTxBuilder(network);
      // Prefer the script whose hash matches the wallet address — for
      // imported/legacy wallets the stored scriptCbor can be a differently
      // encoded variant, which the node rejects (MissingScriptWitnessesUTXOW)
      // until submitTxWithScriptRecovery swaps it at submit time.
      applyDraftToTxBuilder(txBuilder, draft, {
        scriptCbor:
          resolveExpectedPaymentScriptCbor(appWallet, network) ??
          appWallet.scriptCbor,
        walletAddress: appWallet.address,
        availableUtxos,
      });
      await newTransaction({
        txBuilder,
        description: draft.description || undefined,
        metadataValue:
          draft.metadata.length > 0
            ? { label: "674", value: draft.metadata }
            : undefined,
      });
      resetDraft(appWallet.id);
      void router.push(`/wallets/${appWallet.id}/transactions`);
    } catch (error) {
      console.error("buildAndPropose", error);
      toast({
        title: "Error",
        description: `${error}`,
        duration: 10000,
        variant: "destructive",
      });
    } finally {
      setBuilding(false);
    }
  }

  if (appWallet === undefined) return <WalletDetailSkeleton />;

  return (
    <main className="flex h-[calc(100vh-4rem)] flex-1 flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <SectionTitle>Transaction Builder</SectionTitle>
            <Badge
              variant="outline"
              className="text-xs"
              data-testid="tx-builder-new-badge"
            >
              New
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            The visual builder is a new feature with limited transaction-type
            support &mdash; more transaction types will be added over time.
          </p>
        </div>
        <Button
          data-testid="tx-builder-build"
          onClick={() => void buildAndPropose()}
          disabled={building || errors.length > 0}
          title={errors[0]?.message}
        >
          {building ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Hammer className="mr-2 h-4 w-4" />
          )}
          Build &amp; propose
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
        <div className="relative min-h-[320px] min-w-0 flex-1">
          <BuilderCanvas
            walletAddress={appWallet.address}
            labelAddress={labelAddress}
            walletAssetMetadata={walletAssetMetadata}
            contacts={contactEntries}
            signers={signerEntries}
          />
          <ProblemsPanel issues={visibleIssues} />
        </div>
        <aside className="w-full shrink-0 overflow-y-auto lg:w-[380px]">
          <Inspector appWallet={appWallet} issues={visibleIssues} />
        </aside>
      </div>
    </main>
  );
}
