import type { UTxO } from "@meshsdk/core";

import { addOutput, addVote, createDraft, setUtxoSelection } from "@/lib/tx-draft/mutations";
import type { AddressLabeler, TokenFlow } from "@/types/token-flow";
import type { TxDraft } from "@/types/tx-draft";
import { draftToTokenFlow, flowIdToDraftEntity } from "@/utils/token-flow";

const SELF = "addr_test1self";
const OTHER = "addr_test1other";

const labelAddress: AddressLabeler = (address) =>
  address === SELF
    ? { label: "Self (Multisig)", type: "self" }
    : { label: "", type: "unknown" };

const OPTS = { labelAddress, walletAddress: SELF };

function outputEdges(flow: TokenFlow) {
  return flow.edges.filter((e) => e.kind === "output");
}

function utxo(index: number, quantity: string): UTxO {
  return {
    input: { txHash: "f".repeat(64), outputIndex: index },
    output: {
      address: SELF,
      amount: [{ unit: "lovelace", quantity }],
    },
  } as UTxO;
}

describe("draftToTokenFlow", () => {
  test("empty auto-mode draft renders tx card, auto input and change edge", () => {
    const flow = draftToTokenFlow(createDraft("d1"), OPTS);

    expect(flow.nodes.find((n) => n.kind === "transaction")).toMatchObject({
      id: "txd:d1",
      status: "pending",
      label: "New transaction",
    });
    const input = flow.edges.find((e) => e.kind === "input");
    expect(input).toMatchObject({
      source: `addr:${SELF}`,
      target: "txd:d1",
      assets: [],
      note: "auto selection",
    });
    const change = outputEdges(flow).find((e) => e.note === "change");
    expect(change).toMatchObject({ target: `addr:${SELF}`, assets: [] });
  });

  test("placed and placeholder outputs render discriminated edges", () => {
    let { draft } = addOutput(createDraft("d1"), {
      id: "out-1",
      address: OTHER,
      assets: [{ unit: "lovelace", quantity: "2000000" }],
    });
    ({ draft } = addOutput(draft, { id: "out-2" })); // no address yet

    const flow = draftToTokenFlow(draft, OPTS);

    expect(flow.edges.find((e) => e.id.endsWith(":output:out-1"))).toMatchObject(
      {
        source: "txd:d1",
        target: `addr:${OTHER}`,
        assets: [{ unit: "lovelace", quantity: "2000000" }],
      },
    );
    expect(flow.nodes.find((n) => n.id === "draftout:out-2")).toMatchObject({
      kind: "address",
      label: "Set recipient",
      partyType: "unknown",
    });
    expect(flow.edges.find((e) => e.id.endsWith(":output:out-2"))).toMatchObject(
      { target: "draftout:out-2", assets: [], note: "no amount" },
    );
  });

  test("two outputs to the same address stay separate edges", () => {
    let { draft } = addOutput(createDraft("d1"), {
      id: "out-1",
      address: OTHER,
      assets: [{ unit: "lovelace", quantity: "1000000" }],
    });
    ({ draft } = addOutput(draft, {
      id: "out-2",
      address: OTHER,
      assets: [{ unit: "lovelace", quantity: "3000000" }],
    }));

    const flow = draftToTokenFlow(draft, OPTS);
    const toOther = outputEdges(flow).filter((e) => e.target === `addr:${OTHER}`);
    expect(toOther).toHaveLength(2);
    expect(toOther.map((e) => e.assets[0]!.quantity).sort()).toEqual([
      "1000000",
      "3000000",
    ]);
  });

  test("manual UTxO selection renders per-input edges matching from-pending conventions", () => {
    const draft = setUtxoSelection(createDraft("d1"), {
      mode: "manual",
      utxos: [utxo(0, "5000000"), utxo(1, "7000000")],
    });
    const flow = draftToTokenFlow(draft, OPTS);
    const inputs = flow.edges.filter((e) => e.kind === "input");
    expect(inputs).toHaveLength(2);
    expect(inputs.map((e) => e.id)).toEqual([
      `addr:${SELF}->txd:d1:input:${"f".repeat(64)}#0`,
      `addr:${SELF}->txd:d1:input:${"f".repeat(64)}#1`,
    ]);
    expect(inputs[0]!.note).toMatch(/#0$/);
  });

  test("change always returns to the wallet address", () => {
    const flow = draftToTokenFlow(createDraft("d1"), OPTS);
    const change = outputEdges(flow).find((e) => e.note === "change");
    expect(change).toMatchObject({ target: `addr:${SELF}` });
  });
});

describe("flowIdToDraftEntity", () => {
  let draft: TxDraft;
  beforeEach(() => {
    ({ draft } = addOutput(createDraft("d1"), {
      id: "out-1",
      address: OTHER,
      assets: [{ unit: "lovelace", quantity: "2000000" }],
    }));
    ({ draft } = addOutput(draft, { id: "out-2" }));
  });

  test("maps node ids, stripping layout instance suffixes", () => {
    expect(flowIdToDraftEntity(draft, "txd:d1")).toEqual({ kind: "tx" });
    expect(flowIdToDraftEntity(draft, `addr:${OTHER}`)).toEqual({
      kind: "output",
      outputId: "out-1",
    });
    expect(flowIdToDraftEntity(draft, `addr:${OTHER}@out`)).toEqual({
      kind: "output",
      outputId: "out-1",
    });
    expect(flowIdToDraftEntity(draft, "draftout:out-2@out")).toEqual({
      kind: "output",
      outputId: "out-2",
    });
    // Input-side wallet node resolves to the tx (its inputs live there).
    expect(flowIdToDraftEntity(draft, `addr:${SELF}@in`)).toEqual({
      kind: "tx",
    });
    expect(flowIdToDraftEntity(draft, "draftout:gone")).toBeNull();
    expect(flowIdToDraftEntity(draft, "protocol:fee")).toBeNull();
  });

  test("maps edge ids via the output discriminator", () => {
    const flow = draftToTokenFlow(draft, OPTS);
    const outEdge = flow.edges.find((e) => e.id.endsWith(":output:out-1"))!;
    expect(flowIdToDraftEntity(draft, outEdge.id)).toEqual({
      kind: "output",
      outputId: "out-1",
    });
    const changeEdge = flow.edges.find((e) => e.note === "change")!;
    expect(flowIdToDraftEntity(draft, changeEdge.id)).toEqual({ kind: "tx" });
    const inputEdge = flow.edges.find((e) => e.kind === "input")!;
    expect(flowIdToDraftEntity(draft, inputEdge.id)).toEqual({ kind: "tx" });
  });
});

describe("draftToTokenFlow votes", () => {
  const GOV_HASH = "c".repeat(64);

  function withVote(kind: "Yes" | "No" | "Abstain" = "Yes") {
    return addVote(createDraft("d1"), {
      id: "v-1",
      govActionTxHash: GOV_HASH,
      govActionIndex: 3,
      voteKind: kind,
    }).draft;
  }

  test("draft votes become badges on the tx node", () => {
    const flow = draftToTokenFlow(withVote("No"), OPTS);
    const txNode = flow.nodes.find((n) => n.kind === "transaction") as any;
    expect(txNode.badges).toEqual([
      expect.objectContaining({
        kind: "vote",
        label: "Vote: No",
        color: "text-red-500 dark:text-red-400",
      }),
    ]);
    expect(txNode.badges[0].title).toBeUndefined();
  });

  test("resolveProposalTitle populates the badge title", () => {
    const flow = draftToTokenFlow(withVote(), {
      ...OPTS,
      resolveProposalTitle: (pid) =>
        pid === `${GOV_HASH}#3` ? "Treasury Withdrawal Q3" : undefined,
    });
    const txNode = flow.nodes.find((n) => n.kind === "transaction") as any;
    expect(txNode.badges[0].title).toBe("Treasury Withdrawal Q3");
  });

  test("vote-only draft still renders the auto input and change edges", () => {
    const flow = draftToTokenFlow(withVote(), OPTS);
    expect(flow.edges.find((e) => e.kind === "input")).toMatchObject({
      note: "auto selection",
    });
    expect(
      outputEdges(flow).find((e) => e.note === "change"),
    ).toBeDefined();
  });
});
