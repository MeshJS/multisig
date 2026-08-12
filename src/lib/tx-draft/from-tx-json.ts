import type { TxDraft } from "@/types/tx-draft";
import { addOutput, createDraft } from "./mutations";

/**
 * Converts a stored pending transaction's parsed `txJson` (MeshTxBuilderBody
 * after `complete()`, or the hand-rolled subset written by importTransaction)
 * back into an editable TxDraft.
 *
 * Only simple send transactions round-trip — the draft model has no
 * representation for certificates, votes, withdrawals, mints or Plutus
 * scripts, so `isDraftCompatible` gates every load.
 */

export type TxJsonCompat = { compatible: boolean; reasons: string[] };

export type TxJsonToDraftResult = {
  /** Draft with `utxoSelection: { mode: "auto" }`; callers may upgrade to
   * manual by matching `inputRefs` against live available UTxOs. */
  draft: TxDraft;
  inputRefs: { txHash: string; txIndex: number }[];
  warnings: TxJsonWarning[];
};

export type TxJsonWarning = "change-not-detected";

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isDraftCompatible(body: unknown): TxJsonCompat {
  const reasons: string[] = [];
  if (typeof body !== "object" || body === null) {
    return { compatible: false, reasons: ["Unreadable transaction"] };
  }
  const tx = body as Record<string, unknown>;

  const nonEmpty: Array<[key: string, reason: string]> = [
    ["certificates", "Contains certificates — not yet supported by the builder"],
    ["votes", "Contains governance votes — not yet supported by the builder"],
    ["withdrawals", "Contains reward withdrawals — not yet supported by the builder"],
    ["mints", "Mints or burns tokens — not yet supported by the builder"],
    ["collaterals", "Uses collateral inputs (smart contract transaction)"],
    ["referenceInputs", "Uses reference inputs (smart contract transaction)"],
    ["requiredSignatures", "Declares extra required signers — not yet supported by the builder"],
  ];
  for (const [key, reason] of nonEmpty) {
    if (asArray(tx[key]).length > 0) reasons.push(reason);
  }

  const inputs = asArray(tx.inputs) as any[];
  if (inputs.length === 0) {
    reasons.push("Transaction has no inputs");
  }
  for (const input of inputs) {
    if (input?.type === "Script" || input?.scriptTxIn) {
      reasons.push("Spends from a Plutus script — not yet supported by the builder");
      break;
    }
  }
  if (
    inputs.some(
      (input) =>
        typeof input?.txIn?.txHash !== "string" ||
        typeof input?.txIn?.txIndex !== "number",
    )
  ) {
    reasons.push("Transaction inputs are missing UTxO references");
  }

  const outputs = asArray(tx.outputs) as any[];
  if (outputs.length === 0) {
    reasons.push("Transaction has no outputs");
  }
  if (outputs.some((output) => output?.datum || output?.referenceScript)) {
    reasons.push("Sends to outputs with datums or reference scripts");
  }

  const validityRange = tx.validityRange as Record<string, unknown> | undefined;
  if (
    validityRange?.invalidBefore !== undefined ||
    validityRange?.invalidHereafter !== undefined ||
    tx.ttl !== undefined ||
    tx.validityStartInterval !== undefined
  ) {
    reasons.push("Has a validity window — rebuilding would change it");
  }

  return { compatible: reasons.length === 0, reasons };
}

/**
 * After `complete()` Mesh appends the computed change output(s) to
 * `body.outputs` (they are never re-sorted, so change is always trailing).
 * Strip them so the draft only shows intended recipients — but only when the
 * change address matches the builder's invariant (the wallet address), and
 * never below one remaining output so self-consolidation transactions keep
 * their payment.
 */
function stripTrailingChangeOutputs(
  outputs: { address: string; amount: unknown }[],
  changeAddress: string,
): { address: string; amount: unknown }[] {
  const kept = [...outputs];
  while (kept.length > 1 && kept[kept.length - 1]!.address === changeAddress) {
    kept.pop();
  }
  return kept;
}

export function txJsonToDraft(
  body: any,
  opts: {
    walletAddress: string;
    description?: string | null;
    metadataMessage?: string;
  },
): TxJsonToDraftResult {
  const warnings: TxJsonWarning[] = [];

  const rawOutputs = asArray(body?.outputs).filter(
    (output: any): output is { address: string; amount: unknown } =>
      typeof output?.address === "string",
  ) as { address: string; amount: unknown }[];

  const changeAddress =
    typeof body?.changeAddress === "string" ? body.changeAddress : "";
  let outputs = rawOutputs;
  if (changeAddress && changeAddress === opts.walletAddress) {
    outputs = stripTrailingChangeOutputs(rawOutputs, changeAddress);
  } else if (changeAddress) {
    // importTransaction guesses changeAddress = outputs[0].address; there is
    // no way to tell which output (if any) is change, so keep them all.
    warnings.push("change-not-detected");
  }

  let draft = createDraft();
  for (const output of outputs) {
    draft = addOutput(draft, {
      address: output.address,
      assets: asArray(output.amount)
        .filter(
          (asset: any) =>
            typeof asset?.unit === "string" &&
            typeof asset?.quantity === "string",
        )
        .map((asset: any) => ({ unit: asset.unit, quantity: asset.quantity })),
    }).draft;
  }
  draft = {
    ...draft,
    description: opts.description ?? "",
    metadata: opts.metadataMessage ?? "",
  };

  const inputRefs = (asArray(body?.inputs) as any[])
    .filter(
      (input) =>
        typeof input?.txIn?.txHash === "string" &&
        typeof input?.txIn?.txIndex === "number",
    )
    .map((input) => ({
      txHash: input.txIn.txHash as string,
      txIndex: input.txIn.txIndex as number,
    }));

  return { draft, inputRefs, warnings };
}
