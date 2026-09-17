import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/router";
import type { UTxO } from "@meshsdk/core";
import type { Transaction } from "@prisma/client";
import type { Wallet } from "@/types/wallet";
import {
  FilePenLine,
  FlaskConical,
  Hammer,
  Loader2,
  Send,
  X,
} from "lucide-react";

import type { BuilderCanvasProps } from "./builder-canvas";
import LinkCardanoscan from "@/components/common/link-cardanoscan";
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
import useActiveWallet from "@/hooks/useActiveWallet";
import useAddressLabels from "@/hooks/useAddressLabels";
import { useAddressUtxos } from "@/hooks/useAddressUtxos";
import useAppWallet from "@/hooks/useAppWallet";
import useAvailableUtxos from "@/hooks/useAvailableUtxos";
import useSignAndSubmit from "@/hooks/useSignAndSubmit";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import usePoolNames from "@/hooks/usePoolNames";
import useProposalTitles from "@/hooks/useProposalTitles";
import useTransaction from "@/hooks/useTransaction";
import { useToast } from "@/hooks/use-toast";
import { completeTxWithFreshCostModels } from "@/lib/completeTxWithFreshCostModels";
import { deriveDrepVoteContext } from "@/lib/governance/drep-context";
import { deriveStakeCertContext } from "@/lib/staking/stake-context";
import {
  findBallotRowForVote,
  uploadRationale,
} from "@/lib/governance/rationale";
import {
  hasMultisigOnlyActions,
  sameSource,
  withVoteAnchor,
} from "@/lib/tx-draft/mutations";
import {
  describeSource,
  resolveSourceAddress,
  sourcePrimaryAction,
  withSourceLabel,
} from "@/lib/tx-draft/source";
import { utxoFunds } from "@/lib/tx-draft/assets";
import { buildDraftTx } from "@/lib/tx-draft/build-draft-tx";
import { isDraftCompatible, txJsonToDraft } from "@/lib/tx-draft/from-tx-json";
import {
  applyDraftToTxBuilder,
  type ApplyDraftContext,
} from "@/lib/tx-draft/to-tx-builder";
import { validateDraft, validateSource } from "@/lib/tx-draft/validate";
import type { DraftSource } from "@/types/tx-draft";
import { useSiteStore } from "@/lib/zustand/site";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { api } from "@/utils/api";
import { deriveBlockedUtxoRefs } from "@/utils/blockedUtxoRefs";
import { getFriendlyError } from "@/utils/errors";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { extractTxMetadataMessage } from "@/utils/txCborMetadata";
import { resolveExpectedPaymentScriptCbor } from "@/utils/txSignUtils";
import AddStakeDialog from "./add-stake-dialog";
import AddVoteDialog from "./add-vote-dialog";
import BuildResultPanel, { type BuildResultState } from "./build-result-panel";
import Inspector from "./inspector";
import LoadPendingDialog from "./load-pending-dialog";
import ProblemsPanel from "./problems-panel";
import ReplaceConfirmDialog from "./replace-confirm-dialog";
import SwitchSourceDialog from "./switch-source-dialog";

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
 * it through the standard multisig flow. Covers sends, staking actions
 * (register/delegate/deregister certificates, added via the palette), and
 * DRep governance votes — created here or loaded from a pending transaction
 * and edited. Reward withdrawals and vote-power delegation stay on the
 * staking/governance pages.
 *
 * Pending transactions can be loaded for editing (via the "Load pending"
 * picker or `?tx=<id>` from the transactions page). Since editing changes
 * the transaction body, building then atomically replaces the original —
 * discarding any collected signatures after explicit confirmation.
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
  const { activeWallet, userAddress, walletName } = useActiveWallet();
  const { signAndSubmit } = useSignAndSubmit();
  const { multisigWallet, isLoading: multisigWalletLoading } =
    useMultisigWallet();
  const apiUtils = api.useUtils();
  const updateProposalAnchor = api.ballot.updateProposalAnchor.useMutation();
  const updateProposalRationale =
    api.ballot.updateProposalRationale.useMutation();

  const draft = useTxBuilderStore((state) => state.draft);
  const storeWalletId = useTxBuilderStore((state) => state.walletId);
  const resetDraft = useTxBuilderStore((state) => state.resetDraft);
  const loadDraft = useTxBuilderStore((state) => state.loadDraft);
  const editingTxId = useTxBuilderStore((state) => state.editingTxId);
  const cancelEditing = useTxBuilderStore((state) => state.cancelEditing);
  const setSource = useTxBuilderStore((state) => state.setSource);
  const touched = useTxBuilderStore((state) => state.touched);

  const [building, setBuilding] = useState(false);
  /** A test build (no signing/proposing) is in flight. */
  const [testing, setTesting] = useState(false);
  /** A connected-wallet sign & submit is in flight. */
  const [signing, setSigning] = useState(false);
  /** Source switch awaiting confirmation (it would drop certs/votes). */
  const [pendingSource, setPendingSource] = useState<DraftSource | null>(null);
  /** Outcome of the last test build; cleared whenever the draft changes. */
  const [buildResult, setBuildResult] = useState<BuildResultState | null>(
    null,
  );
  const [loadDialogOpen, setLoadDialogOpen] = useState(false);
  const [replaceConfirmOpen, setReplaceConfirmOpen] = useState(false);
  const [stakeDialogOpen, setStakeDialogOpen] = useState(false);
  const [voteDialogOpen, setVoteDialogOpen] = useState(false);
  /** Selected for loading while the current draft still has unsaved work. */
  const [pendingLoad, setPendingLoad] = useState<Transaction | null>(null);
  /** Tx ids already auto-loaded from the URL; blocks re-loading loops. */
  const urlLoadedRef = useRef<string | null>(null);

  // One draft per wallet: entering the builder for a different wallet than
  // the draft was started for begins a fresh draft.
  useEffect(() => {
    if (appWallet && storeWalletId !== appWallet.id) resetDraft(appWallet.id);
  }, [appWallet, storeWalletId, resetDraft]);

  // The store replaces the draft object on every mutation, so any edit makes
  // a previous test build stale — drop it rather than show outdated numbers.
  useEffect(() => {
    setBuildResult(null);
  }, [draft]);

  const utxos = useMemo(
    () => (appWallet ? (walletsUtxos[appWallet.id] ?? []) : []),
    [appWallet, walletsUtxos],
  );
  const utxosReady = appWallet
    ? walletsUtxos[appWallet.id] !== undefined
    : false;
  // While editing, the edited tx's own inputs are spendable for the rebuild.
  const { availableUtxos: multisigAvailableUtxos } = useAvailableUtxos({
    walletId: appWallet?.id,
    utxos,
    excludeTransactionId: editingTxId,
  });

  // The funding source. Anything but the multisig is a plain key-based
  // wallet: its UTxOs come straight from Blockfrost (no pending-tx locks),
  // and only once the source address itself validates.
  const isMultisigSource = draft.source.kind === "multisig";
  const connectedAddress = userAddress || undefined;
  const sourceAddress = useMemo(
    () =>
      resolveSourceAddress(draft.source, {
        multisigAddress: appWallet?.address ?? "",
        connectedAddress,
      }),
    [draft.source, appWallet?.address, connectedAddress],
  );
  const sourceIssues = useMemo(
    () =>
      validateSource(draft, {
        network,
        multisigAddress: appWallet?.address,
        connectedAddress,
      }),
    [draft, network, appWallet?.address, connectedAddress],
  );
  const sourceReady =
    !isMultisigSource &&
    !!sourceAddress &&
    !sourceIssues.some((issue) => issue.level === "error");
  const sourceUtxos = useAddressUtxos(
    isMultisigSource ? undefined : sourceAddress,
    { enabled: sourceReady },
  );
  const availableUtxos = useMemo(
    () => (isMultisigSource ? multisigAvailableUtxos : (sourceUtxos.data ?? [])),
    [isMultisigSource, multisigAvailableUtxos, sourceUtxos.data],
  );

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
    if (isMultisigSource) {
      return multisigAvailableUtxos.length > 0
        ? utxoFunds(multisigAvailableUtxos)
        : undefined;
    }
    // A fetched empty list is a real "no funds"; undefined only while the
    // lookup hasn't succeeded (not started, loading, or errored).
    return sourceUtxos.data ? utxoFunds(sourceUtxos.data) : undefined;
  }, [
    draft.utxoSelection,
    isMultisigSource,
    multisigAvailableUtxos,
    sourceUtxos.data,
  ]);

  // DRep identity for re-emitting loaded votes; undefined while the wallet
  // query loads so validation doesn't flash a blocking error.
  const voteCtx = useMemo(
    () => deriveDrepVoteContext(multisigWallet, appWallet ?? undefined),
    [multisigWallet, appWallet],
  );
  const hasDrepContext =
    draft.votes.length === 0 || (multisigWalletLoading && !voteCtx)
      ? undefined
      : !!voteCtx;

  // Staking identity for re-emitting loaded certificates; same tri-state as
  // the DRep context above.
  const stakeCtx = useMemo(
    () => deriveStakeCertContext(multisigWallet, appWallet ?? undefined),
    [multisigWallet, appWallet],
  );
  const hasStakeContext =
    draft.certificates.length === 0 || (multisigWalletLoading && !stakeCtx)
      ? undefined
      : !!stakeCtx;

  // DRep registration status (loaded by the wallet data loader). undefined
  // means "loading OR unregistered" — usable only for a non-blocking notice,
  // never as a hard gate.
  const drepInfo = useWalletsStore((state) => state.drepInfo);

  // Palette add-button gating: identity context only. Registration state is
  // checked inside the dialogs, where it can inform instead of block.
  // Certificates and votes are witnessed by the multisig's scripts, so they
  // exist only for the multisig source.
  const externalSourceReason = isMultisigSource
    ? undefined
    : "Only available when the multisig wallet is the source";
  const addStakeDisabledReason =
    externalSourceReason ??
    (stakeCtx
      ? draft.certificates.length > 0
        ? "The draft already has a staking action"
        : undefined
      : multisigWalletLoading
        ? "Loading wallet…"
        : "This wallet has no staking identity");
  const addVoteDisabledReason =
    externalSourceReason ??
    (voteCtx
      ? undefined
      : multisigWalletLoading
        ? "Loading wallet…"
        : "This wallet has no DRep identity");

  // The source card reads as the source ("Connected wallet (…)" / "Source
  // address") while the multisig keeps its usual label as a recipient.
  const canvasLabelAddress = useMemo(
    () =>
      withSourceLabel(
        labelAddress,
        draft.source,
        sourceAddress,
        walletName || undefined,
      ),
    [labelAddress, draft.source, sourceAddress, walletName],
  );

  // Proposal titles for the vote badges on the canvas and in the inspector.
  const voteProposalIds = useMemo(
    () =>
      draft.votes.map(
        (vote) => `${vote.govActionTxHash}#${vote.govActionIndex}`,
      ),
    [draft.votes],
  );
  const { resolveProposalTitle } = useProposalTitles(
    appWallet?.id,
    voteProposalIds,
  );

  // Pool names for the delegation badge on the canvas tx card.
  const delegationPoolIds = useMemo(
    () =>
      draft.certificates.flatMap((cert) =>
        cert.kind === "DelegateStake" && cert.poolId ? [cert.poolId] : [],
      ),
    [draft.certificates],
  );
  const { resolvePoolName } = usePoolNames(delegationPoolIds);

  const issues = useMemo(
    () =>
      validateDraft(draft, {
        network,
        selectedFunds,
        hasDrepContext,
        hasStakeContext,
        multisigAddress: appWallet?.address,
        connectedAddress,
      }),
    [
      draft,
      network,
      selectedFunds,
      hasDrepContext,
      hasStakeContext,
      appWallet?.address,
      connectedAddress,
    ],
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
      (draft.outputs.length > 0 ||
        draft.votes.length > 0 ||
        draft.certificates.length > 0) &&
      editingTxId !== transaction.id;
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

  /**
   * Builder context shared by the test build, the proposal and the
   * connected-wallet sign path so they all build the very same transaction.
   * For the multisig it prefers the script whose hash matches the wallet
   * address — for imported/legacy wallets the stored scriptCbor can be a
   * differently encoded variant, which the node rejects
   * (MissingScriptWitnessesUTXOW) until submitTxWithScriptRecovery swaps it
   * at submit time. Any other source spends plain key-witnessed inputs.
   */
  function draftBuildContext(wallet: Wallet): ApplyDraftContext {
    if (!isMultisigSource) {
      return {
        inputs: { kind: "pubkey" },
        walletAddress: sourceAddress,
        availableUtxos,
      };
    }
    return {
      inputs: {
        kind: "script",
        scriptCbor:
          resolveExpectedPaymentScriptCbor(wallet, network) ??
          wallet.scriptCbor,
      },
      walletAddress: wallet.address,
      availableUtxos,
      // DRep identity for re-emitting loaded votes; validation has already
      // errored (vote-drep-missing) if the draft has votes without it.
      drepId: voteCtx?.dRepId,
      drepScriptCbor: voteCtx?.drepScriptCbor,
      // Staking identity for re-emitting loaded certificates; validation
      // has already errored (cert-stake-missing) when absent but needed.
      stakeRewardAddress: stakeCtx?.rewardAddress,
      stakeScriptCbor: stakeCtx?.stakeScriptCbor,
    };
  }

  /** Whether the current source can be built at all (address + witnesses). */
  function canBuildSource(): boolean {
    if (!appWallet || !sourceAddress || errors.length > 0) return false;
    return !isMultisigSource || !!appWallet.scriptCbor;
  }

  /**
   * Builds the draft exactly as the proposal would (fee, balancing, change,
   * metadata) but stops before signing: nothing is uploaded, signed or
   * saved. Edited vote rationales are NOT uploaded here — the vote builds
   * with its current anchor, which only differs from the eventual proposal
   * by the anchor bytes.
   */
  async function testBuild() {
    if (!appWallet || !canBuildSource()) return;
    setTesting(true);
    try {
      // Always a fresh builder: MeshTxBuilder is stateful and a completed
      // builder can't be built again.
      const txBuilder = await getTxBuilder(network);
      const result = await buildDraftTx(
        txBuilder,
        draft,
        draftBuildContext(appWallet),
        {
          metadataMessage: draft.metadata || undefined,
          complete: (builder) => completeTxWithFreshCostModels(builder, network),
        },
      );
      setBuildResult({
        status: "ok",
        result,
        description: draft.description,
      });
    } catch (error) {
      console.error("testBuild", error);
      setBuildResult({ status: "error", message: getFriendlyError(error) });
    } finally {
      setTesting(false);
    }
  }

  /**
   * Connected-wallet source: build, then let the wallet sign (fully) and
   * submit — the deposit-page pattern. Nothing is stored: this isn't a
   * multisig transaction. The draft resets but keeps its source so a user
   * can fire off several transactions from their own wallet.
   */
  async function buildAndSign() {
    if (!appWallet || draft.source.kind !== "connected" || !canBuildSource())
      return;
    setSigning(true);
    try {
      const txBuilder = await getTxBuilder(network);
      const result = await buildDraftTx(
        txBuilder,
        draft,
        draftBuildContext(appWallet),
        {
          metadataMessage: draft.metadata || undefined,
          complete: (builder) => completeTxWithFreshCostModels(builder, network),
        },
      );
      const { txHash } = await signAndSubmit(result.unsignedTx);
      toast({
        title: "Transaction submitted",
        description: (
          <span>
            Signed and submitted by your connected wallet.{" "}
            <LinkCardanoscan
              url={`transaction/${txHash}`}
              className="font-medium underline"
            >
              View on Cardanoscan
            </LinkCardanoscan>
          </span>
        ),
        duration: 12000,
      });
      const source = draft.source;
      resetDraft(appWallet.id);
      setSource(source);
    } catch (error) {
      console.error("buildAndSign", error);
      toast({
        title: "Couldn't sign and submit",
        description: getFriendlyError(error),
        duration: 10000,
        variant: "destructive",
      });
    } finally {
      setSigning(false);
    }
  }

  /**
   * Source switches go through here: ignored while editing a pending tx,
   * and confirmed first when leaving the multisig would drop certs/votes.
   */
  function requestSetSource(next: DraftSource) {
    if (editingTxId || sameSource(draft.source, next)) return;
    if (
      next.kind !== "multisig" &&
      isMultisigSource &&
      hasMultisigOnlyActions(draft)
    ) {
      setPendingSource(next);
      return;
    }
    setSource(next);
  }

  async function buildAndPropose(replaces?: {
    transactionId: string;
    knownSignedCount: number;
  }) {
    if (!appWallet?.scriptCbor || !isMultisigSource || errors.length > 0)
      return;
    setBuilding(true);
    try {
      // Resolve rationale edits into a LOCAL draft: edited rationales are
      // uploaded as fresh CIP-100 documents and their votes get the new
      // anchor; untouched votes keep their anchor byte-for-byte. The store
      // keeps the edits, so a failed build doesn't lose the user's text.
      const editedVotes = draft.votes.filter(
        (vote) => vote.rationaleEdit !== undefined,
      );
      let buildDraft = draft;
      const newAnchors = new Map<
        string,
        { anchorUrl: string; anchorDataHash: string } | undefined
      >();
      for (const vote of editedVotes) {
        const text = vote.rationaleEdit!.trim();
        const anchor = text ? await uploadRationale(text) : undefined;
        newAnchors.set(vote.id, anchor);
        buildDraft = withVoteAnchor(buildDraft, vote.id, anchor);
      }

      const txBuilder = await getTxBuilder(network);
      applyDraftToTxBuilder(
        txBuilder,
        buildDraft,
        draftBuildContext(appWallet),
      );
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
      // Best-effort ballot sync: the pending card resolves rationale text
      // from ballot rows first, so point the matching row (found via the
      // vote's OLD anchor, else the proposal id) at the new anchor + text.
      if (editedVotes.length > 0) {
        try {
          const ballots = await apiUtils.ballot.getByWallet.fetch({
            walletId: appWallet.id,
          });
          for (const vote of editedVotes) {
            const row = findBallotRowForVote(ballots ?? [], vote);
            if (!row) continue;
            const anchor = newAnchors.get(vote.id);
            await updateProposalAnchor.mutateAsync({
              ballotId: row.ballotId,
              index: row.index,
              anchorUrl: anchor?.anchorUrl,
              anchorHash: anchor?.anchorDataHash,
            });
            await updateProposalRationale.mutateAsync({
              ballotId: row.ballotId,
              index: row.index,
              rationaleComment: vote.rationaleEdit!.trim(),
            });
          }
          void apiUtils.ballot.getByWallet.invalidate({
            walletId: appWallet.id,
          });
        } catch (syncError) {
          // The transaction already carries the new rationale; only the
          // ballot's cached copy failed to refresh.
          console.warn("ballot rationale sync failed", syncError);
          toast({
            title: "Ballot note not updated",
            description:
              "The vote carries the new rationale, but the ballot's cached copy could not be refreshed.",
            duration: 6000,
          });
        }
      }
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

  const busy = building || testing || signing;
  const hasPendingRationaleEdits = draft.votes.some(
    (vote) => vote.rationaleEdit !== undefined,
  );
  const primaryAction = sourcePrimaryAction(draft.source);
  const sourceLabel = describeSource(draft.source, {
    walletName: walletName || undefined,
  });

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 md:p-6 lg:min-h-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 flex-col gap-1">
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
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          {(pendingTransactions?.length ?? 0) > 0 && (
            <Button
              variant="outline"
              data-testid="tx-builder-load-pending"
              onClick={() => setLoadDialogOpen(true)}
              disabled={busy}
            >
              <FilePenLine className="mr-2 h-4 w-4" />
              Edit pending
            </Button>
          )}
          <Button
            variant="outline"
            data-testid="tx-builder-test-build"
            onClick={() => void testBuild()}
            disabled={busy || errors.length > 0}
            title={
              errors[0]?.message ??
              "Build the transaction without proposing it, to check that it builds"
            }
          >
            {testing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FlaskConical className="mr-2 h-4 w-4" />
            )}
            Build
          </Button>
          {primaryAction === "propose" && (
            <Button
              data-testid="tx-builder-build"
              onClick={onBuildClick}
              disabled={busy || errors.length > 0}
              title={errors[0]?.message}
            >
              {building ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Hammer className="mr-2 h-4 w-4" />
              )}
              Build &amp; propose
            </Button>
          )}
          {primaryAction === "sign" && (
            <Button
              data-testid="tx-builder-sign"
              onClick={() => void buildAndSign()}
              disabled={busy || errors.length > 0 || !activeWallet}
              title={
                errors[0]?.message ??
                (activeWallet
                  ? "Build, then sign and submit with your connected wallet"
                  : "Connect a wallet to sign")
              }
            >
              {signing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Build &amp; sign
            </Button>
          )}
        </div>
      </div>
      {!isMultisigSource && (
        <div
          data-testid="tx-builder-source-banner"
          className="flex flex-col items-start gap-2 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
        >
          <span>
            Building from <span className="font-medium">{sourceLabel}</span>{" "}
            &mdash; this transaction can&apos;t be proposed to the multisig;{" "}
            {draft.source.kind === "connected"
              ? "it will be signed and submitted by your connected wallet."
              : "build it here and copy the unsigned CBOR to sign in that wallet."}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => requestSetSource({ kind: "multisig" })}
            data-testid="tx-builder-use-multisig"
          >
            Use multisig
          </Button>
        </div>
      )}
      {buildResult && (
        <BuildResultPanel
          result={buildResult}
          hasPendingRationaleEdits={hasPendingRationaleEdits}
          onDismiss={() => setBuildResult(null)}
        />
      )}
      {editingTxId && (
        <div
          data-testid="tx-builder-editing-banner"
          className={`flex flex-col items-start gap-2 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${
            editingTx
              ? "border-warning/50 bg-warning/10"
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
      <div className="flex flex-1 flex-col gap-4 lg:min-h-0 lg:flex-row">
        <div className="relative h-[60dvh] min-h-[320px] min-w-0 flex-1 lg:h-auto">
          <BuilderCanvas
            walletAddress={sourceAddress}
            multisigAddress={isMultisigSource ? undefined : appWallet.address}
            labelAddress={canvasLabelAddress}
            walletAssetMetadata={walletAssetMetadata}
            contacts={contactEntries}
            signers={signerEntries}
            resolveProposalTitle={resolveProposalTitle}
            resolvePoolName={resolvePoolName}
            onAddStakeAction={() => setStakeDialogOpen(true)}
            addStakeDisabledReason={addStakeDisabledReason}
            onAddVote={() => setVoteDialogOpen(true)}
            addVoteDisabledReason={addVoteDisabledReason}
            built={
              buildResult?.status === "ok" ? buildResult.result.body : null
            }
          />
          <ProblemsPanel issues={visibleIssues} />
        </div>
        <aside className="w-full shrink-0 overflow-y-auto lg:w-[380px]">
          <Inspector
            appWallet={appWallet}
            issues={visibleIssues}
            source={{
              sourceAddress,
              sourceName: isMultisigSource
                ? "Multisig"
                : draft.source.kind === "connected"
                  ? "Connected wallet"
                  : "Source address",
              sourceReady: isMultisigSource || sourceReady,
              utxoError:
                !isMultisigSource && sourceUtxos.isError
                  ? "Couldn't load the UTxOs of this address."
                  : undefined,
              onRetryUtxos: () => void sourceUtxos.refetch(),
              picker: {
                source: draft.source,
                sourceAddress,
                connected: {
                  available: !!connectedAddress,
                  name: walletName || undefined,
                },
                disabledReason: editingTxId
                  ? "Editing a pending transaction — the multisig is its source"
                  : undefined,
                onRequestSource: requestSetSource,
              },
            }}
          />
        </aside>
      </div>
      {stakeCtx && (
        <AddStakeDialog
          open={stakeDialogOpen}
          onOpenChange={setStakeDialogOpen}
          stakeAddress={stakeCtx.rewardAddress}
        />
      )}
      <AddVoteDialog
        open={voteDialogOpen}
        onOpenChange={setVoteDialogOpen}
        walletId={appWallet.id}
        existingProposalIds={voteProposalIds}
        drepRegistered={drepInfo?.active === true ? true : undefined}
      />
      <LoadPendingDialog
        open={loadDialogOpen}
        onOpenChange={setLoadDialogOpen}
        pendingTransactions={pendingTransactions ?? []}
        requiredCount={requiredCount}
        onSelect={requestLoadPendingTx}
      />
      <SwitchSourceDialog
        open={pendingSource !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSource(null);
        }}
        removedCount={draft.certificates.length + draft.votes.length}
        targetLabel={
          pendingSource
            ? describeSource(pendingSource, {
                walletName: walletName || undefined,
              })
            : ""
        }
        onConfirm={() => {
          if (pendingSource) setSource(pendingSource);
          setPendingSource(null);
        }}
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
