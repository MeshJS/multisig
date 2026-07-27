import {
  mergeTokenFlows,
  pendingTxToTokenFlow,
  resolvedInputKey,
} from "@/utils/token-flow";
import type { AddressLabeler, FlowEdge, TokenFlow } from "@/types/token-flow";
import { DREP_DEPOSIT } from "@/utils/protocol-deposit-constants";

const SELF = "addr_test1self";
const OTHER = "addr_test1other";

const labelAddress: AddressLabeler = (address) =>
  address === SELF
    ? { label: "Self (Multisig)", type: "self" }
    : { label: "", type: "unknown" };

function edge(flow: TokenFlow, kind: string): FlowEdge | undefined {
  return flow.edges.find((e) => e.kind === kind);
}

describe("pendingTxToTokenFlow", () => {
  test("outputs plus fully-specified inputs", () => {
    const txJson = {
      inputs: [
        {
          type: "PubKey",
          txIn: {
            txHash: "prev1",
            txIndex: 0,
            address: SELF,
            amount: [{ unit: "lovelace", quantity: "5000000" }],
          },
        },
      ],
      outputs: [
        { address: OTHER, amount: [{ unit: "lovelace", quantity: "2000000" }] },
      ],
      changeAddress: SELF,
      fee: "0",
    };
    const flow = pendingTxToTokenFlow(txJson, { labelAddress, txId: "db-1" });

    expect(flow.nodes.find((n) => n.kind === "transaction")).toMatchObject({
      id: "txp:db-1",
      status: "pending",
      fee: undefined,
    });
    expect(edge(flow, "input")).toMatchObject({
      source: `addr:${SELF}`,
      assets: [{ unit: "lovelace", quantity: "5000000" }],
    });
    const outputs = flow.edges.filter((e) => e.kind === "output");
    expect(outputs).toHaveLength(2); // recipient + change edge
    const changeEdge = outputs.find((e) => e.note === "change");
    expect(changeEdge).toMatchObject({ target: `addr:${SELF}`, assets: [] });
  });

  test("inputs without address/amount resolve via resolvedInputs map", () => {
    const txJson = {
      inputs: [{ type: "PubKey", txIn: { txHash: "prev1", txIndex: 2 } }],
      outputs: [],
    };
    const resolvedInputs = new Map([
      [
        resolvedInputKey("prev1", 2),
        { address: SELF, amount: [{ unit: "lovelace", quantity: "7000000" }] },
      ],
    ]);
    const flow = pendingTxToTokenFlow(txJson, {
      labelAddress,
      txId: "db-1",
      resolvedInputs,
    });
    expect(edge(flow, "input")).toMatchObject({
      source: `addr:${SELF}`,
      assets: [{ unit: "lovelace", quantity: "7000000" }],
    });
    expect(flow.nodes.find((n) => n.id === "addr:unknown-inputs")).toBeUndefined();
  });

  test("unresolvable inputs degrade to a single unresolved node", () => {
    const txJson = {
      inputs: [
        { type: "PubKey", txIn: { txHash: "prev1", txIndex: 0 } },
        { type: "PubKey", txIn: { txHash: "prev2", txIndex: 1 } },
      ],
      outputs: [],
    };
    const flow = pendingTxToTokenFlow(txJson, { labelAddress, txId: "db-1" });
    expect(flow.nodes.find((n) => n.id === "addr:unknown-inputs")).toMatchObject({
      label: "Unresolved inputs (2)",
      partyType: "unknown",
    });
    expect(edge(flow, "input")).toMatchObject({
      source: "addr:unknown-inputs",
      assets: [],
      note: "unknown amount",
    });
  });

  test("DRep registration emits badge and deposit edge from cert coin", () => {
    const txJson = {
      inputs: [],
      outputs: [],
      certificates: [
        {
          type: "BasicCertificate",
          certType: { type: "DRepRegistration", drepId: "drep1abc", coin: 500000000 },
        },
      ],
    };
    const flow = pendingTxToTokenFlow(txJson, { labelAddress, txId: "db-1" });
    const txNode = flow.nodes.find((n) => n.kind === "transaction") as any;
    expect(txNode.badges).toEqual([
      expect.objectContaining({ kind: "certificate", label: "DRep Registration" }),
    ]);
    expect(edge(flow, "deposit")).toMatchObject({
      target: "protocol:deposit",
      assets: [{ unit: "lovelace", quantity: "500000000" }],
    });
  });

  test("DRep registration without coin falls back to DREP_DEPOSIT; deregistration refunds", () => {
    const regFlow = pendingTxToTokenFlow(
      {
        certificates: [
          { type: "BasicCertificate", certType: { type: "DRepRegistration", drepId: "drep1abc" } },
        ],
      },
      { labelAddress, txId: "db-1" },
    );
    expect(edge(regFlow, "deposit")).toMatchObject({
      assets: [{ unit: "lovelace", quantity: DREP_DEPOSIT.toString() }],
    });

    const deregFlow = pendingTxToTokenFlow(
      {
        certificates: [
          {
            type: "BasicCertificate",
            certType: { type: "DRepDeregistration", drepId: "drep1abc", coin: 500000000 },
          },
        ],
      },
      { labelAddress, txId: "db-2" },
    );
    expect(edge(deregFlow, "deposit-refund")).toMatchObject({
      source: "protocol:deposit",
      assets: [{ unit: "lovelace", quantity: "500000000" }],
    });
  });

  test("votes become badges without value edges", () => {
    const txJson = {
      votes: [
        {
          type: "BasicVote",
          vote: {
            voter: { type: "DRep", drepId: "drep1abc" },
            govActionId: { txHash: "aabbccddeeff00112233", txIndex: 3 },
            votingProcedure: { voteKind: "Yes" },
          },
        },
      ],
    };
    const flow = pendingTxToTokenFlow(txJson, { labelAddress, txId: "db-1" });
    const txNode = flow.nodes.find((n) => n.kind === "transaction") as any;
    expect(txNode.badges).toEqual([
      expect.objectContaining({ kind: "vote", label: "Vote: Yes" }),
    ]);
    expect(flow.edges).toHaveLength(0);
  });

  test("mints and burns from txJson.mints", () => {
    const txJson = {
      mints: [
        {
          type: "Native",
          policyId: "policy1",
          mintValue: [
            { assetName: "746f6b656e", amount: "25" },
            { assetName: "676f6e65", amount: "-5" },
          ],
        },
      ],
    };
    const flow = pendingTxToTokenFlow(txJson, { labelAddress, txId: "db-1" });
    expect(edge(flow, "mint")).toMatchObject({
      assets: [{ unit: "policy1746f6b656e", quantity: "25" }],
    });
    expect(edge(flow, "burn")).toMatchObject({
      assets: [{ unit: "policy1676f6e65", quantity: "5" }],
    });
  });

  test("withdrawals from txJson.withdrawals", () => {
    const flow = pendingTxToTokenFlow(
      {
        withdrawals: [
          { type: "PubKeyWithdrawal", address: "stake_test1xyz", coin: "1234567" },
        ],
      },
      { labelAddress, txId: "db-1" },
    );
    expect(edge(flow, "withdrawal")).toMatchObject({
      source: "stake:stake_test1xyz",
      assets: [{ unit: "lovelace", quantity: "1234567" }],
    });
  });

  test("null txJson still returns a valid flow with just the tx node", () => {
    const flow = pendingTxToTokenFlow(null, { labelAddress, txId: "db-1" });
    expect(flow.nodes).toHaveLength(1);
    expect(flow.edges).toHaveLength(0);
  });
});

describe("mergeTokenFlows", () => {
  test("dedupes shared address nodes and keeps labeled copy", () => {
    const flowA: TokenFlow = {
      nodes: [
        { id: `addr:${SELF}`, kind: "address", address: SELF, partyType: "unknown" },
        { id: "tx:a", kind: "transaction", status: "onchain", badges: [] },
      ],
      edges: [
        { id: `addr:${SELF}->tx:a:input`, source: `addr:${SELF}`, target: "tx:a", kind: "input", assets: [] },
      ],
    };
    const flowB: TokenFlow = {
      nodes: [
        {
          id: `addr:${SELF}`,
          kind: "address",
          address: SELF,
          label: "Self (Multisig)",
          partyType: "self",
        },
        { id: "tx:b", kind: "transaction", status: "onchain", badges: [] },
      ],
      edges: [
        { id: `tx:b->addr:${SELF}:output`, source: "tx:b", target: `addr:${SELF}`, kind: "output", assets: [] },
      ],
    };
    const merged = mergeTokenFlows([flowA, flowB]);
    const addressNodes = merged.nodes.filter((n) => n.kind === "address");
    expect(addressNodes).toHaveLength(1);
    expect(addressNodes[0]).toMatchObject({ partyType: "self", label: "Self (Multisig)" });
    expect(merged.edges).toHaveLength(2);
  });

  test("merging the same flow twice does not duplicate edges", () => {
    const flow: TokenFlow = {
      nodes: [{ id: "tx:a", kind: "transaction", status: "onchain", badges: [] }],
      edges: [
        { id: "tx:a->protocol:fee:fee", source: "tx:a", target: "protocol:fee", kind: "fee", assets: [] },
      ],
    };
    const merged = mergeTokenFlows([flow, flow]);
    expect(merged.edges).toHaveLength(1);
    expect(merged.nodes).toHaveLength(1);
  });
});
