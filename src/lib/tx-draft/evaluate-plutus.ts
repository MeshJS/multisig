import type { IEvaluator, Protocol } from "@meshsdk/core";
import { csl } from "@meshsdk/core-csl";
import type { DraftUtxoRef } from "@/types/tx-draft";

export type ScriptBudgetReview = {
  inputRef: DraftUtxoRef;
  mem: string;
  steps: string;
};
type Evaluation = Awaited<ReturnType<IEvaluator["evaluateTx"]>>;

/** Mesh owns ledger ordering/index assignment; validate the evaluator's coverage against its bytes. */
export function checkEvaluation(
  txHex: string,
  evaluation: Evaluation,
  final = false,
): ScriptBudgetReview[] {
  const tx = csl.Transaction.from_hex(txHex);
  const redeemers = tx.witness_set().redeemers();
  if (
    !redeemers?.len() ||
    !Array.isArray(evaluation) ||
    evaluation.length !== redeemers.len()
  )
    throw new Error(
      "Evaluation did not return a budget for every script input. Retry with an available evaluator.",
    );
  const used = new Set<number>();
  const reviews: ScriptBudgetReview[] = [];
  for (let i = 0; i < redeemers.len(); i++) {
    const redeemer = redeemers.get(i);
    const index = Number(redeemer.index().to_str());
    if (redeemer.tag().kind() !== 0)
      throw new Error(
        "Only Plutus spending redeemers are supported by these controls.",
      );
    const action = evaluation.find(
      (entry) => entry.tag === "SPEND" && entry.index === index,
    );
    if (
      !action ||
      used.has(index) ||
      !Number.isSafeInteger(action.budget?.mem) ||
      !Number.isSafeInteger(action.budget?.steps) ||
      action.budget.mem < 0 ||
      action.budget.steps < 0
    )
      throw new Error(
        "Evaluation returned missing, duplicate, or invalid execution budgets.",
      );
    used.add(index);
    const mem = redeemer.ex_units().mem().to_str();
    const steps = redeemer.ex_units().steps().to_str();
    if (
      final &&
      (BigInt(action.budget.mem) > BigInt(mem) ||
        BigInt(action.budget.steps) > BigInt(steps))
    )
      throw new Error(
        "The final transaction needs a larger execution budget. Rebuild and review it again.",
      );
    const input = tx.body().inputs().get(index);
    reviews.push({
      inputRef: {
        txHash: input.transaction_id().to_hex(),
        outputIndex: input.index(),
      },
      mem,
      steps,
    });
  }
  return reviews;
}

/** Wrap the real provider during SDK balancing: empty/partial evaluation must never leave guessed budgets. */
export function checkedEvaluator(
  evaluator: IEvaluator,
  isCurrent: () => boolean,
): IEvaluator {
  return {
    evaluateTx: async (txHex, utxos, txs) => {
      if (!isCurrent())
        throw new Error("Build superseded by a draft or environment change.");
      const result = await evaluator.evaluateTx(txHex, utxos, txs);
      if (!isCurrent())
        throw new Error("Build superseded by a draft or environment change.");
      checkEvaluation(txHex, result);
      return result;
    },
  };
}

export function checkPlutusLimits(
  txHex: string,
  signedSize: number,
  budgets: ScriptBudgetReview[],
  protocol: Protocol,
) {
  const tx = csl.Transaction.from_hex(txHex);
  if (!tx.body().script_data_hash())
    throw new Error("Completed transaction is missing its script-data hash.");
  if (tx.witness_set().vkeys()?.len())
    throw new Error("Draft builds must remain unsigned.");
  if (
    !Number.isSafeInteger(protocol.maxTxSize) ||
    protocol.maxTxSize <= 0 ||
    signedSize > protocol.maxTxSize
  )
    throw new Error(
      "Transaction exceeds the current maximum size including required witnesses.",
    );
  for (const [field, maximum] of [
    ["mem", protocol.maxTxExMem],
    ["steps", protocol.maxTxExSteps],
  ] as const) {
    if (
      !/^[0-9]+$/.test(maximum) ||
      BigInt(maximum) <= 0n ||
      budgets.reduce((sum, budget) => sum + BigInt(budget[field]), 0n) >
        BigInt(maximum)
    )
      throw new Error(
        `Transaction exceeds the current execution ${field} limit.`,
      );
  }
}
