import { MeshTxBuilder, type IFetcher, type UTxO } from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import { buildDraftTx } from "@/lib/tx-draft/build-draft-tx";
import {
  addOutput,
  createDraft,
  removeOutput,
  setOutputDatum,
  updateOutput,
} from "@/lib/tx-draft/mutations";
import {
  createOutputProvenance,
  readInlineDatum,
} from "@/lib/tx-draft/outputs";
import { isDraftCompatible, txJsonToDraft } from "@/lib/tx-draft/from-tx-json";
import { validateDraft } from "@/lib/tx-draft/validate";
import { applyDraftToTxBuilder } from "@/lib/tx-draft/to-tx-builder";
import {
  draftToTokenFlow,
  flowIdToDraftEntity,
} from "@/utils/token-flow/from-draft";
import type { TxDraft } from "@/types/tx-draft";
import { realTestAddresses } from "./testUtils";
import { createMockProvider } from "./tx-builders/mockProvider";

const SELF = realTestAddresses.address1;
const RECIPIENT = realTestAddresses.address2;
const utxo: UTxO = {
  input: { txHash: "a".repeat(64), outputIndex: 0 },
  output: {
    address: SELF,
    amount: [{ unit: "lovelace", quantity: "30000000" }],
  },
};
const ctx = {
  inputs: { kind: "pubkey" as const },
  walletAddress: SELF,
  availableUtxos: [utxo],
};
function withOutput(
  draft = createDraft("datum-draft"),
  id = "first",
  address = RECIPIENT,
  text = "01",
) {
  return addOutput(draft, {
    id,
    address,
    assets: [{ unit: "lovelace", quantity: "1" }],
    inlineDatum: { format: "CBOR", text },
  }).draft;
}
async function build(draft: TxDraft, params = {}) {
  const provider = createMockProvider({ utxos: [utxo] });
  const builder = new MeshTxBuilder({
    fetcher: provider as unknown as IFetcher,
    params,
  });
  return buildDraftTx(builder, draft, ctx, { complete: (b) => b.complete() });
}

describe("output datums through real SDK completion", () => {
  test("same-address outputs and a self-payment keep individual CBOR datums without collateral", async () => {
    let draft = withOutput();
    draft = withOutput(draft, "second", RECIPIENT, "02");
    draft = withOutput(draft, "self", SELF, "d87980");
    expect(validateDraft(draft, { network: 0 })).toEqual([]);
    const result = await build(draft);
    const tx = csl.Transaction.from_hex(result.unsignedTx);
    const outputs = tx.body().outputs();
    expect(
      [0, 1, 2].map((i) => outputs.get(i).plutus_data()?.to_hex()),
    ).toEqual(["01", "02", "d87980"]);
    expect(result.body.collaterals).toEqual([]);
    expect(tx.witness_set().vkeys()).toBeUndefined();
    expect(
      result.outputReview?.every((o) => BigInt(o.actualLovelace) > 1n),
    ).toBe(true);
    expect(draft.outputs.map((o) => o.assets[0]?.quantity)).toEqual([
      "1",
      "1",
      "1",
    ]);

    const stored = {
      ...result.body,
      builderOutputs: createOutputProvenance(draft, result.body.outputs),
    };
    expect(isDraftCompatible(stored).compatible).toBe(true);
    const loaded = txJsonToDraft(JSON.parse(JSON.stringify(stored)), {
      walletAddress: SELF,
    });
    expect(loaded.warnings).toEqual([]);
    expect(
      loaded.draft.outputs.map((o) => [o.id, o.inlineDatum?.text]),
    ).toEqual([
      ["first", "01"],
      ["second", "02"],
      ["self", "d87980"],
    ]);
    let edited = {
      ...loaded.draft,
      outputs: [...loaded.draft.outputs].reverse(),
    };
    edited = updateOutput(edited, "second", { address: SELF });
    edited = setOutputDatum(edited, "first", undefined);
    edited = removeOutput(edited, "self");
    const rebuilt = await build(edited);
    const finalOutputs = csl.Transaction.from_hex(rebuilt.unsignedTx)
      .body()
      .outputs();
    expect(finalOutputs.get(0).plutus_data()?.to_hex()).toBe("02");
    expect(finalOutputs.get(1).plutus_data()).toBeUndefined();
  });

  test("minimum ADA grows with datum size and uses the supplied protocol parameters", async () => {
    const small = await build(withOutput(), { coinsPerUtxoSize: 5000 });
    const draft = setOutputDatum(withOutput(), "first", {
      format: "JSON",
      text: JSON.stringify({ bytes: "ab".repeat(800) }),
    });
    const large = await build(draft, { coinsPerUtxoSize: 5000 });
    expect(BigInt(large.outputReview![0]!.actualLovelace)).toBeGreaterThan(
      BigInt(small.outputReview![0]!.actualLovelace),
    );
    const calculator = new MeshTxBuilder({
      params: { coinsPerUtxoSize: 5000 },
    });
    expect(
      BigInt(large.outputReview![0]!.actualLovelace),
    ).toBeGreaterThanOrEqual(
      calculator.calculateMinLovelaceForOutput(large.body.outputs[0]!),
    );
    expect(large.sizeBytes).toBeGreaterThan(small.sizeBytes);
    await expect(build(draft, { maxTxSize: 200 })).rejects.toBeDefined();
  });

  test("invalid edits fail before the builder receives any inputs", () => {
    const builder = new MeshTxBuilder({});
    expect(() =>
      applyDraftToTxBuilder(
        builder,
        withOutput(undefined, "first", RECIPIENT, "0"),
        ctx,
      ),
    ).toThrow(/datum/i);
    expect(builder.meshTxBuilderBody.inputs).toEqual([]);
  });
});

describe("safe output reload and canvas identity", () => {
  test("ambiguous legacy change and altered provenance never discard outputs", async () => {
    const draft = withOutput(withOutput(), "self", SELF, "02");
    const result = await build(draft);
    const provenance = createOutputProvenance(draft, result.body.outputs);
    const mismatched = structuredClone(provenance);
    mismatched.outputs[0]!.fingerprint = "changed";
    for (const builderOutputs of [
      undefined,
      mismatched,
      { version: 9, outputs: [] },
    ]) {
      const loaded = txJsonToDraft(
        { ...result.body, builderOutputs },
        { walletAddress: SELF },
      );
      expect(loaded.draft.outputs).toHaveLength(result.body.outputs.length);
      expect(loaded.draft.outputs[1]?.inlineDatum?.text).toBe("02");
      expect(loaded.warnings).toEqual(["change-not-detected"]);
    }
    const mistakenChange = {
      ...provenance,
      outputs: provenance.outputs.slice(0, 1),
    };
    expect(
      txJsonToDraft(
        { ...result.body, builderOutputs: mistakenChange },
        { walletAddress: SELF },
      ).draft.outputs,
    ).toHaveLength(result.body.outputs.length);
  });

  test.each([
    { type: "Hash", data: { type: "CBOR", content: "01" } },
    { type: "Embedded", data: { type: "CBOR", content: "01" } },
    { type: "Inline", data: { type: "CBOR", content: "0102" } },
    { type: "Inline", data: { type: "Mesh", content: {} } },
  ])("unsupported output datum fails compatibility: %j", async (datum) => {
    const result = await build(withOutput());
    const body = {
      ...result.body,
      outputs: [{ ...result.body.outputs[0], datum }],
    };
    expect(isDraftCompatible(body).compatible).toBe(false);
    expect(() => txJsonToDraft(body, { walletAddress: SELF })).toThrow();
    expect(() => readInlineDatum(datum)).toThrow();
  });

  test("malformed outputs and reference scripts cannot be silently dropped on reload", async () => {
    const result = await build(withOutput());
    for (const output of [
      null,
      { ...result.body.outputs[0], address: undefined },
      { ...result.body.outputs[0], amount: [{ unit: "lovelace" }] },
      {
        ...result.body.outputs[0],
        referenceScript: { code: "00", version: "V3" },
      },
    ]) {
      const body = { ...result.body, outputs: [output] };
      expect(isDraftCompatible(body).compatible).toBe(false);
      expect(() => txJsonToDraft(body, { walletAddress: SELF })).toThrow();
    }
  });

  test("each output has a stable selectable card and independent badge", () => {
    const draft = withOutput(withOutput(), "second", RECIPIENT, "02");
    const opts = {
      walletAddress: SELF,
      labelAddress: () => ({ type: "unknown" as const, label: "" }),
    };
    const flow = draftToTokenFlow(draft, opts);
    for (const id of ["first", "second"]) {
      expect(flow.nodes.find((n) => n.id === `draftout:${id}`)).toMatchObject({
        inlineDatum: true,
      });
      expect(flowIdToDraftEntity(draft, `draftout:${id}`)).toEqual({
        kind: "output",
        outputId: id,
      });
    }
    expect(flowIdToDraftEntity(draft, `addr:${SELF}@out`)).toEqual({
      kind: "tx",
    });
    const edited = updateOutput(draft, "first", { address: SELF });
    expect(draftToTokenFlow(edited, opts).nodes.map((n) => n.id)).toEqual(
      flow.nodes.map((n) => n.id),
    );
    expect(
      validateDraft(draft, { network: 0 }).some(
        (i) => i.code === "duplicate-output",
      ),
    ).toBe(false);
    expect(
      validateDraft(
        setOutputDatum(draft, "second", { format: "JSON", text: '{"int":1}' }),
        { network: 0 },
      ).some((i) => i.code === "duplicate-output"),
    ).toBe(true);
  });
});
