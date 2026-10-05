import { MeshTxBuilder } from "@meshsdk/core";
import {
  addOutput,
  addScriptInput,
  createDraft,
  invalidateDraftContext,
  normalizeDraft,
  removeOutput,
  removeScriptInput,
  setCollateral,
  setDescription,
  setMetadata,
  setOutputAsset,
  setOutputDatum,
  setSource,
  setUtxoSelection,
  updateOutput,
  updateScriptInput,
} from "@/lib/tx-draft/mutations";
import { validateDraft } from "@/lib/tx-draft/validate";
import { applyDraftToTxBuilder } from "@/lib/tx-draft/to-tx-builder";
import { useTxBuilderStore } from "@/lib/zustand/tx-builder";
import { realTestAddresses } from "./testUtils";

const datum = { format: "CBOR" as const, text: "d87980" };
const input = {
  utxoRef: { txHash: "a".repeat(64), outputIndex: 1 },
  script: { version: "V3" as const, cbor: "4101" },
  datumSource: { kind: "provided" as const, data: datum },
  redeemer: { format: "JSON" as const, text: '{"int":1}' },
};
const collateral = { utxoRef: { txHash: "b".repeat(64), outputIndex: 0 } };
const send = () =>
  addOutput(createDraft("draft"), {
    id: "output",
    address: realTestAddresses.address1,
    assets: [{ unit: "lovelace", quantity: "3000000" }],
  }).draft;

describe("Plutus draft intent", () => {
  test("new and legacy drafts start unconfigured", () => {
    const draft = createDraft();
    expect(draft.scriptInputs).toEqual([]);
    expect(draft.collateral).toBeUndefined();
    const { scriptInputs: _inputs, ...legacy } = send();
    expect(normalizeDraft(legacy)).toEqual({ ...legacy, scriptInputs: [] });
    expect(validateDraft(normalizeDraft(legacy), { network: 0 })).toEqual([]);
  });

  test("datum belongs to an output ID through reorder, address/asset/scalar edits and removal", () => {
    const original = setOutputDatum(send(), "output", datum);
    let draft = addOutput(original, {
      id: "second",
      address: original.outputs[0]!.address,
      inlineDatum: { format: "CBOR", text: "01" },
    }).draft;
    draft = { ...draft, outputs: [...draft.outputs].reverse() };
    draft = updateOutput(draft, "output", {
      address: realTestAddresses.address2,
    });
    draft = setOutputAsset(draft, "output", "lovelace", "4000000");
    draft = setMetadata(setDescription(draft, "description"), "metadata");
    expect(draft.outputs.find((o) => o.id === "output")?.inlineDatum).toEqual(
      datum,
    );
    expect(
      draft.outputs.find((o) => o.id === "second")?.inlineDatum?.text,
    ).toBe("01");
    const cleared = setOutputDatum(draft, "output", undefined);
    expect(
      cleared.outputs.find((o) => o.id === "output")?.inlineDatum,
    ).toBeUndefined();
    expect(removeOutput(cleared, "output").outputs[0]?.inlineDatum?.text).toBe(
      "01",
    );
    expect(original.outputs[0]?.assets[0]?.quantity).toBe("3000000");
    expect(original.outputs[0]?.inlineDatum).toEqual(datum);
  });

  test("script input identity and unrelated values survive edits", () => {
    const first = addScriptInput(send(), input);
    const second = addScriptInput(first.draft);
    const edited = updateScriptInput(second.draft, first.inputId, {
      utxoRef: { txHash: "c".repeat(64), outputIndex: 3 },
      redeemer: { format: "JSON", text: "{" },
    });
    expect(edited.scriptInputs[0]).toMatchObject({
      id: first.inputId,
      script: input.script,
      datumSource: input.datumSource,
      redeemer: { text: "{" },
    });
    expect(edited.scriptInputs[1]).toEqual(second.draft.scriptInputs[1]);
    expect(first.draft.scriptInputs[0]?.redeemer).toEqual(input.redeemer);
    expect(
      removeScriptInput(edited, first.inputId).scriptInputs.map((i) => i.id),
    ).toEqual([second.inputId]);
  });

  test("context invalidation clears chain selections, preserving editable text and refs", () => {
    const { draft: base } = addScriptInput(
      setOutputDatum(send(), "output", datum),
      input,
    );
    const draft = setCollateral(
      setUtxoSelection(base, { mode: "manual", utxos: [] }),
      collateral,
    );
    for (const next of [
      invalidateDraftContext(draft),
      setSource(draft, { kind: "connected" }),
    ]) {
      expect(next.collateral).toBeUndefined();
      expect(next.utxoSelection.mode).toBe("auto");
      expect(next.scriptInputs).toEqual(draft.scriptInputs);
      expect(next.outputs).toEqual(draft.outputs);
    }
    expect(setSource(draft, draft.source).collateral).toEqual(collateral);
    expect(draft.collateral).toEqual(collateral);
  });

  test("collateral clears explicitly and when the last script input is removed", () => {
    const first = addScriptInput(send(), input);
    const second = addScriptInput(first.draft);
    const selected = setCollateral(second.draft, collateral);
    expect(setCollateral(selected, undefined).collateral).toBeUndefined();
    const next = removeScriptInput(selected, first.inputId);
    expect(next.collateral).toEqual(collateral);
    expect(removeScriptInput(next, second.inputId).collateral).toBeUndefined();
    expect(setCollateral(send(), collateral).collateral).toBeUndefined();
  });
});

describe("Plutus field validation and build boundary", () => {
  test("current invalid edits are anchored to output and input fields", () => {
    const added = addScriptInput(
      setOutputDatum(send(), "output", datum),
      input,
    );
    const before = validateDraft(added.draft, { network: 0 });
    expect(before.map((i) => i.code)).toEqual(["plutus-build-unsupported"]);
    const edited = updateScriptInput(
      setOutputDatum(added.draft, "output", { format: "CBOR", text: "0" }),
      added.inputId,
      {
        datumSource: {
          kind: "provided",
          data: { format: "JSON", text: '{"bytes":"g"}' },
        },
        redeemer: { format: "JSON", text: '{"int":9007199254740993}' },
      },
    );
    expect(validateDraft(edited, { network: 0 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "output-datum-invalid",
          outputId: "output",
          field: "inlineDatum",
          level: "error",
        }),
        expect.objectContaining({
          code: "script-input-datum-invalid",
          inputId: added.inputId,
          inputRef: input.utxoRef,
          field: "datumSource",
        }),
        expect.objectContaining({
          code: "script-input-redeemer-invalid",
          inputId: added.inputId,
          field: "redeemer",
        }),
      ]),
    );
  });

  test("incomplete inputs, malformed collateral and duplicate references are errors", () => {
    let { draft } = addScriptInput(send());
    expect(validateDraft(draft, { network: 0 }).map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "script-input-ref-invalid",
        "script-input-script-invalid",
        "script-input-redeemer-invalid",
      ]),
    );
    draft = addScriptInput(addScriptInput(send(), input).draft, {
      ...input,
      utxoRef: { ...input.utxoRef, txHash: input.utxoRef.txHash.toUpperCase() },
    }).draft;
    draft = setCollateral(draft, {
      utxoRef: { txHash: "bad", outputIndex: -1 },
    });
    expect(validateDraft(draft, { network: 0 }).map((i) => i.code)).toEqual(
      expect.arrayContaining([
        "script-input-duplicate",
        "collateral-ref-invalid",
      ]),
    );
  });

  test("the builder cannot silently omit new intent, even if callers skip validation", () => {
    const drafts = [
      setOutputDatum(send(), "output", datum),
      addScriptInput(send(), input).draft,
      { ...send(), collateral },
    ];
    for (const draft of drafts) {
      const builder = new MeshTxBuilder({});
      expect(() =>
        applyDraftToTxBuilder(builder, draft, {
          inputs: { kind: "pubkey" },
          walletAddress: realTestAddresses.address1,
          availableUtxos: [],
        }),
      ).toThrow(/encoding is not enabled/);
      expect(builder.meshTxBuilderBody.inputs).toEqual([]);
      expect(builder.meshTxBuilderBody.outputs).toEqual([]);
    }
  });
});

describe("Plutus store lifecycle", () => {
  beforeEach(() => {
    useTxBuilderStore.getState().resetDraft("wallet-1");
    useTxBuilderStore.setState({ environment: undefined });
    useTxBuilderStore
      .getState()
      .syncEnvironment({ network: 0, account: "wallet:account-1" });
  });

  function populate() {
    const store = useTxBuilderStore.getState;
    const outputId = store().addOutput();
    store().setOutputDatum(outputId, datum);
    const inputId = store().addScriptInput(input);
    store().setCollateral(collateral);
    store().setUtxoSelection({ mode: "manual", utxos: [] });
    return { store, outputId, inputId };
  }

  test("wrappers preserve invalid edits, focus the transaction, and touch datum outputs", () => {
    const { store, outputId, inputId } = populate();
    store().updateScriptInput(inputId, {
      redeemer: { format: "CBOR", text: "0" },
    });
    store().setPosition(outputId, { x: 5, y: 7 });
    expect(store().draft.scriptInputs[0]?.redeemer.text).toBe("0");
    expect(store().draft.outputs[0]?.inlineDatum).toEqual(datum);
    expect(store().touched[outputId]).toBe(true);
    expect(store().selection).toEqual({ kind: "tx" });
    store().removeScriptInput(inputId);
    expect(store().draft.collateral).toBeUndefined();
  });

  test.each([
    { network: 1, account: "wallet:account-1" },
    { network: 0, account: "wallet:account-2" },
    { network: 0 },
  ])("environment change invalidates chain selections: %j", (environment) => {
    const { store } = populate();
    const old = store().draft;
    store().syncEnvironment(environment);
    expect(store().draft).not.toBe(old);
    expect(store().draft.collateral).toBeUndefined();
    expect(store().draft.utxoSelection.mode).toBe("auto");
    expect(store().draft.scriptInputs).toEqual(old.scriptInputs);
    expect(store().draft.outputs).toEqual(old.outputs);
  });

  test("unchanged environment is a no-op; changing funding clears collateral", () => {
    const { store } = populate();
    const old = store().draft;
    store().syncEnvironment({ network: 0, account: "wallet:account-1" });
    expect(store().draft).toBe(old);
    store().setSource({ kind: "connected" });
    expect(store().draft.collateral).toBeUndefined();
    expect(store().draft.scriptInputs).toEqual(old.scriptInputs);
  });

  test("legacy load defaults fields; wallet reset removes all advanced intent", () => {
    const { store } = populate();
    store().resetDraft("wallet-2");
    expect(store().draft.scriptInputs).toEqual([]);
    expect(store().draft.collateral).toBeUndefined();
    const { scriptInputs: _inputs, ...legacy } = send();
    store().loadDraft({ walletId: "wallet-2", draft: legacy });
    expect(store().draft.scriptInputs).toEqual([]);
  });
});
