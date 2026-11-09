import type { UTxO } from "@meshsdk/core";
import type { AssetQuantity } from "@/types/token-flow";
import type { TxDraft } from "@/types/tx-draft";
import type { DraftIssue } from "@/lib/tx-draft/validate";
import {
  ALWAYS_TRUE_V2,
  assertSuppliedScriptMatches,
  classifyPaymentAddress,
  networkId,
  verifiedWalletScriptHash,
} from "./classify";
import {
  RISK_ASSESSMENT_VERSION,
  type RiskAssessment,
  type RiskContext,
  type RiskFinding,
  type RiskLocation,
  type RiskOutput,
} from "./types";

export function emptyAssessment(
  scope: RiskAssessment["scope"],
  ctx: RiskContext,
): RiskAssessment {
  const result: RiskAssessment = {
    version: RISK_ASSESSMENT_VERSION,
    scope,
    networkId: networkId(ctx.network),
    status: "complete",
    outputs: [],
    findings: [],
    errors: [],
  };
  try {
    verifiedWalletScriptHash(ctx);
  } catch {
    result.errors.push({
      code: "wallet-script-unverified",
      message: "Cannot verify the current wallet's native payment script.",
    });
    result.status = "incomplete";
  }
  return result;
}

/** Preserve integer precision, asset identity and per-output association. */
export function checkedAssets(assets: AssetQuantity[]): AssetQuantity[] {
  const seen = new Set<string>();
  return assets.map(({ unit, quantity }) => {
    if (
      typeof unit !== "string" ||
      typeof quantity !== "string" ||
      (unit !== "lovelace" &&
        !/^[0-9a-fA-F]{56}(?:[0-9a-fA-F]{2}){0,32}$/.test(unit)) ||
      !/^(?:0|[1-9]\d*)$/.test(quantity) ||
      seen.has(unit.toLowerCase())
    )
      throw new Error("Cannot verify output assets and integer quantities.");
    seen.add(unit.toLowerCase());
    return { unit: unit.toLowerCase(), quantity };
  });
}

export function assessOutput(
  output: { address: string; assets: AssetQuantity[] },
  location: RiskLocation & { outputIndex: number },
  ctx: RiskContext,
  source: "draft-output" | "transaction-output",
): { output: RiskOutput; finding?: RiskFinding } {
  const control = classifyPaymentAddress(output.address, ctx);
  const assets = checkedAssets(output.assets);
  const reviewed = { ...location, address: output.address, assets, control };
  if (control.kind === "key" || control.kind === "wallet-native-script")
    return { output: reviewed };
  const known = control.kind === "known-anyone-can-spend";
  return {
    output: reviewed,
    finding: {
      ...location,
      address: output.address,
      assets,
      scriptHash: control.paymentHash,
      code: known
        ? "script-output-anyone-can-spend"
        : "script-output-rules-unknown",
      severity: known ? "danger" : "warning",
      action: "fund-script",
      message: known
        ? "Anyone can spend funds sent to this script. Your wallet's approval requirements will not protect them after this transfer."
        : "Funds sent here follow this script's spending rules. Your current wallet's approval requirements may no longer apply. These rules have not been verified.",
      requiresAcknowledgment: known,
      evidence: {
        source,
        basis: known ? "known-script-hash" : "payment-credential",
        ...(known ? { registryId: ALWAYS_TRUE_V2.id } : {}),
      },
    },
  };
}

/** UTxO facts must come from chain resolution, not txJson or a draft snapshot. */
export function assessResolvedInput(
  utxo: UTxO,
  ctx: RiskContext,
  suppliedScript?: { version: "V1" | "V2" | "V3"; cbor: string },
  inputId?: string,
): RiskFinding | undefined {
  if (suppliedScript)
    assertSuppliedScriptMatches(utxo.output.address, suppliedScript);
  const control = classifyPaymentAddress(utxo.output.address, ctx);
  const assets = checkedAssets(utxo.output.amount);
  if (control.kind === "key" || control.kind === "wallet-native-script")
    return undefined;
  const known = control.kind === "known-anyone-can-spend";
  return {
    code: known
      ? "script-input-anyone-can-spend"
      : "script-input-rules-unverified",
    severity: "info",
    action: "spend-script",
    inputRef: { ...utxo.input },
    inputId,
    address: utxo.output.address,
    scriptHash: control.paymentHash,
    assets,
    requiresAcknowledgment: false,
    message: known
      ? "This input can be spent by anyone and may be spent before your transaction confirms."
      : "This input follows script spending rules that have not been verified. This assessment does not execute the script or certify its safety.",
    evidence: {
      source: "resolved-input",
      basis: known ? "known-script-hash" : "payment-credential",
      ...(known ? { registryId: ALWAYS_TRUE_V2.id } : {}),
    },
  };
}

/** Early feedback only; never usable as a completed transaction review. */
export function assessDraftOutputRisks(
  draft: Pick<TxDraft, "outputs">,
  ctx: RiskContext,
): RiskAssessment {
  const result = emptyAssessment("draft-outputs", ctx);
  // A bad wallet context cannot suppress otherwise detectable dangerous outputs.
  const effective = result.errors.length ? { network: ctx.network } : ctx;
  draft.outputs.forEach((output, outputIndex) => {
    const location = { outputId: output.id, outputIndex };
    try {
      const assessed = assessOutput(
        output,
        location,
        effective,
        "draft-output",
      );
      result.outputs.push(assessed.output);
      if (assessed.finding) result.findings.push(assessed.finding);
    } catch {
      result.errors.push({
        ...location,
        code: "output-unverified",
        message:
          "Enter a valid payment address and asset amounts on the selected network.",
      });
    }
  });
  result.status = result.errors.length ? "incomplete" : "complete";
  return result;
}

/** Semantic warnings are separate from ledger validity; callers opt into this adapter. */
export function riskFindingsToDraftIssues(
  findings: RiskFinding[],
): DraftIssue[] {
  return findings.map((finding) => {
    const location: RiskLocation = {
      outputId: finding.outputId,
      inputId: finding.inputId,
      inputRef: finding.inputRef,
    };
    return {
      ...location,
      level: "warning",
      code: finding.code,
      message: finding.message,
      ...(finding.action === "collateral"
        ? { field: "collateral" as const }
        : {}),
    };
  });
}
