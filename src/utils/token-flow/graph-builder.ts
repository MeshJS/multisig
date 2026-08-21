import type {
  AddressFlowNode,
  AddressLabeler,
  AddressPartyType,
  AssetQuantity,
  FlowEdge,
  FlowEdgeKind,
  FlowNode,
  ProtocolFlowNode,
  TokenFlow,
} from "@/types/token-flow";

export function sumAssets(
  into: Map<string, bigint>,
  assets: { unit: string; quantity: string }[] | undefined,
  sign: 1n | -1n = 1n,
): void {
  if (!assets) return;
  for (const asset of assets) {
    if (!asset?.unit) continue;
    let quantity: bigint;
    try {
      quantity = BigInt(asset.quantity);
    } catch {
      continue;
    }
    into.set(asset.unit, (into.get(asset.unit) ?? 0n) + sign * quantity);
  }
}

/** Deterministic order: lovelace first, then by unit; zero entries dropped. */
export function assetMapToList(map: Map<string, bigint>): AssetQuantity[] {
  return [...map.entries()]
    .filter(([, quantity]) => quantity !== 0n)
    .sort(([a], [b]) =>
      a === "lovelace" ? -1 : b === "lovelace" ? 1 : a < b ? -1 : 1,
    )
    .map(([unit, quantity]) => ({ unit, quantity: quantity.toString() }));
}

export function lovelace(quantity: string | bigint): AssetQuantity[] {
  return [{ unit: "lovelace", quantity: quantity.toString() }];
}

/**
 * Accumulates nodes and aggregated edges for one TokenFlow. Nodes are keyed
 * by id; edge assets are summed per (source, target, kind).
 */
export class FlowGraphBuilder {
  private nodes = new Map<string, FlowNode>();
  private edgeAssets = new Map<string, Map<string, bigint>>();
  private edgeMeta = new Map<
    string,
    { source: string; target: string; kind: FlowEdgeKind; note?: string }
  >();

  constructor(private labelAddress: AddressLabeler) {}

  addNode(node: FlowNode): void {
    this.nodes.set(node.id, node);
  }

  /** Adds (or reuses) an address node labeled via the injected labeler. */
  addressNode(
    address: string,
    opts?: { idPrefix?: "addr" | "stake"; partyType?: AddressPartyType },
  ): AddressFlowNode {
    const id = `${opts?.idPrefix ?? "addr"}:${address}`;
    const existing = this.nodes.get(id);
    if (existing?.kind === "address") return existing;
    const resolved = this.labelAddress(address);
    const node: AddressFlowNode = {
      id,
      kind: "address",
      address,
      label: resolved.label || undefined,
      partyType: opts?.partyType ?? resolved.type,
    };
    this.nodes.set(id, node);
    return node;
  }

  protocolNode(role: ProtocolFlowNode["role"]): ProtocolFlowNode {
    const id = `protocol:${role}`;
    const existing = this.nodes.get(id);
    if (existing?.kind === "protocol") return existing;
    const labels: Record<ProtocolFlowNode["role"], string> = {
      fee: "Network fee",
      deposit: "Protocol deposit",
      mint: "Mint / Burn",
    };
    const node: ProtocolFlowNode = {
      id,
      kind: "protocol",
      role,
      label: labels[role],
    };
    this.nodes.set(id, node);
    return node;
  }

  /**
   * `discriminator` opts an edge out of (source, target, kind) aggregation
   * by extending the id — used for one-edge-per-input-UTxO rendering. Must
   * be deterministic (e.g. `txHash#index`) so `mergeTokenFlows` dedupe holds.
   */
  addEdge(
    source: string,
    target: string,
    kind: FlowEdgeKind,
    assets: { unit: string; quantity: string }[],
    note?: string,
    discriminator?: string,
  ): void {
    const id =
      `${source}->${target}:${kind}` + (discriminator ? `:${discriminator}` : "");
    if (!this.edgeMeta.has(id)) {
      this.edgeMeta.set(id, { source, target, kind, note });
      this.edgeAssets.set(id, new Map());
    } else if (note) {
      this.edgeMeta.get(id)!.note = note;
    }
    sumAssets(this.edgeAssets.get(id)!, assets);
  }

  build(): TokenFlow {
    const edges: FlowEdge[] = [...this.edgeMeta.entries()].map(
      ([id, meta]) => ({
        id,
        ...meta,
        assets: assetMapToList(this.edgeAssets.get(id)!),
      }),
    );
    return { nodes: [...this.nodes.values()], edges };
  }
}
