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

describe("tx-draft mutations", () => {
  test("createDraft returns an empty auto-mode draft with unique ids", () => {
    const a = createDraft();
    const b = createDraft();
    expect(a.outputs).toEqual([]);
    expect(a.utxoSelection).toEqual({ mode: "auto" });
    expect(a.description).toBe("");
    expect(a.metadata).toBe("");
    expect(a.certificates).toEqual([]);
    expect(a.votes).toEqual([]);
    expect(a.id).not.toBe(b.id);
    expect(createDraft("fixed").id).toBe("fixed");
  });

  test("addOutput appends without mutating the original draft", () => {
    const draft = createDraft("d1");
    const { draft: next, outputId } = addOutput(draft, {
      address: "addr_test1x",
    });
    expect(draft.outputs).toHaveLength(0); // immutability
    expect(next.outputs).toHaveLength(1);
    expect(next.outputs[0]).toEqual({
      id: outputId,
      address: "addr_test1x",
      assets: [],
    });
    // Explicit ids (used by tests and the store) are respected.
    const { draft: withId } = addOutput(next, { id: "out-2" });
    expect(withId.outputs[1]!.id).toBe("out-2");
    expect(withId.outputs[1]!.address).toBe("");
  });

  test("updateOutput patches only the targeted output", () => {
    let { draft } = addOutput(createDraft("d1"), { id: "a" });
    ({ draft } = addOutput(draft, { id: "b" }));
    const next = updateOutput(draft, "b", { address: "addr_test1y" });
    expect(next.outputs[0]!.address).toBe("");
    expect(next.outputs[1]!.address).toBe("addr_test1y");
    expect(next.outputs[1]!.id).toBe("b");
  });

  test("removeOutput drops the targeted output", () => {
    let { draft } = addOutput(createDraft("d1"), { id: "a" });
    ({ draft } = addOutput(draft, { id: "b" }));
    const next = removeOutput(draft, "a");
    expect(next.outputs.map((o) => o.id)).toEqual(["b"]);
  });

  describe("setOutputAsset", () => {
    const base = () =>
      addOutput(createDraft("d1"), {
        id: "a",
        assets: [
          { unit: "lovelace", quantity: "1000000" },
          { unit: "policy1token", quantity: "5" },
        ],
      }).draft;

    test("adds a new asset", () => {
      const next = setOutputAsset(base(), "a", "policy2token", "7");
      expect(next.outputs[0]!.assets).toEqual([
        { unit: "lovelace", quantity: "1000000" },
        { unit: "policy1token", quantity: "5" },
        { unit: "policy2token", quantity: "7" },
      ]);
    });

    test("updates in place, preserving row order", () => {
      const next = setOutputAsset(base(), "a", "lovelace", "2000000");
      expect(next.outputs[0]!.assets).toEqual([
        { unit: "lovelace", quantity: "2000000" },
        { unit: "policy1token", quantity: "5" },
      ]);
    });

    test("removes the asset at zero quantity", () => {
      const next = setOutputAsset(base(), "a", "policy1token", "0");
      expect(next.outputs[0]!.assets).toEqual([
        { unit: "lovelace", quantity: "1000000" },
      ]);
    });
  });

  test("scalar setters replace their field only", () => {
    const draft = createDraft("d1");
    expect(setDescription(draft, "hello").description).toBe("hello");
    expect(setMetadata(draft, "on-chain").metadata).toBe("on-chain");
    expect(setChangeAddress(draft, "addr_test1c").changeAddress).toBe(
      "addr_test1c",
    );
    expect(setChangeAddress(draft, undefined).changeAddress).toBeUndefined();
    const manual = setUtxoSelection(draft, { mode: "manual", utxos: [] });
    expect(manual.utxoSelection.mode).toBe("manual");
    expect(draft.utxoSelection.mode).toBe("auto"); // original untouched
  });
});
