import {
  addCertificate,
  addOutput,
  addVote,
  createDraft,
} from "@/lib/tx-draft/mutations";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";

/**
 * The touched map decides which outputs may show empty-field validation
 * errors ("no address yet" / "no amount yet") in the builder UI: a pristine,
 * still-selected output keeps them hidden; editing it or navigating away
 * surfaces them.
 */
describe("tx-builder store touched tracking", () => {
  beforeEach(() => {
    useTxBuilderStore.getState().resetDraft("wallet-1");
  });

  it("leaves a freshly added output untouched and selects it", () => {
    const outputId = useTxBuilderStore.getState().addOutput();
    const state = useTxBuilderStore.getState();
    expect(state.touched[outputId]).toBeUndefined();
    expect(state.selection).toEqual({ kind: "output", outputId });
  });

  it("marks an output touched when it is edited", () => {
    const outputId = useTxBuilderStore.getState().addOutput();
    useTxBuilderStore.getState().updateOutput(outputId, { address: "addr1x" });
    expect(useTxBuilderStore.getState().touched[outputId]).toBe(true);
  });

  it("marks an output touched when its assets are edited", () => {
    const outputId = useTxBuilderStore.getState().addOutput();
    useTxBuilderStore.getState().setOutputAsset(outputId, "lovelace", "1");
    expect(useTxBuilderStore.getState().touched[outputId]).toBe(true);
  });

  it("marks an output touched when the selection moves away from it", () => {
    const outputId = useTxBuilderStore.getState().addOutput();
    useTxBuilderStore.getState().select({ kind: "tx" });
    expect(useTxBuilderStore.getState().touched[outputId]).toBe(true);
  });

  it("keeps an output untouched while it stays selected", () => {
    const outputId = useTxBuilderStore.getState().addOutput();
    useTxBuilderStore.getState().select({ kind: "output", outputId });
    expect(useTxBuilderStore.getState().touched[outputId]).toBeUndefined();
  });

  it("marks the previous output touched when another card is added", () => {
    const first = useTxBuilderStore.getState().addOutput();
    const second = useTxBuilderStore.getState().addOutput();
    const state = useTxBuilderStore.getState();
    expect(state.touched[first]).toBe(true);
    expect(state.touched[second]).toBeUndefined();
  });

  it("drops touched state when the output is removed", () => {
    const outputId = useTxBuilderStore.getState().addOutput();
    useTxBuilderStore.getState().updateOutput(outputId, { address: "addr1x" });
    useTxBuilderStore.getState().removeOutput(outputId);
    expect(useTxBuilderStore.getState().touched[outputId]).toBeUndefined();
  });

  it("clears touched state on resetDraft", () => {
    const outputId = useTxBuilderStore.getState().addOutput();
    useTxBuilderStore.getState().updateOutput(outputId, { address: "addr1x" });
    useTxBuilderStore.getState().resetDraft("wallet-2");
    expect(useTxBuilderStore.getState().touched).toEqual({});
  });
});

describe("tx-builder store draft mutations", () => {
  beforeEach(() => {
    useTxBuilderStore.getState().resetDraft("wallet-1");
  });

  it("resetDraft starts a fresh draft for the given wallet", () => {
    const outputId = useTxBuilderStore.getState().addOutput();
    useTxBuilderStore.getState().setDescription("old");
    useTxBuilderStore.getState().setPosition(outputId, { x: 1, y: 2 });

    useTxBuilderStore.getState().resetDraft("wallet-2");

    const state = useTxBuilderStore.getState();
    expect(state.walletId).toBe("wallet-2");
    expect(state.draft.outputs).toEqual([]);
    expect(state.draft.description).toBe("");
    expect(state.selection).toBeNull();
    expect(state.positions).toEqual({});
  });

  it("applies the utxo selection, description, and metadata to the draft", () => {
    useTxBuilderStore.getState().setUtxoSelection({ mode: "manual", utxos: [] });
    useTxBuilderStore.getState().setDescription("pay the team");
    useTxBuilderStore.getState().setMetadata("invoice #42");

    const { draft } = useTxBuilderStore.getState();
    expect(draft.utxoSelection).toEqual({ mode: "manual", utxos: [] });
    expect(draft.description).toBe("pay the team");
    expect(draft.metadata).toBe("invoice #42");

    useTxBuilderStore.getState().setUtxoSelection({ mode: "auto" });
    const after = useTxBuilderStore.getState().draft;
    expect(after.utxoSelection).toEqual({ mode: "auto" });
  });

  it("removing the selected output clears the selection, keeping others intact", () => {
    const first = useTxBuilderStore.getState().addOutput();
    const second = useTxBuilderStore.getState().addOutput();

    useTxBuilderStore.getState().removeOutput(second);
    expect(useTxBuilderStore.getState().selection).toBeNull();

    useTxBuilderStore.getState().select({ kind: "output", outputId: first });
    useTxBuilderStore.getState().removeOutput("someone-else");
    expect(useTxBuilderStore.getState().selection).toEqual({
      kind: "output",
      outputId: first,
    });
  });
});

/**
 * Positions are keyed by DRAFT ENTITY id (output id, "tx", or bech32 address
 * for input-side nodes), not by React Flow node id — so a placeholder card
 * keeps its position when setting its address changes the node id from
 * `draftout:<id>` to `addr:<bech32>`.
 */
describe("tx-builder store position tracking", () => {
  beforeEach(() => {
    useTxBuilderStore.getState().resetDraft("wallet-1");
  });

  it("stores and overwrites dragged positions per entity", () => {
    useTxBuilderStore.getState().setPosition("tx", { x: 10, y: 20 });
    useTxBuilderStore.getState().setPosition("tx", { x: 30, y: 40 });
    expect(useTxBuilderStore.getState().positions).toEqual({
      tx: { x: 30, y: 40 },
    });
  });

  it("keeps an output's position across the address edit that renames its canvas node", () => {
    const outputId = useTxBuilderStore.getState().addOutput();
    useTxBuilderStore.getState().setPosition(outputId, { x: 100, y: 50 });

    // The canvas node id flips from `draftout:<id>` to `addr:<bech32>` here,
    // but the position map is keyed by the output id and must survive.
    useTxBuilderStore.getState().updateOutput(outputId, { address: "addr1new" });

    expect(useTxBuilderStore.getState().positions[outputId]).toEqual({
      x: 100,
      y: 50,
    });
  });

  it("prunes the removed output's position and keeps the rest", () => {
    const first = useTxBuilderStore.getState().addOutput();
    const second = useTxBuilderStore.getState().addOutput();
    useTxBuilderStore.getState().setPosition(first, { x: 1, y: 1 });
    useTxBuilderStore.getState().setPosition(second, { x: 2, y: 2 });

    useTxBuilderStore.getState().removeOutput(first);

    expect(useTxBuilderStore.getState().positions).toEqual({
      [second]: { x: 2, y: 2 },
    });
  });

  it("clearPositions empties the map without touching the draft", () => {
    const outputId = useTxBuilderStore.getState().addOutput();
    useTxBuilderStore.getState().setPosition(outputId, { x: 5, y: 5 });

    useTxBuilderStore.getState().clearPositions();

    const state = useTxBuilderStore.getState();
    expect(state.positions).toEqual({});
    expect(state.draft.outputs).toHaveLength(1);
  });
});

describe("tx-builder store editing a pending transaction", () => {
  beforeEach(() => {
    useTxBuilderStore.getState().resetDraft("wallet-1");
  });

  function loadedDraft() {
    return addOutput(createDraft("loaded"), {
      id: "out-1",
      address: "addr1recipient",
      assets: [{ unit: "lovelace", quantity: "2000000" }],
    }).draft;
  }

  it("loadDraft replaces the draft and records the editing context", () => {
    const stale = useTxBuilderStore.getState().addOutput();
    useTxBuilderStore.getState().setPosition(stale, { x: 9, y: 9 });

    useTxBuilderStore.getState().loadDraft({
      walletId: "wallet-2",
      draft: loadedDraft(),
      editingTxId: "tx-1",
    });

    const state = useTxBuilderStore.getState();
    expect(state.walletId).toBe("wallet-2");
    expect(state.editingTxId).toBe("tx-1");
    expect(state.draft.id).toBe("loaded");
    expect(state.selection).toBeNull();
    expect(state.positions).toEqual({});
  });

  it("loadDraft marks every loaded output as touched", () => {
    useTxBuilderStore.getState().loadDraft({
      walletId: "wallet-1",
      draft: loadedDraft(),
      editingTxId: "tx-1",
    });
    expect(useTxBuilderStore.getState().touched).toEqual({ "out-1": true });
  });

  it("cancelEditing keeps the draft but detaches the pending tx", () => {
    useTxBuilderStore.getState().loadDraft({
      walletId: "wallet-1",
      draft: loadedDraft(),
      editingTxId: "tx-1",
    });

    useTxBuilderStore.getState().cancelEditing();

    const state = useTxBuilderStore.getState();
    expect(state.editingTxId).toBeUndefined();
    expect(state.draft.outputs).toHaveLength(1);
  });

  it("resetDraft clears the editing context", () => {
    useTxBuilderStore.getState().loadDraft({
      walletId: "wallet-1",
      draft: loadedDraft(),
      editingTxId: "tx-1",
    });

    useTxBuilderStore.getState().resetDraft("wallet-1");

    expect(useTxBuilderStore.getState().editingTxId).toBeUndefined();
  });
});

describe("tx-builder store vote actions", () => {
  const voteBase = {
    govActionTxHash: "c".repeat(64),
    govActionIndex: 1,
    voteKind: "Yes" as const,
    anchor: { anchorUrl: "ipfs://cid", anchorDataHash: "d".repeat(64) },
  };

  beforeEach(() => {
    useTxBuilderStore.getState().resetDraft("wallet-1");
    const draft = addVote(createDraft("loaded"), { ...voteBase, id: "v-1" }).draft;
    useTxBuilderStore.getState().loadDraft({
      walletId: "wallet-1",
      draft,
      editingTxId: "tx-1",
    });
  });

  it("loadDraft preserves votes", () => {
    expect(useTxBuilderStore.getState().draft.votes).toEqual([
      { ...voteBase, id: "v-1" },
    ]);
  });

  it("updateVoteKind flips the choice", () => {
    useTxBuilderStore.getState().updateVoteKind("v-1", "No");
    expect(useTxBuilderStore.getState().draft.votes[0]!.voteKind).toBe("No");
  });

  it("clearVoteAnchor detaches the rationale only", () => {
    useTxBuilderStore.getState().clearVoteAnchor("v-1");
    const vote = useTxBuilderStore.getState().draft.votes[0]!;
    expect(vote.anchor).toBeUndefined();
    expect(vote.voteKind).toBe("Yes");
  });

  it("removeVote drops the vote without touching selection", () => {
    useTxBuilderStore.getState().select({ kind: "tx" });
    useTxBuilderStore.getState().removeVote("v-1");
    const state = useTxBuilderStore.getState();
    expect(state.draft.votes).toHaveLength(0);
    expect(state.selection).toEqual({ kind: "tx" });
  });

  it("resetDraft clears votes", () => {
    useTxBuilderStore.getState().resetDraft("wallet-1");
    expect(useTxBuilderStore.getState().draft.votes).toEqual([]);
  });
});

describe("tx-builder store certificate actions", () => {
  const certBase = {
    kind: "DelegateStake" as const,
    poolId: "pool1old",
    originalStakeAddress: "stake_test1abc",
  };

  beforeEach(() => {
    useTxBuilderStore.getState().resetDraft("wallet-1");
    const draft = addCertificate(createDraft("loaded"), {
      ...certBase,
      id: "c-1",
    }).draft;
    useTxBuilderStore.getState().loadDraft({
      walletId: "wallet-1",
      draft,
      editingTxId: "tx-1",
    });
  });

  it("loadDraft preserves certificates", () => {
    expect(useTxBuilderStore.getState().draft.certificates).toEqual([
      { ...certBase, id: "c-1" },
    ]);
  });

  it("updateCertificatePool swaps the delegation target", () => {
    useTxBuilderStore.getState().updateCertificatePool("c-1", "pool1new");
    expect(
      useTxBuilderStore.getState().draft.certificates[0]!.poolId,
    ).toBe("pool1new");
  });

  it("resetDraft clears certificates", () => {
    useTxBuilderStore.getState().resetDraft("wallet-1");
    expect(useTxBuilderStore.getState().draft.certificates).toEqual([]);
  });
});

describe("tx-builder store vote rationale", () => {
  beforeEach(() => {
    useTxBuilderStore.getState().resetDraft("wallet-1");
    const draft = addVote(createDraft("loaded"), {
      id: "v-1",
      govActionTxHash: "c".repeat(64),
      govActionIndex: 0,
      voteKind: "Yes",
      anchor: { anchorUrl: "ipfs://cid", anchorDataHash: "d".repeat(64) },
    }).draft;
    useTxBuilderStore.getState().loadDraft({
      walletId: "wallet-1",
      draft,
      editingTxId: "tx-1",
    });
  });

  it("setVoteRationale round-trips and reverts via undefined", () => {
    useTxBuilderStore.getState().setVoteRationale("v-1", "new reasoning");
    expect(useTxBuilderStore.getState().draft.votes[0]!.rationaleEdit).toBe(
      "new reasoning",
    );
    useTxBuilderStore.getState().setVoteRationale("v-1", undefined);
    expect(
      "rationaleEdit" in useTxBuilderStore.getState().draft.votes[0]!,
    ).toBe(false);
  });
});
