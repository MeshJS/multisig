import type {
  DraftCertificateKind,
  DraftVoteKind,
  TxDraft,
} from "@/types/tx-draft";
import { normalizePoolIdForDelegation } from "@/utils/normalizePoolId";
import { addCertificate, addOutput, addVote, createDraft } from "./mutations";

/**
 * Converts a stored pending transaction's parsed `txJson` (MeshTxBuilderBody
 * after `complete()`, or the hand-rolled subset written by importTransaction)
 * back into an editable TxDraft.
 *
 * Simple sends, native-script DRep votes and native-script staking
 * certificates round-trip — the draft model has no representation for
 * withdrawals, mints or Plutus scripts, so `isDraftCompatible` gates every
 * load.
 */

const SUPPORTED_CERT_KINDS: DraftCertificateKind[] = [
  "RegisterStake",
  "DelegateStake",
  "DeregisterStake",
];

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

  const certificates = asArray(tx.certificates) as any[];
  for (const cert of certificates) {
    // Same Mesh serialization duality as votes below: certs may appear as
    // BasicCertificate or SimpleScriptCertificate depending on when
    // certificateScript was applied — both are fine, the rebuild
    // re-witnesses every certificate.
    if (
      cert?.type !== "BasicCertificate" &&
      cert?.type !== "SimpleScriptCertificate"
    ) {
      reasons.push(
        "Contains Plutus script certificates — not supported by the builder",
      );
      break;
    }
    const certType = cert?.certType;
    if (!SUPPORTED_CERT_KINDS.includes(certType?.type)) {
      // VoteDelegation, DRep and pool certificates, combined
      // stake+vote-delegation certs etc. stay blocked.
      reasons.push(
        "Contains certificate types not yet supported by the builder",
      );
      break;
    }
    if (
      typeof certType?.stakeKeyAddress !== "string" ||
      (certType.type === "DelegateStake" &&
        typeof certType?.poolId !== "string")
    ) {
      reasons.push("Certificate data is malformed");
      break;
    }
  }

  const votes = asArray(tx.votes) as any[];
  for (const vote of votes) {
    // Multi-vote ballots serialize earlier votes as BasicVote and only the
    // last as SimpleScriptVote (voteScript is applied once after the loop),
    // so both shapes must be accepted; the rebuild re-witnesses every vote.
    if (vote?.type !== "BasicVote" && vote?.type !== "SimpleScriptVote") {
      reasons.push("Contains Plutus script votes — not supported by the builder");
      break;
    }
    const voter = vote?.vote?.voter;
    if (voter?.type !== "DRep" || typeof voter?.drepId !== "string") {
      reasons.push("Contains non-DRep votes — not supported by the builder");
      break;
    }
    const govActionId = vote?.vote?.govActionId;
    const voteKind = vote?.vote?.votingProcedure?.voteKind;
    if (
      typeof govActionId?.txHash !== "string" ||
      typeof govActionId?.txIndex !== "number" ||
      !["Yes", "No", "Abstain"].includes(voteKind)
    ) {
      reasons.push("Vote data is malformed");
      break;
    }
  }

  const outputs = asArray(tx.outputs) as any[];
  if (outputs.length === 0 && votes.length === 0 && certificates.length === 0) {
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
 * change address matches the builder's invariant (the wallet address).
 * `minOutputs` protects self-consolidation payments (1 for send txs); vote
 * transactions legitimately strip to zero outputs (0).
 */
function stripTrailingChangeOutputs(
  outputs: { address: string; amount: unknown }[],
  changeAddress: string,
  minOutputs: number,
): { address: string; amount: unknown }[] {
  const kept = [...outputs];
  while (
    kept.length > minOutputs &&
    kept[kept.length - 1]!.address === changeAddress
  ) {
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

  const rawVotes = asArray(body?.votes) as any[];
  const rawCerts = asArray(body?.certificates) as any[];

  const rawOutputs = asArray(body?.outputs).filter(
    (output: any): output is { address: string; amount: unknown } =>
      typeof output?.address === "string",
  ) as { address: string; amount: unknown }[];

  const changeAddress =
    typeof body?.changeAddress === "string" ? body.changeAddress : "";
  let outputs = rawOutputs;
  if (changeAddress && changeAddress === opts.walletAddress) {
    // A vote-only or certificate-only body's outputs are pure change —
    // those strip to zero.
    outputs = stripTrailingChangeOutputs(
      rawOutputs,
      changeAddress,
      rawVotes.length > 0 || rawCerts.length > 0 ? 0 : 1,
    );
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
  for (const raw of rawCerts) {
    const certType = raw?.certType;
    let poolId: string | undefined;
    if (certType?.type === "DelegateStake") {
      // Stored poolIds vary by producer (hex from the staking page, bech32
      // from the bot API) — canonicalize to bech32 so display, comparison
      // and editing all happen in one space. Keep the raw value on failure;
      // validateDraft flags it instead of the load crashing.
      try {
        poolId = normalizePoolIdForDelegation(String(certType?.poolId ?? ""));
      } catch {
        poolId = String(certType?.poolId ?? "");
      }
    }
    draft = addCertificate(draft, {
      kind: certType?.type as DraftCertificateKind,
      ...(poolId !== undefined ? { poolId } : {}),
      ...(typeof certType?.stakeKeyAddress === "string"
        ? { originalStakeAddress: certType.stakeKeyAddress }
        : {}),
    }).draft;
  }
  for (const raw of rawVotes) {
    const procedure = raw?.vote?.votingProcedure;
    const anchor = procedure?.anchor;
    draft = addVote(draft, {
      govActionTxHash: raw?.vote?.govActionId?.txHash ?? "",
      govActionIndex: raw?.vote?.govActionId?.txIndex ?? 0,
      voteKind: (procedure?.voteKind ?? "Abstain") as DraftVoteKind,
      ...(typeof anchor?.anchorUrl === "string" &&
      typeof anchor?.anchorDataHash === "string"
        ? {
            anchor: {
              anchorUrl: anchor.anchorUrl,
              anchorDataHash: anchor.anchorDataHash,
            },
          }
        : {}),
      ...(typeof raw?.vote?.voter?.drepId === "string"
        ? { originalDrepId: raw.vote.voter.drepId }
        : {}),
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
