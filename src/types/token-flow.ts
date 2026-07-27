/**
 * Source-agnostic graph model for visualizing token flow through one or more
 * Cardano transactions. The graph is bipartite: address nodes connect to
 * transaction nodes, never address-to-address — UTxO semantics make direct
 * address-to-address attribution ambiguous, and non-UTxO effects (fee,
 * deposits, withdrawals, mints, certificates, votes) belong to the
 * transaction itself.
 *
 * Node ids are globally stable ("addr:<bech32>", "tx:<hash>", ...) so flows
 * from N transactions can be merged into one graph via `mergeTokenFlows` —
 * the composition primitive for the future drag-drop transaction builder.
 */

export type AssetQuantity = {
  unit: string; // "lovelace" | policyId + hex asset name
  quantity: string; // stringified integer, BigInt-safe; may be negative in deltas
};

export type AddressPartyType =
  | "self" // the multisig wallet address
  | "signer"
  | "contact"
  | "script"
  | "reward" // stake/reward account (withdrawal source)
  | "unknown";

export type FlowBadge = {
  kind: "certificate" | "vote";
  label: string;
  detail?: string;
  /** Tailwind text color class, matching existing certificate conventions. */
  color?: string;
};

export type AddressFlowNode = {
  id: string; // "addr:<bech32>" | "stake:<bech32>" | "addr:unknown-inputs"
  kind: "address";
  address: string;
  label?: string;
  partyType: AddressPartyType;
};

export type TransactionFlowNode = {
  id: string; // "tx:<hash>" | "txp:<prismaTxId>"
  kind: "transaction";
  txHash?: string; // undefined while pending
  status: "onchain" | "pending";
  label?: string; // e.g. dbTransaction.description
  fee?: string; // lovelace
  deposit?: string; // net deposit in lovelace; negative = refund
  badges: FlowBadge[];
};

export type ProtocolFlowNode = {
  id: string; // "protocol:fee" | "protocol:deposit" | "protocol:mint"
  kind: "protocol";
  role: "fee" | "deposit" | "mint";
  label: string;
};

export type FlowNode = AddressFlowNode | TransactionFlowNode | ProtocolFlowNode;

export type FlowEdgeKind =
  | "input" // address -> tx
  | "output" // tx -> address
  | "fee" // tx -> protocol:fee
  | "withdrawal" // stake address -> tx
  | "deposit" // tx -> protocol:deposit
  | "deposit-refund" // protocol:deposit -> tx
  | "mint" // protocol:mint -> tx
  | "burn"; // tx -> protocol:mint

export type FlowEdge = {
  id: string; // `${source}->${target}:${kind}`
  source: string;
  target: string;
  kind: FlowEdgeKind;
  /** Aggregated per (source, target, kind); summed by unit. */
  assets: AssetQuantity[];
  /** Short annotation when assets are unknown or special, e.g. "change". */
  note?: string;
};

export type TokenFlow = {
  nodes: FlowNode[];
  edges: FlowEdge[];
};

/** Resolves an address to a display label; injected so adapters stay pure. */
export type AddressLabeler = (address: string) => {
  label: string;
  type: AddressPartyType;
};
