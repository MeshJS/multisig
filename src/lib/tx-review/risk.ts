import { createHash } from "crypto";
import { csl } from "@meshsdk/core-csl";
import type { RiskAssessment, RiskContext } from "@/lib/tx-risk/types";
import { reviewIsComplete } from "@/lib/tx-risk/review-policy";
import type { DraftBuildResult } from "@/lib/tx-draft/build-draft-tx";
import { TxReviewError, type ReviewWalletContext } from "./context";

export function walletRiskContext(wallet: ReviewWalletContext): RiskContext {
  return {
    network: wallet.network,
    walletNativeScript: {
      address: wallet.walletAddress,
      cbor: wallet.scriptCbor,
    },
  };
}

export function requireBuiltRisk(
  built: DraftBuildResult,
  network: number,
): RiskAssessment {
  if (!reviewIsComplete(built, network))
    throw new TxReviewError(
      422,
      "REVIEW_INCOMPLETE",
      "Unable to verify this transaction. Retry the preview before proposing.",
      { riskAssessment: built.riskAssessment },
    );
  return built.riskAssessment!;
}

/** Allow ordinary input reselection and verified native-wallet change to vary.
 * Bind every payment, other emitted output, input risk and collateral fact.
 * This is review integrity, never a signer's acknowledgment.
 */
export function riskReviewBinding(
  risk: RiskAssessment,
  context: RiskContext,
  paymentCount: number,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: risk.version,
        network: risk.networkId,
        context,
        outputs: risk.outputs.filter(
          (output) =>
            output.outputIndex < paymentCount ||
            output.control.kind !== "wallet-native-script" ||
            output.outputRole,
        ),
        findings: risk.findings,
        collateral: risk.collateral,
      }),
    )
    .digest("hex");
}

/** Preserve unrelated legacy fields, but never trust JSON for output or input amounts.
 * A failed decode yields no invented ledger facts and an explicit incomplete risk result.
 */
export function bodyWithLedgerFacts(
  body: any,
  txHex: string,
  risk: RiskAssessment,
  walletAddress: string,
): any {
  const result = {
    ...(body && typeof body === "object" ? body : {}),
    outputs: risk.outputs
      .filter((output) => !output.outputRole)
      .map((output) => ({
        address: output.address,
        amount: output.assets,
        outputIndex: output.outputIndex,
      })),
    changeAddress: walletAddress,
    inputs: [] as unknown[],
    fee: undefined as string | undefined,
  };
  if (!risk.txHash) return result;
  const decoded = csl.Transaction.from_hex(txHex).body();
  result.fee = decoded.fee().to_str();
  result.inputs = Array.from({ length: decoded.inputs().len() }, (_, index) => {
    const input = decoded.inputs().get(index);
    return {
      txIn: { txHash: input.transaction_id().to_hex(), txIndex: input.index() },
    };
  });
  return result;
}
