import { describe, expect, it } from "@jest/globals";

import type { AddressLabeler } from "@/types/token-flow";
import {
  FlowGraphBuilder,
  assetMapToList,
  lovelace,
  sumAssets,
} from "@/utils/token-flow/graph-builder";

const labeler: AddressLabeler = (address) =>
  address.startsWith("addr_test1signer")
    ? { label: `Signer ${address.slice(-1)}`, type: "signer" }
    : { label: "", type: "unknown" };

describe("sumAssets", () => {
  it("accumulates quantities per unit", () => {
    const map = new Map<string, bigint>();
    sumAssets(map, [
      { unit: "lovelace", quantity: "1000000" },
      { unit: "lovelace", quantity: "500000" },
      { unit: "token.a", quantity: "3" },
    ]);
    expect(map.get("lovelace")).toBe(1500000n);
    expect(map.get("token.a")).toBe(3n);
  });

  it("subtracts with a negative sign", () => {
    const map = new Map<string, bigint>([["lovelace", 1000000n]]);
    sumAssets(map, [{ unit: "lovelace", quantity: "400000" }], -1n);
    expect(map.get("lovelace")).toBe(600000n);
  });

  it("skips unparseable quantities and entries without a unit", () => {
    const map = new Map<string, bigint>();
    sumAssets(map, [
      { unit: "lovelace", quantity: "not-a-bigint" },
      { unit: "", quantity: "5" },
      { unit: "token.a", quantity: "2" },
    ]);
    expect(map.has("lovelace")).toBe(false);
    expect(map.size).toBe(1);
    expect(map.get("token.a")).toBe(2n);
  });

  it("tolerates an undefined asset list", () => {
    const map = new Map<string, bigint>();
    expect(() => sumAssets(map, undefined)).not.toThrow();
    expect(map.size).toBe(0);
  });
});

describe("assetMapToList", () => {
  it("puts lovelace first, sorts the rest by unit, and drops zero entries", () => {
    const map = new Map<string, bigint>([
      ["zz.token", 1n],
      ["aa.token", 2n],
      ["gone", 0n],
      ["lovelace", 3n],
    ]);
    expect(assetMapToList(map)).toEqual([
      { unit: "lovelace", quantity: "3" },
      { unit: "aa.token", quantity: "2" },
      { unit: "zz.token", quantity: "1" },
    ]);
  });

  it("keeps negative balances (burns) as signed strings", () => {
    const map = new Map<string, bigint>([["token.a", -7n]]);
    expect(assetMapToList(map)).toEqual([{ unit: "token.a", quantity: "-7" }]);
  });
});

describe("lovelace", () => {
  it("wraps a quantity string or bigint as a single-asset list", () => {
    expect(lovelace("123")).toEqual([{ unit: "lovelace", quantity: "123" }]);
    expect(lovelace(456n)).toEqual([{ unit: "lovelace", quantity: "456" }]);
  });
});

describe("FlowGraphBuilder", () => {
  it("labels address nodes through the injected labeler", () => {
    const builder = new FlowGraphBuilder(labeler);
    const node = builder.addressNode("addr_test1signer1");
    expect(node).toEqual({
      id: "addr:addr_test1signer1",
      kind: "address",
      address: "addr_test1signer1",
      label: "Signer 1",
      partyType: "signer",
    });
  });

  it("reuses an existing address node instead of relabeling", () => {
    let calls = 0;
    const countingLabeler: AddressLabeler = (address) => {
      calls += 1;
      return labeler(address);
    };
    const builder = new FlowGraphBuilder(countingLabeler);
    const first = builder.addressNode("addr_test1signer1");
    const second = builder.addressNode("addr_test1signer1");
    expect(second).toBe(first);
    expect(calls).toBe(1);
    expect(builder.build().nodes).toHaveLength(1);
  });

  it("supports an explicit id prefix and party type override", () => {
    const builder = new FlowGraphBuilder(labeler);
    const node = builder.addressNode("stake_test1xyz", {
      idPrefix: "stake",
      partyType: "reward",
    });
    expect(node.id).toBe("stake:stake_test1xyz");
    expect(node.partyType).toBe("reward");
    expect(node.label).toBeUndefined();
  });

  it("creates each protocol node once with its role label", () => {
    const builder = new FlowGraphBuilder(labeler);
    const fee = builder.protocolNode("fee");
    expect(fee).toEqual({
      id: "protocol:fee",
      kind: "protocol",
      role: "fee",
      label: "Network fee",
    });
    expect(builder.protocolNode("fee")).toBe(fee);
    expect(builder.protocolNode("deposit").label).toBe("Protocol deposit");
    expect(builder.protocolNode("mint").label).toBe("Mint / Burn");
    expect(builder.build().nodes).toHaveLength(3);
  });

  it("aggregates assets on edges sharing (source, target, kind)", () => {
    const builder = new FlowGraphBuilder(labeler);
    builder.addEdge("a", "b", "input", lovelace("1000000"));
    builder.addEdge("a", "b", "input", lovelace("500000"));

    const { edges } = builder.build();
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      id: "a->b:input",
      source: "a",
      target: "b",
      kind: "input",
      assets: [{ unit: "lovelace", quantity: "1500000" }],
    });
  });

  it("keeps discriminated edges separate for per-input-UTxO rendering", () => {
    const builder = new FlowGraphBuilder(labeler);
    builder.addEdge("a", "b", "input", lovelace("1000000"), undefined, "tx0#0");
    builder.addEdge("a", "b", "input", lovelace("500000"), undefined, "tx0#1");

    const { edges } = builder.build();
    expect(edges.map((edge) => edge.id).sort()).toEqual([
      "a->b:input:tx0#0",
      "a->b:input:tx0#1",
    ]);
    expect(edges.map((edge) => edge.assets)).toEqual([
      [{ unit: "lovelace", quantity: "1000000" }],
      [{ unit: "lovelace", quantity: "500000" }],
    ]);
  });

  it("keeps the first note and lets a later non-empty note overwrite it", () => {
    const builder = new FlowGraphBuilder(labeler);
    builder.addEdge("a", "b", "input", [], "first note");
    builder.addEdge("a", "b", "input", []);
    expect(builder.build().edges[0]!.note).toBe("first note");

    builder.addEdge("a", "b", "input", [], "second note");
    expect(builder.build().edges[0]!.note).toBe("second note");
  });

  it("builds a complete flow with explicit nodes and empty-asset edges intact", () => {
    const builder = new FlowGraphBuilder(labeler);
    builder.addNode({
      id: "tx:0",
      kind: "transaction",
      status: "pending",
      label: "Tx",
      badges: [],
    });
    builder.addressNode("addr_test1signer2");
    builder.addEdge("tx:0", "addr:addr_test1signer2", "output", []);

    const flow = builder.build();
    expect(flow.nodes.map((node) => node.id)).toEqual([
      "tx:0",
      "addr:addr_test1signer2",
    ]);
    expect(flow.edges[0]!.assets).toEqual([]);
  });
});
