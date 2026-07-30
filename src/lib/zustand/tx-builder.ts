import { create } from "zustand";

import type {
  BuilderSelection,
  DraftOutput,
  DraftUtxoSelection,
  TxDraft,
} from "@/types/tx-draft";
import {
  addOutput,
  createDraft,
  removeOutput,
  setChangeAddress,
  setDescription,
  setMetadata,
  setOutputAsset,
  setUtxoSelection,
  updateOutput,
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
  selection: BuilderSelection;
  positions: Record<string, { x: number; y: number }>;

  addOutput: (partial?: Partial<DraftOutput>) => string;
  updateOutput: (
    outputId: string,
    patch: Partial<Omit<DraftOutput, "id">>,
  ) => void;
  removeOutput: (outputId: string) => void;
  setOutputAsset: (outputId: string, unit: string, quantity: string) => void;
  setUtxoSelection: (selection: DraftUtxoSelection) => void;
  setChangeAddress: (changeAddress: string | undefined) => void;
  setDescription: (description: string) => void;
  setMetadata: (metadata: string) => void;

  select: (selection: BuilderSelection) => void;
  setPosition: (entityId: string, position: { x: number; y: number }) => void;
  clearPositions: () => void;
  /** Starts a fresh draft; call on wallet change and after a successful build. */
  resetDraft: (walletId?: string) => void;
}

export const useTxBuilderStore = create<TxBuilderState>()((set, get) => ({
  walletId: undefined,
  draft: createDraft(),
  selection: null,
  positions: {},

  addOutput: (partial) => {
    const { draft, outputId } = addOutput(get().draft, partial);
    set({ draft, selection: { kind: "output", outputId } });
    return outputId;
  },
  updateOutput: (outputId, patch) =>
    set({ draft: updateOutput(get().draft, outputId, patch) }),
  removeOutput: (outputId) => {
    const { draft, selection, positions } = get();
    const { [outputId]: _removed, ...remaining } = positions;
    set({
      draft: removeOutput(draft, outputId),
      positions: remaining,
      selection:
        selection?.kind === "output" && selection.outputId === outputId
          ? null
          : selection,
    });
  },
  setOutputAsset: (outputId, unit, quantity) =>
    set({ draft: setOutputAsset(get().draft, outputId, unit, quantity) }),
  setUtxoSelection: (selection) =>
    set({ draft: setUtxoSelection(get().draft, selection) }),
  setChangeAddress: (changeAddress) =>
    set({ draft: setChangeAddress(get().draft, changeAddress) }),
  setDescription: (description) =>
    set({ draft: setDescription(get().draft, description) }),
  setMetadata: (metadata) =>
    set({ draft: setMetadata(get().draft, metadata) }),

  select: (selection) => set({ selection }),
  setPosition: (entityId, position) =>
    set({ positions: { ...get().positions, [entityId]: position } }),
  clearPositions: () => set({ positions: {} }),
  resetDraft: (walletId) =>
    set({
      walletId,
      draft: createDraft(),
      selection: null,
      positions: {},
    }),
}));
