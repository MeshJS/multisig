import { create } from "zustand";

import type {
  BuilderSelection,
  DraftOutput,
  DraftUtxoSelection,
  DraftVoteKind,
  TxDraft,
} from "@/types/tx-draft";
import {
  addOutput,
  clearVoteAnchor,
  createDraft,
  removeOutput,
  removeVote,
  setDescription,
  setMetadata,
  setOutputAsset,
  setUtxoSelection,
  setVoteRationale,
  updateCertificatePool,
  updateOutput,
  updateVoteKind,
} from "@/lib/tx-draft/mutations";

/**
 * Shared state for the canvas transaction builder. The draft is the source of
 * truth; all mutations are thin wrappers over the pure functions in
 * `@/lib/tx-draft/mutations`. In-memory only — a fresh draft is created per
 * wallet (see `resetDraft`), nothing survives a reload.
 *
 * `positions` holds user-dragged card positions keyed by DRAFT ENTITY id
 * (output id, "tx", or bech32 address for input-side nodes) — not by React
 * Flow node id — so a placeholder card keeps its position when setting its
 * address changes the node id from `draftout:<id>` to `addr:<bech32>`.
 */
interface TxBuilderState {
  walletId?: string;
  draft: TxDraft;
  /**
   * Set when the draft was loaded from an existing pending transaction;
   * building then replaces that transaction instead of creating a new one.
   */
  editingTxId?: string;
  selection: BuilderSelection;
  positions: Record<string, { x: number; y: number }>;
  /**
   * Output ids the user has edited or navigated away from. A pristine output
   * (just added, still selected, never edited) keeps its empty-field
   * validation errors out of the UI until the user has had a chance to fill
   * it in — the Build gate still sees them.
   */
  touched: Record<string, true>;

  addOutput: (partial?: Partial<DraftOutput>) => string;
  updateOutput: (
    outputId: string,
    patch: Partial<Omit<DraftOutput, "id">>,
  ) => void;
  removeOutput: (outputId: string) => void;
  setOutputAsset: (outputId: string, unit: string, quantity: string) => void;
  setUtxoSelection: (selection: DraftUtxoSelection) => void;
  setDescription: (description: string) => void;
  setMetadata: (metadata: string) => void;
  updateVoteKind: (voteId: string, voteKind: DraftVoteKind) => void;
  /** Changes the target pool of a loaded DelegateStake certificate. */
  updateCertificatePool: (certificateId: string, poolId: string) => void;
  removeVote: (voteId: string) => void;
  clearVoteAnchor: (voteId: string) => void;
  /** undefined reverts the vote's rationale to untouched. */
  setVoteRationale: (voteId: string, text: string | undefined) => void;

  select: (selection: BuilderSelection) => void;
  setPosition: (entityId: string, position: { x: number; y: number }) => void;
  clearPositions: () => void;
  /** Starts a fresh draft; call on wallet change and after a successful build. */
  resetDraft: (walletId?: string) => void;
  /** Replaces the draft wholesale, e.g. when loading a pending transaction. */
  loadDraft: (args: {
    walletId: string;
    draft: TxDraft;
    editingTxId?: string;
  }) => void;
  /** Detaches the draft from the pending tx it was loaded from. */
  cancelEditing: () => void;
}

function withTouched(
  touched: Record<string, true>,
  outputId: string | undefined,
): Record<string, true> {
  if (!outputId || touched[outputId]) return touched;
  return { ...touched, [outputId]: true };
}

function selectedOutputId(selection: BuilderSelection): string | undefined {
  return selection?.kind === "output" ? selection.outputId : undefined;
}

export const useTxBuilderStore = create<TxBuilderState>()((set, get) => ({
  walletId: undefined,
  draft: createDraft(),
  editingTxId: undefined,
  selection: null,
  positions: {},
  touched: {},

  addOutput: (partial) => {
    const state = get();
    const { draft, outputId } = addOutput(state.draft, partial);
    set({
      draft,
      selection: { kind: "output", outputId },
      // Moving on to a new card counts as abandoning the previous one.
      touched: withTouched(state.touched, selectedOutputId(state.selection)),
    });
    return outputId;
  },
  updateOutput: (outputId, patch) => {
    const state = get();
    set({
      draft: updateOutput(state.draft, outputId, patch),
      touched: withTouched(state.touched, outputId),
    });
  },
  removeOutput: (outputId) => {
    const { draft, selection, positions, touched } = get();
    const { [outputId]: _removed, ...remaining } = positions;
    const { [outputId]: _untouched, ...remainingTouched } = touched;
    set({
      draft: removeOutput(draft, outputId),
      positions: remaining,
      touched: remainingTouched,
      selection:
        selection?.kind === "output" && selection.outputId === outputId
          ? null
          : selection,
    });
  },
  setOutputAsset: (outputId, unit, quantity) => {
    const state = get();
    set({
      draft: setOutputAsset(state.draft, outputId, unit, quantity),
      touched: withTouched(state.touched, outputId),
    });
  },
  setUtxoSelection: (selection) =>
    set({ draft: setUtxoSelection(get().draft, selection) }),
  setDescription: (description) =>
    set({ draft: setDescription(get().draft, description) }),
  setMetadata: (metadata) =>
    set({ draft: setMetadata(get().draft, metadata) }),
  updateVoteKind: (voteId, voteKind) =>
    set({ draft: updateVoteKind(get().draft, voteId, voteKind) }),
  updateCertificatePool: (certificateId, poolId) =>
    set({ draft: updateCertificatePool(get().draft, certificateId, poolId) }),
  removeVote: (voteId) => set({ draft: removeVote(get().draft, voteId) }),
  clearVoteAnchor: (voteId) =>
    set({ draft: clearVoteAnchor(get().draft, voteId) }),
  setVoteRationale: (voteId, text) =>
    set({ draft: setVoteRationale(get().draft, voteId, text) }),

  select: (selection) => {
    const state = get();
    const previous = selectedOutputId(state.selection);
    const stillSelected = selectedOutputId(selection) === previous;
    set({
      selection,
      // Deselecting an output means the user left it behind — from now on
      // its incomplete-field errors are fair game for the problems panel.
      touched: stillSelected
        ? state.touched
        : withTouched(state.touched, previous),
    });
  },
  setPosition: (entityId, position) =>
    set({ positions: { ...get().positions, [entityId]: position } }),
  clearPositions: () => set({ positions: {} }),
  resetDraft: (walletId) =>
    set({
      walletId,
      draft: createDraft(),
      editingTxId: undefined,
      selection: null,
      positions: {},
      touched: {},
    }),
  loadDraft: ({ walletId, draft, editingTxId }) =>
    set({
      walletId,
      draft,
      editingTxId,
      selection: null,
      positions: {},
      // Loaded outputs are complete — if the user later empties a field, its
      // validation error should surface immediately.
      touched: Object.fromEntries(
        draft.outputs.map((output) => [output.id, true as const]),
      ),
    }),
  cancelEditing: () => set({ editingTxId: undefined }),
}));
