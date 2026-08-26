import type { UTxO } from "@meshsdk/core";

import {
  addOutput,
  createDraft,
  setUtxoSelection,
} from "@/lib/tx-draft/mutations";
import type { AddressLabeler, TokenFlow } from "@/types/token-flow";
import type { TxDraft } from "@/types/tx-draft";
import {
  draftToTokenFlow,
  flowIdToDraftEntity,
  splitTrailingChange,
  type DraftBuildOverlay,
} from "@/utils/token-flow";

const SELF = "addr_test1self";
const OTHER = "addr_test1other";
const TX_HASH = "f".repeat(64);

const labelAddress: AddressLabeler = (address) =>
  address === SELF
    ? { label: "Self (Multisig)", type: "self" }
    : { label: "", type: "unknown" };

const OPTS = { labelAddress, walletAddress: SELF };

function lovelace(quantity: string) {
  return [{ unit: "lovelace", quantity }];
}

function outputEdges(flow: TokenFlow) {
  return flow.edges.filter((e) => e.kind === "output");
}

function sendDraft(): TxDraft {
  return addOutput(createDraft("d1"), {
    id: "out-1",
    address: OTHER,
    assets: lovelace("2000000"),
  }).draft;
}

/** Body shape `complete()` leaves: resolved inputs, fee, trailing change. */
function builtBody(overrides: Partial<DraftBuildOverlay> = {}): DraftBuildOverlay {
  return {
    inputs: [
      {
        type: "Script",
        txIn: {
          txHash: TX_HASH,
          txIndex: 0,
          address: SELF,
          amount: lovelace("5000000"),
        },
      },
      {
        type: "Script",
        txIn: {
          txHash: TX_HASH,
          txIndex: 3,
          address: SELF,
          amount: [
            { unit: "lovelace", quantity: "1500000" },
            { unit: "policy1token", quantity: "7" },
          ],
        },
      },
    ] as unknown as DraftBuildOverlay["inputs"],
    outputs: [
      { address: OTHER, amount: lovelace("2000000") },
      { address: SELF, amount: lovelace("4320000") },
    ],
    changeAddress: SELF,
    fee: "180000",
    ...overrides,
  };
}

describe("draftToTokenFlow with a built overlay", () => {
  test("adds the fee to the tx card and a Network-fee edge", () => {
    const flow = draftToTokenFlow(sendDraft(), { ...OPTS, built: builtBody() });

    expect(flow.nodes.find((n) => n.kind === "transaction")).toMatchObject({
      id: "txd:d1",
      fee: "180000",
    });
    expect(flow.nodes.find((n) => n.id === "protocol:fee")).toBeDefined();
    expect(flow.edges.find((e) => e.kind === "fee")).toMatchObject({
      id: "txd:d1->protocol:fee:fee",
      source: "txd:d1",
      assets: lovelace("180000"),
    });
  });

  test("replaces auto selection with the body's inputs, one edge per UTxO", () => {
    const flow = draftToTokenFlow(sendDraft(), { ...OPTS, built: builtBody() });

    const inputs = flow.edges.filter((e) => e.kind === "input");
    expect(inputs.find((e) => e.note === "auto selection")).toBeUndefined();
    expect(inputs.map((e) => e.id)).toEqual([
      `addr:${SELF}->txd:d1:input:${TX_HASH}#0`,
      `addr:${SELF}->txd:d1:input:${TX_HASH}#3`,
    ]);
    expect(inputs[1]).toMatchObject({
      source: `addr:${SELF}`,
      target: "txd:d1",
      assets: [
        { unit: "lovelace", quantity: "1500000" },
        { unit: "policy1token", quantity: "7" },
      ],
      note: `${TX_HASH.slice(0, 8)}...${TX_HASH.slice(-4)}#3`,
    });
  });

  test("the body's inputs win over stale manual picks", () => {
    const draft = setUtxoSelection(sendDraft(), {
      mode: "manual",
      utxos: [
        {
          input: { txHash: "a".repeat(64), outputIndex: 9 },
          output: { address: SELF, amount: lovelace("9000000") },
        } as UTxO,
      ],
    });
    const flow = draftToTokenFlow(draft, { ...OPTS, built: builtBody() });

    const inputs = flow.edges.filter((e) => e.kind === "input");
    expect(inputs).toHaveLength(2);
    expect(inputs.every((e) => e.id.includes(TX_HASH))).toBe(true);
  });

  test("fills the change edge from the trailing change outputs, keeping its id", () => {
    const flow = draftToTokenFlow(sendDraft(), {
      ...OPTS,
      built: builtBody({
        outputs: [
          { address: OTHER, amount: lovelace("2000000") },
          // Two change outputs (e.g. token split) are summed.
          { address: SELF, amount: lovelace("4000000") },
          {
            address: SELF,
            amount: [
              { unit: "lovelace", quantity: "320000" },
              { unit: "policy1token", quantity: "7" },
            ],
          },
        ],
      }),
    });

    const change = outputEdges(flow).find((e) => e.note === "change");
    expect(change).toMatchObject({
      id: `txd:d1->addr:${SELF}:output`,
      target: `addr:${SELF}`,
      assets: [
        { unit: "lovelace", quantity: "4320000" },
        { unit: "policy1token", quantity: "7" },
      ],
    });
    // The payment edge is still the draft's own, discriminated by output id.
    expect(outputEdges(flow).find((e) => e.id.endsWith(":output:out-1"))).toMatchObject({
      target: `addr:${OTHER}`,
      assets: lovelace("2000000"),
    });
  });

  test("a body without a change output renders an amount-less 'no change' edge", () => {
    const flow = draftToTokenFlow(sendDraft(), {
      ...OPTS,
      built: builtBody({
        outputs: [{ address: OTHER, amount: lovelace("2000000") }],
      }),
    });

    const change = outputEdges(flow).find((e) => e.target === `addr:${SELF}`);
    expect(change).toMatchObject({ assets: [], note: "no change" });
  });

  test("a self-payment first output is not mistaken for change", () => {
    const draft = addOutput(createDraft("d1"), {
      id: "out-self",
      address: SELF,
      assets: lovelace("3000000"),
    }).draft;
    const flow = draftToTokenFlow(draft, {
      ...OPTS,
      built: builtBody({
        outputs: [
          { address: SELF, amount: lovelace("3000000") },
          { address: SELF, amount: lovelace("3320000") },
        ],
      }),
    });

    expect(outputEdges(flow).find((e) => e.id.endsWith(":output:out-self"))).toMatchObject({
      assets: lovelace("3000000"),
    });
    expect(outputEdges(flow).find((e) => e.note === "change")).toMatchObject({
      assets: lovelace("3320000"),
    });
  });

  test("draft ids are unchanged, so selection mapping still works", () => {
    const draft = sendDraft();
    const plain = draftToTokenFlow(draft, OPTS);
    const built = draftToTokenFlow(draft, { ...OPTS, built: builtBody() });

    const plainOutputIds = outputEdges(plain).map((e) => e.id).sort();
    const builtOutputIds = outputEdges(built).map((e) => e.id).sort();
    expect(builtOutputIds).toEqual(plainOutputIds);
    expect(built.nodes.find((n) => n.id === "txd:d1")).toBeDefined();

    expect(flowIdToDraftEntity(draft, `txd:d1->addr:${OTHER}:output:out-1`)).toEqual({
      kind: "output",
      outputId: "out-1",
    });
    expect(flowIdToDraftEntity(draft, "protocol:fee")).toBeNull();
    expect(flowIdToDraftEntity(draft, "txd:d1->protocol:fee:fee")).toEqual({
      kind: "tx",
    });
  });

  test("a zero or malformed fee adds no fee edge", () => {
    for (const fee of ["0", "", "nope"]) {
      const flow = draftToTokenFlow(sendDraft(), {
        ...OPTS,
        built: builtBody({ fee }),
      });
      expect(flow.edges.find((e) => e.kind === "fee")).toBeUndefined();
      expect(flow.nodes.find((n) => n.kind === "transaction")).not.toHaveProperty(
        "fee",
        expect.anything(),
      );
    }
  });

  test("without an overlay the flow is the plain draft projection", () => {
    const flow = draftToTokenFlow(sendDraft(), { ...OPTS, built: null });

    expect(flow.edges.find((e) => e.kind === "fee")).toBeUndefined();
    expect(flow.edges.find((e) => e.kind === "input")).toMatchObject({
      note: "auto selection",
      assets: [],
    });
    expect(outputEdges(flow).find((e) => e.note === "change")).toMatchObject({
      assets: [],
    });
  });
});

describe("splitTrailingChange", () => {
  const out = (address: string) => ({ address });

  test("takes the trailing run at the change address", () => {
    const outputs = [out(OTHER), out(SELF), out(SELF)];
    expect(splitTrailingChange(outputs, SELF)).toEqual({
      payments: [outputs[0]],
      change: [outputs[1], outputs[2]],
    });
  });

  test("keeps the first output as payment in an all-to-self consolidation", () => {
    const outputs = [out(SELF), out(SELF)];
    expect(splitTrailingChange(outputs, SELF)).toEqual({
      payments: [outputs[0]],
      change: [outputs[1]],
    });
  });

  test("no change address or no trailing match means no change", () => {
    const outputs = [out(SELF), out(OTHER)];
    expect(splitTrailingChange(outputs, "")).toEqual({ payments: outputs, change: [] });
    expect(splitTrailingChange(outputs, SELF)).toEqual({ payments: outputs, change: [] });
    expect(splitTrailingChange([], SELF)).toEqual({ payments: [], change: [] });
  });
});
