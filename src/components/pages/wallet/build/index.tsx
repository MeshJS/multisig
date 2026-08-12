import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import type { UTxO } from "@meshsdk/core";
import type { Transaction } from "@prisma/client";
import { FilePenLine, Hammer, Loader2, X } from "lucide-react";

import type { BuilderCanvasProps } from "./builder-canvas";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import SectionTitle from "@/components/ui/section-title";
import useAddressLabels from "@/hooks/useAddressLabels";
import useAppWallet from "@/hooks/useAppWallet";
import useAvailableUtxos from "@/hooks/useAvailableUtxos";
import useTransaction from "@/hooks/useTransaction";
import { useToast } from "@/hooks/use-toast";
import { utxoFunds } from "@/lib/tx-draft/assets";
import { isDraftCompatible, txJsonToDraft } from "@/lib/tx-draft/from-tx-json";
import { applyDraftToTxBuilder } from "@/lib/tx-draft/to-tx-builder";
import { validateDraft } from "@/lib/tx-draft/validate";
import { useSiteStore } from "@/lib/zustand/site";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { api } from "@/utils/api";
import { deriveBlockedUtxoRefs } from "@/utils/blockedUtxoRefs";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { extractTxMetadataMessage } from "@/utils/txCborMetadata";
import { resolveExpectedPaymentScriptCbor } from "@/utils/txSignUtils";
import Inspector from "./inspector";
import LoadPendingDialog from "./load-pending-dialog";
import ProblemsPanel from "./problems-panel";
import ReplaceConfirmDialog from "./replace-confirm-dialog";

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
 *
 * Pending simple-send transactions can be loaded for editing (via the "Load
 * pending" picker or `?tx=<id>` from the transactions page). Since editing
 * changes the transaction body, building then atomically replaces the
 * original — discarding any collected signatures after explicit confirmation.
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
  const apiUtils = api.useUtils();

  const draft = useTxBuilderStore((state) => state.draft);
  const storeWalletId = useTxBuilderStore((state) => state.walletId);
  const resetDraft = useTxBuilderStore((state) => state.resetDraft);
  const loadDraft = useTxBuilderStore((state) => state.loadDraft);
  const editingTxId = useTxBuilderStore((state) => state.editingTxId);
  const cancelEditing = useTxBuilderStore((state) => state.cancelEditing);
  const touched = useTxBuilderStore((state) => state.touched);

  const [building, setBuilding] = useState(false);
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  /** Selected for loading while the current draft still has unsaved work. */
  const [pendingLoad, setPendingLoad] = useState<Transaction | null>(null);
  /** Tx ids already auto-loaded from the URL; blocks re-loading loops. */
  const urlLoadedRef = useRef<string | null>(null);

  // One draft per wallet: entering the builder for a different wallet than
  // the draft was started for begins a fresh draft.
  useEffect(() => {
    if (appWallet && storeWalletId !== appWallet.id) resetDraft(appWallet.id);
  }, [appWallet, storeWalletId, resetDraft]);

  const utxos = useMemo(
    () => (appWallet ? (walletsUtxos[appWallet.id] ?? []) : []),
    [appWallet, walletsUtxos],
  );
  const utxosReady = appWallet
    ? walletsUtxos[appWallet.id] !== undefined
    : false;
  // While editing, the edited tx's own inputs are spendable for the rebuild.
  const { availableUtxos } = useAvailableUtxos({
    walletId: appWallet?.id,
    utxos,
    excludeTransactionId: editingTxId,
  });

  const { data: pendingTransactions } =
    api.transaction.getPendingTransactions.useQuery(
      { walletId: appWallet?.id ?? "" },
      { enabled: !!appWallet?.id },
    );
  const editingTx = useMemo(
    () =>
      editingTxId
        ? pendingTransactions?.find((tx) => tx.id === editingTxId)
        : undefined,
    [editingTxId, pendingTransactions],
  );
  const requiredCount = useMemo(() => {
    if (!appWallet) return 0;
    if (appWallet.type === "all") return appWallet.signersAddresses.length;
    if (appWallet.type === "any") return 1;
    return appWallet.numRequiredSigners ?? appWallet.signersAddresses.length;
  }, [appWallet]);

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

  function setTxQueryParam(txId: string | undefined) {
    const { tx: _tx, ...rest } = router.query;
    void router.replace(
      { query: txId ? { ...rest, tx: txId } : rest },
      undefined,
      { shallow: true },
    );
  }

  /** Hydrates the builder from a pending transaction row. */
  function loadPendingTx(transaction: Transaction) {
    if (!appWallet) return;
    let body: unknown = null;
    try {
      body = JSON.parse(transaction.txJson);
    } catch {
      body = null;
    }
    const compat = body
      ? isDraftCompatible(body)
      : { compatible: false, reasons: ["Unreadable transaction"] };
    if (!compat.compatible) {
      toast({
        title: "Can't edit this transaction",
        description: compat.reasons[0],
        duration: 8000,
        variant: "destructive",
      });
      setTxQueryParam(undefined);
      return;
    }

    const { draft: loaded, inputRefs } = txJsonToDraft(body, {
      walletAddress: appWallet.address,
      description: transaction.description,
      metadataMessage: extractTxMetadataMessage(transaction.txCbor),
    });

    // Restore the original inputs as manual picks when they're all still
    // spendable (ignoring the locks held by the tx being edited itself);
    // otherwise fall back to automatic selection at build time.
    const blocked = deriveBlockedUtxoRefs(
      pendingTransactions ?? [],
      transaction.id,
    );
    const spendable = utxos.filter(
      (utxo) =>
        !blocked.some(
          (ref) =>
            ref.hash === utxo.input.txHash &&
            ref.index === utxo.input.outputIndex,
        ),
    );
    const matchedUtxos = inputRefs.map((ref) =>
      spendable.find(
        (utxo) =>
          utxo.input.txHash === ref.txHash &&
          utxo.input.outputIndex === ref.txIndex,
      ),
    );
    const allInputsFound =
      matchedUtxos.length > 0 && matchedUtxos.every(Boolean);
    const hydrated = allInputsFound
      ? {
          ...loaded,
          utxoSelection: {
            mode: "manual" as const,
            utxos: matchedUtxos as UTxO[],
          },
        }
      : loaded;
    if (!allInputsFound && utxosReady) {
      toast({
        title: "Inputs will be re-selected",
        description:
          "Some of the original inputs are unavailable — suitable UTxOs will be selected automatically when building.",
        duration: 6000,
      });
    }

    loadDraft({
      walletId: appWallet.id,
      draft: hydrated,
      editingTxId: transaction.id,
    });
    setTxQueryParam(transaction.id);
  }

  /** Loads directly, or asks first when the current draft has unsaved work. */
  function requestLoadPendingTx(transaction: Transaction) {
    setLoadDialogOpen(false);
    const draftIsDirty =
      draft.outputs.length > 0 && editingTxId !== transaction.id;
    if (draftIsDirty) {
      setPendingLoad(transaction);
    } else {
      loadPendingTx(transaction);
    }
  }

  // `?tx=<id>` deep link from the transactions page. Runs once per tx id,
  // after the wallet-change reset above and once pending txs and UTxOs are
  // known (UTxOs so the original inputs can be restored as manual picks;
  // the wallet data loader always sets the entry, [] on failure).
  const urlTxId = typeof router.query.tx === "string" ? router.query.tx : null;
  useEffect(() => {
    if (
      !router.isReady ||
      !appWallet ||
      !pendingTransactions ||
      !utxosReady ||
      !urlTxId
    )
      return;
    if (urlLoadedRef.current === urlTxId || editingTxId === urlTxId) return;
    urlLoadedRef.current = urlTxId;
    const transaction = pendingTransactions.find((tx) => tx.id === urlTxId);
    if (!transaction) {
      toast({
        title: "Pending transaction not found",
        description: "It may have been submitted or deleted.",
        duration: 8000,
        variant: "destructive",
      });
      setTxQueryParam(undefined);
      return;
    }
    requestLoadPendingTx(transaction);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, appWallet, pendingTransactions, urlTxId, editingTxId]);

  async function buildAndPropose(replaces?: {
    transactionId: string;
    knownSignedCount: number;
  }) {
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
        replaces,
        toastMessage: replaces
          ? "The pending transaction has been replaced — signers have been notified"
          : undefined,
      });
      setReplaceConfirmOpen(false);
      resetDraft(appWallet.id);
      void router.push(`/wallets/${appWallet.id}/transactions`);
    } catch (error) {
      console.error("buildAndPropose", error);
      const code = (error as { data?: { code?: string } })?.data?.code;
      if (replaces && (code === "CONFLICT" || code === "NOT_FOUND")) {
        setReplaceConfirmOpen(false);
        toast({
          title: "Transaction changed while editing",
          description:
            error instanceof Error
              ? error.message
              : "The pending transaction changed while you were editing. Review it and try again.",
          duration: 10000,
          variant: "destructive",
        });
        // Refresh so the banner shows the latest signature count (or that
        // the transaction no longer exists). The draft is kept.
        void apiUtils.transaction.getPendingTransactions.invalidate({
          walletId: appWallet.id,
        });
      } else {
        toast({
          title: "Error",
          description: `${error}`,
          duration: 10000,
          variant: "destructive",
        });
      }
    } finally {
      setBuilding(false);
    }
  }

  function onBuildClick() {
    if (editingTxId && editingTx) {
      setReplaceConfirmOpen(true);
      return;
    }
    if (editingTxId && !editingTx) {
      // The edited tx vanished (submitted or deleted elsewhere): build as a
      // plain new transaction.
      cancelEditing();
      setTxQueryParam(undefined);
    }
    void buildAndPropose();
  }

  function onCancelEditing() {
    cancelEditing();
    setTxQueryParam(undefined);
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
        <div className="flex items-center gap-2">
          {(pendingTransactions?.length ?? 0) > 0 && (
            <Button
              variant="outline"
              data-testid="tx-builder-load-pending"
              onClick={() => setLoadDialogOpen(true)}
              disabled={building}
            >
              <FilePenLine className="mr-2 h-4 w-4" />
              Edit pending
            </Button>
          )}
          <Button
            data-testid="tx-builder-build"
            onClick={onBuildClick}
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
      </div>
      {editingTxId && (
        <div
          data-testid="tx-builder-editing-banner"
          className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm ${
            editingTx
              ? "border-amber-500/50 bg-amber-500/10"
              : "border-destructive/50 bg-destructive/10"
          }`}
        >
          <span>
            {editingTx ? (
              <>
                Editing pending transaction
                {editingTx.description ? (
                  <span className="font-medium">
                    {" "}
                    &ldquo;{editingTx.description}&rdquo;
                  </span>
                ) : null}
                . Building will replace it
                {editingTx.signedAddresses.length > 1
                  ? ` and discard its ${editingTx.signedAddresses.length} collected signatures`
                  : ""}
                .
              </>
            ) : (
              <>
                The transaction you were editing no longer exists &mdash; it
                was submitted or deleted. Building will create a new
                transaction.
              </>
            )}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={onCancelEditing}
            data-testid="tx-builder-cancel-editing"
          >
            <X className="mr-1 h-4 w-4" />
            Cancel editing
          </Button>
        </div>
      )}
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
      <LoadPendingDialog
        open={loadDialogOpen}
        onOpenChange={setLoadDialogOpen}
        pendingTransactions={pendingTransactions ?? []}
        requiredCount={requiredCount}
        onSelect={requestLoadPendingTx}
      />
      <ReplaceConfirmDialog
        open={replaceConfirmOpen}
        onOpenChange={setReplaceConfirmOpen}
        signedCount={editingTx?.signedAddresses.length ?? 0}
        requiredCount={requiredCount}
        description={editingTx?.description}
        busy={building}
        onConfirm={() =>
          void buildAndPropose(
            editingTx
              ? {
                  transactionId: editingTx.id,
                  knownSignedCount: editingTx.signedAddresses.length,
                }
              : undefined,
          )
        }
      />
      <Dialog
        open={pendingLoad !== null}
        onOpenChange={(open) => {
          if (!open) {
            setPendingLoad(null);
            setTxQueryParam(undefined);
          }
        }}
      >
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Replace your current draft?</DialogTitle>
            <DialogDescription>
              Loading this pending transaction will discard the transaction
              you&apos;re currently composing.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setPendingLoad(null);
                setTxQueryParam(undefined);
              }}
            >
              Keep my draft
            </Button>
            <Button
              onClick={() => {
                if (pendingLoad) loadPendingTx(pendingLoad);
                setPendingLoad(null);
              }}
              data-testid="tx-builder-discard-draft"
            >
              Load transaction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
