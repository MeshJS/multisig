export type UtxoRef = { txHash: string; outputIndex: number };

export type ScriptUtxo = {
  input: UtxoRef;
  output: { address: string; amount: { unit: string; quantity: string }[] };
};

export type ProxyLifecycleUtxoShapeStatus =
  | "pass"
  | "needs-split"
  | "insufficient-total"
  | "insufficient-selectable"
  | "insufficient-shape";

export const DREP_REGISTER_REQUIRED_LOVELACE = 505_000_000n;
export const LIFECYCLE_PROXY_LOVELACE = 10_000_000n;
export const FULL_LIFECYCLE_FEE_BUFFER_LOVELACE = 20_000_000n;
export const SETUP_UTXO_REQUIRED_LOVELACE = 20_000_000n;
export const COLLATERAL_REQUIRED_LOVELACE = 5_000_000n;
export const PROXY_SPEND_LOVELACE = 1_000_000n;
export const PROXY_LIFECYCLE_COLLATERAL_SPLIT_LOVELACE = 6_000_000n;
export const SELF_SPLIT_FEE_BUFFER_LOVELACE = 2_000_000n;
export const PROXY_FULL_LIFECYCLE_WALLET_TYPES = ["legacy", "hierarchical", "sdk"] as const;

export function parseLovelace(utxo: ScriptUtxo): bigint {
  return BigInt(utxo.output.amount.find((asset) => asset.unit === "lovelace")?.quantity ?? "0");
}

export function toRef(utxo: ScriptUtxo): UtxoRef {
  return { txHash: utxo.input.txHash, outputIndex: utxo.input.outputIndex };
}

export function key(ref: UtxoRef): string {
  return `${ref.txHash}:${ref.outputIndex}`;
}

export function sameRef(left: UtxoRef, right: UtxoRef): boolean {
  return key(left) === key(right);
}

export function containsRef(refs: UtxoRef[], ref: UtxoRef): boolean {
  return refs.some((existing) => sameRef(existing, ref));
}

export function formatAda(lovelace: bigint): string {
  const ada = lovelace / 1_000_000n;
  const remainder = lovelace % 1_000_000n;
  if (remainder === 0n) return `${ada.toString()} ADA`;
  return `${ada.toString()}.${remainder.toString().padStart(6, "0")} ADA`;
}

export function getProxyFullLifecycleRequiredLovelace(): bigint {
  return (
    DREP_REGISTER_REQUIRED_LOVELACE +
    LIFECYCLE_PROXY_LOVELACE +
    PROXY_SPEND_LOVELACE +
    FULL_LIFECYCLE_FEE_BUFFER_LOVELACE
  );
}

export type ProxyLifecycleUtxoShapeAnalysis = {
  status: ProxyLifecycleUtxoShapeStatus;
  totalLovelace: bigint;
  largestUtxoLovelace: bigint;
  setupCandidates: number;
  keyCollateralCandidates: number;
  drepSelectableLovelace: bigint;
  drepRequiredLovelace: bigint;
  requiredTotalLovelace: bigint;
  selfSplitRequiredLovelace: bigint;
  hasSetupCandidate: boolean;
  hasKeyCollateral: boolean;
  diagnostics: string;
};

export type ProxyLifecycleUtxoShapeInput = {
  walletUtxos: ScriptUtxo[];
  collateralUtxos: ScriptUtxo[];
  minKeyCollateralCandidates?: number;
};

export function analyzeProxyFullLifecycleUtxoShape(args: {
  walletUtxos: ScriptUtxo[];
  collateralUtxos: ScriptUtxo[];
  minKeyCollateralCandidates?: number;
}): ProxyLifecycleUtxoShapeAnalysis {
  const minKeyCollateralCandidates = Math.max(1, args.minKeyCollateralCandidates ?? 1);
  const lovelaces = args.walletUtxos.map(parseLovelace);
  const totalLovelace = lovelaces.reduce((sum, value) => sum + value, 0n);
  const largestUtxoLovelace = lovelaces.reduce(
    (largest, value) => (value > largest ? value : largest),
    0n,
  );
  const setupCandidates = lovelaces.filter((value) => value >= SETUP_UTXO_REQUIRED_LOVELACE).length;
  const keyCollateralCandidates = args.collateralUtxos.filter(
    (utxo) =>
      parseLovelace(utxo) >= COLLATERAL_REQUIRED_LOVELACE &&
      utxo.output.amount.every((asset) => asset.unit === "lovelace"),
  );
  const hasSetupCandidate = setupCandidates > 0;
  const hasKeyCollateral = keyCollateralCandidates.length >= minKeyCollateralCandidates;
  const drepRequiredLovelace = getProxyFullLifecycleRequiredLovelace();
  const drepSelectableLovelace = totalLovelace;
  const requiredTotalLovelace = getProxyFullLifecycleRequiredLovelace();
  const selfSplitRequiredLovelace =
    drepRequiredLovelace + PROXY_LIFECYCLE_COLLATERAL_SPLIT_LOVELACE + SELF_SPLIT_FEE_BUFFER_LOVELACE;
  const diagnostics =
    `total=${formatAda(totalLovelace)}, largestUtxO=${formatAda(largestUtxoLovelace)}, ` +
    `setupCandidates=${setupCandidates}, keyCollateralCandidates=${keyCollateralCandidates.length}/${minKeyCollateralCandidates}, ` +
    `drepSelectable=${formatAda(drepSelectableLovelace)}, drepRequired=${formatAda(drepRequiredLovelace)}, ` +
    `required=${formatAda(requiredTotalLovelace)} ` +
    `(DRep register ${formatAda(DREP_REGISTER_REQUIRED_LOVELACE)} + ` +
    `initial proxy ${formatAda(LIFECYCLE_PROXY_LOVELACE)} + ` +
    `proxy spend ${formatAda(PROXY_SPEND_LOVELACE)} + ` +
    `fee buffer ${formatAda(FULL_LIFECYCLE_FEE_BUFFER_LOVELACE)})`;

  let status: ProxyLifecycleUtxoShapeStatus = "pass";
  if (totalLovelace < requiredTotalLovelace) {
    status = "insufficient-total";
  } else if (!hasSetupCandidate || !hasKeyCollateral) {
    status =
      totalLovelace >= selfSplitRequiredLovelace
        ? "needs-split"
        : "insufficient-shape";
  } else if (drepSelectableLovelace < drepRequiredLovelace) {
    status = "insufficient-selectable";
  }

  return {
    status,
    totalLovelace,
    largestUtxoLovelace,
    setupCandidates,
    keyCollateralCandidates: keyCollateralCandidates.length,
    drepSelectableLovelace,
    drepRequiredLovelace,
    requiredTotalLovelace,
    selfSplitRequiredLovelace,
    hasSetupCandidate,
    hasKeyCollateral,
    diagnostics,
  };
}

export function assertProxyFullLifecyclePreflight(args: {
  walletUtxos: ScriptUtxo[];
  collateralUtxos: ScriptUtxo[];
  minKeyCollateralCandidates?: number;
}): Omit<
  ProxyLifecycleUtxoShapeAnalysis,
  "status" | "diagnostics" | "selfSplitRequiredLovelace" | "hasSetupCandidate" | "hasKeyCollateral"
> {
  const minKeyCollateralCandidates = Math.max(1, args.minKeyCollateralCandidates ?? 1);
  const analysis = analyzeProxyFullLifecycleUtxoShape(args);

  if (analysis.keyCollateralCandidates < minKeyCollateralCandidates) {
    const collateralMessage =
      minKeyCollateralCandidates === 1
        ? `no bot payment-address UTxO has at least ${formatAda(COLLATERAL_REQUIRED_LOVELACE)} for Plutus collateral`
        : `expected ${minKeyCollateralCandidates} distinct bot payment-address collateral UTxO(s) with at least ${formatAda(COLLATERAL_REQUIRED_LOVELACE)}, found ${analysis.keyCollateralCandidates}`;
    throw new Error(
      `Proxy full lifecycle preflight failed: ${collateralMessage}. ${analysis.diagnostics}. Run proxy lifecycle UTxO shaping or fund the bot payment address before running proxy full lifecycle.`,
    );
  }
  if (analysis.setupCandidates === 0) {
    throw new Error(
      `Proxy full lifecycle preflight failed: no wallet UTxO has at least ${formatAda(SETUP_UTXO_REQUIRED_LOVELACE)} for proxy setup. ${analysis.diagnostics}. Fund or consolidate the CI wallet before running proxy full lifecycle.`,
    );
  }
  if (analysis.totalLovelace < analysis.requiredTotalLovelace) {
    throw new Error(
      `Proxy full lifecycle preflight failed: insufficient ADA for full lifecycle. ${analysis.diagnostics}. Add at least ${formatAda(analysis.requiredTotalLovelace - analysis.totalLovelace)} plus any desired safety margin before running proxy full lifecycle.`,
    );
  }
  if (analysis.drepSelectableLovelace < analysis.drepRequiredLovelace) {
    throw new Error(
      `Proxy full lifecycle preflight failed: DRep register cannot select enough ADA while reserving separate collateral and accounting for prior proxy setup/spend costs. ${analysis.diagnostics}. Add at least ${formatAda(analysis.drepRequiredLovelace - analysis.drepSelectableLovelace)} plus any desired safety margin, or consolidate spendable ADA outside the collateral UTxO.`,
    );
  }

  return {
    totalLovelace: analysis.totalLovelace,
    largestUtxoLovelace: analysis.largestUtxoLovelace,
    setupCandidates: analysis.setupCandidates,
    keyCollateralCandidates: analysis.keyCollateralCandidates,
    drepSelectableLovelace: analysis.drepSelectableLovelace,
    drepRequiredLovelace: analysis.drepRequiredLovelace,
    requiredTotalLovelace: analysis.requiredTotalLovelace,
  };
}
