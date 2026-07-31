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
