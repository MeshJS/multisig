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

  it("applies the utxo selection, change address, description, and metadata to the draft", () => {
    useTxBuilderStore.getState().setUtxoSelection({ mode: "manual", utxos: [] });
    useTxBuilderStore.getState().setChangeAddress("addr1change");
    useTxBuilderStore.getState().setDescription("pay the team");
    useTxBuilderStore.getState().setMetadata("invoice #42");

    const { draft } = useTxBuilderStore.getState();
    expect(draft.utxoSelection).toEqual({ mode: "manual", utxos: [] });
    expect(draft.changeAddress).toBe("addr1change");
    expect(draft.description).toBe("pay the team");
    expect(draft.metadata).toBe("invoice #42");

    useTxBuilderStore.getState().setUtxoSelection({ mode: "auto" });
    useTxBuilderStore.getState().setChangeAddress(undefined);
    const after = useTxBuilderStore.getState().draft;
    expect(after.utxoSelection).toEqual({ mode: "auto" });
    expect(after.changeAddress).toBeUndefined();
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
