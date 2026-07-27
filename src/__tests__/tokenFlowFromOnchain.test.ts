import { onChainTxToTokenFlow } from "@/utils/token-flow";
import type { TxFlowData, BlockfrostTxInfo } from "@/types/blockfrost";
import type { AddressLabeler, FlowEdge, TokenFlow } from "@/types/token-flow";

const SELF = "addr_test1self";
const OTHER = "addr_test1other";
const STAKE = "stake_test1reward";

const labelAddress: AddressLabeler = (address) =>
  address === SELF
    ? { label: "Self (Multisig)", type: "self" }
    : { label: "", type: "unknown" };

function baseInfo(overrides: Partial<BlockfrostTxInfo> = {}): BlockfrostTxInfo {
  return {
    hash: "abc123",
    block_time: 1700000000,
    fee: "200000",
    deposit: "0",
    valid_contract: true,
    withdrawal_count: 0,
    delegation_count: 0,
    stake_cert_count: 0,
    pool_update_count: 0,
    pool_retire_count: 0,
    asset_mint_or_burn_count: 0,
    redeemer_count: 0,
    ...overrides,
  };
}

function input(
  address: string,
  amount: { unit: string; quantity: string }[],
  flags: Partial<{ collateral: boolean; reference: boolean }> = {},
) {
  return {
    address,
    amount,
    output_index: 0,
    tx_hash: "prev",
    collateral: flags.collateral ?? false,
    reference: flags.reference ?? false,
    data_hash: null,
  };
}

function output(
  address: string,
  amount: { unit: string; quantity: string }[],
  collateral = false,
) {
  return { address, amount, output_index: 0, data_hash: null, collateral };
}

function edge(flow: TokenFlow, kind: string): FlowEdge | undefined {
  return flow.edges.find((e) => e.kind === kind);
}

describe("onChainTxToTokenFlow", () => {
  test("simple payment: input, outputs, fee edges", () => {
    const data: TxFlowData = {
      info: baseInfo(),
      utxos: {
        hash: "abc123",
        inputs: [input(SELF, [{ unit: "lovelace", quantity: "5000000" }])],
        outputs: [
          output(OTHER, [{ unit: "lovelace", quantity: "2000000" }]),
          output(SELF, [{ unit: "lovelace", quantity: "2800000" }]),
        ],
      },
    };
    const flow = onChainTxToTokenFlow(data, { labelAddress });

    const txNode = flow.nodes.find((n) => n.kind === "transaction");
    expect(txNode).toMatchObject({ id: "tx:abc123", status: "onchain", fee: "200000" });

    expect(edge(flow, "input")).toMatchObject({
      source: `addr:${SELF}`,
      target: "tx:abc123",
      assets: [{ unit: "lovelace", quantity: "5000000" }],
    });
    expect(flow.edges.filter((e) => e.kind === "output")).toHaveLength(2);
    expect(edge(flow, "fee")).toMatchObject({
      target: "protocol:fee",
      assets: [{ unit: "lovelace", quantity: "200000" }],
    });
    const selfNode = flow.nodes.find((n) => n.id === `addr:${SELF}`);
    expect(selfNode).toMatchObject({ label: "Self (Multisig)", partyType: "self" });
  });

  test("aggregates multiple UTxOs from the same address into one edge", () => {
    const data: TxFlowData = {
      info: baseInfo(),
      utxos: {
        hash: "abc123",
        inputs: [
          input(SELF, [{ unit: "lovelace", quantity: "1000000" }]),
          input(SELF, [
            { unit: "lovelace", quantity: "2000000" },
            { unit: "policy1asset1", quantity: "5" },
          ]),
        ],
        outputs: [output(OTHER, [{ unit: "lovelace", quantity: "2800000" }])],
      },
    };
    const flow = onChainTxToTokenFlow(data, { labelAddress });
    const inputs = flow.edges.filter((e) => e.kind === "input");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]!.assets).toEqual([
      { unit: "lovelace", quantity: "3000000" },
      { unit: "policy1asset1", quantity: "5" },
    ]);
  });

  test("skips collateral and reference inputs on a successful script tx", () => {
    const data: TxFlowData = {
      info: baseInfo({ redeemer_count: 1 }),
      utxos: {
        hash: "abc123",
        inputs: [
          input(SELF, [{ unit: "lovelace", quantity: "5000000" }]),
          input(SELF, [{ unit: "lovelace", quantity: "3000000" }], { collateral: true }),
          input(OTHER, [{ unit: "lovelace", quantity: "9000000" }], { reference: true }),
        ],
        outputs: [
          output(OTHER, [{ unit: "lovelace", quantity: "4800000" }]),
          output(SELF, [{ unit: "lovelace", quantity: "3000000" }], true),
        ],
      },
    };
    const flow = onChainTxToTokenFlow(data, { labelAddress });
    const inputEdge = edge(flow, "input");
    expect(inputEdge!.assets).toEqual([{ unit: "lovelace", quantity: "5000000" }]);
    const outputEdges = flow.edges.filter((e) => e.kind === "output");
    expect(outputEdges).toHaveLength(1);
    expect(outputEdges[0]!.target).toBe(`addr:${OTHER}`);
  });

  test("withdrawal edge from stake address", () => {
    const data: TxFlowData = {
      info: baseInfo({ withdrawal_count: 1 }),
      utxos: {
        hash: "abc123",
        inputs: [input(SELF, [{ unit: "lovelace", quantity: "1000000" }])],
        outputs: [output(SELF, [{ unit: "lovelace", quantity: "10300000" }])],
      },
      withdrawals: [{ address: STAKE, amount: "9500000" }],
    };
    const flow = onChainTxToTokenFlow(data, { labelAddress });
    expect(edge(flow, "withdrawal")).toMatchObject({
      source: `stake:${STAKE}`,
      target: "tx:abc123",
      assets: [{ unit: "lovelace", quantity: "9500000" }],
    });
    expect(flow.nodes.find((n) => n.id === `stake:${STAKE}`)).toMatchObject({
      partyType: "reward",
    });
  });

  test("deposit edge and refund edge from info.deposit", () => {
    const depositFlow = onChainTxToTokenFlow(
      {
        info: baseInfo({ deposit: "500000000", stake_cert_count: 1 }),
        utxos: { hash: "abc123", inputs: [], outputs: [] },
        stakes: [{ cert_index: 0, address: STAKE, registration: true }],
      },
      { labelAddress },
    );
    expect(edge(depositFlow, "deposit")).toMatchObject({
      target: "protocol:deposit",
      assets: [{ unit: "lovelace", quantity: "500000000" }],
    });
    const txNode = depositFlow.nodes.find((n) => n.kind === "transaction");
    expect(txNode).toMatchObject({ deposit: "500000000" });
    expect((txNode as any).badges).toEqual([
      expect.objectContaining({ label: "Stake Registration" }),
    ]);

    const refundFlow = onChainTxToTokenFlow(
      {
        info: baseInfo({ deposit: "-500000000" }),
        utxos: { hash: "abc123", inputs: [], outputs: [] },
      },
      { labelAddress },
    );
    expect(edge(refundFlow, "deposit-refund")).toMatchObject({
      source: "protocol:deposit",
      assets: [{ unit: "lovelace", quantity: "500000000" }],
    });
  });

  test("mint and burn derived by mass balance, excluding lovelace", () => {
    const data: TxFlowData = {
      info: baseInfo({ asset_mint_or_burn_count: 2 }),
      utxos: {
        hash: "abc123",
        inputs: [
          input(SELF, [
            { unit: "lovelace", quantity: "5000000" },
            { unit: "policyBURNME", quantity: "10" },
          ]),
        ],
        outputs: [
          output(SELF, [
            { unit: "lovelace", quantity: "4800000" },
            { unit: "policyMINTED", quantity: "100" },
            { unit: "policyBURNME", quantity: "4" },
          ]),
        ],
      },
    };
    const flow = onChainTxToTokenFlow(data, { labelAddress });
    expect(edge(flow, "mint")).toMatchObject({
      source: "protocol:mint",
      assets: [{ unit: "policyMINTED", quantity: "100" }],
    });
    expect(edge(flow, "burn")).toMatchObject({
      target: "protocol:mint",
      assets: [{ unit: "policyBURNME", quantity: "6" }],
    });
  });

  test("delegation badge appears on the tx node", () => {
    const flow = onChainTxToTokenFlow(
      {
        info: baseInfo({ delegation_count: 1 }),
        utxos: { hash: "abc123", inputs: [], outputs: [] },
        delegations: [{ index: 0, cert_index: 0, address: STAKE, pool_id: "pool1xyz" }],
      },
      { labelAddress },
    );
    const txNode = flow.nodes.find((n) => n.kind === "transaction") as any;
    expect(txNode.badges).toEqual([
      expect.objectContaining({ kind: "certificate", label: "Stake Delegation" }),
    ]);
  });
});
