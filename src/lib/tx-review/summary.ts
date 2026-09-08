import type { AssetMetadataMap } from "@/components/common/token-flow/format";
import { baseToDisplay } from "@/lib/tx-draft/decimal";
import type {
  AddressLabeler,
  AddressPartyType,
  AssetQuantity,
} from "@/types/token-flow";
import {
  meshCertificateToBadge,
  meshVoteToBadge,
  type PoolNameResolver,
  type ProposalTitleResolver,
} from "@/utils/token-flow/certificates";
import { splitTrailingChange } from "@/utils/token-flow/change";
import { getFirstAndLast } from "@/utils/strings";

/**
 * The review summary: one plain object describing a transaction the way a
 * signer needs to read it. It is computed once per tool call from the
 * completed builder body and feeds all three outputs — the text block, the
 * `structuredContent`, and the PNG card — so a number on the picture can
 * never disagree with the number in the JSON.
 *
 * Amounts are formatted with decimal-string math (`baseToDisplay`) and the
 * word "ADA": the card's bundled font has no "₳" glyph, and a review card is
 * the wrong place for rounding.
 */

export type ReviewAmount = {
  unit: string;
  quantity: string;
  /** e.g. "12.5 ADA", "1,000 HOSKY", "3 f4c1…9a2b" */
  display: string;
};

export type ReviewRecipient = {
  address: string;
  /** Resolved label ("Alice", "Signer 2", "This wallet"), or "" when unknown. */
  label: string;
  partyType: AddressPartyType;
  amounts: ReviewAmount[];
};

export type ReviewAction = {
  kind: "certificate" | "vote";
  /** "Vote: Yes", "Stake Delegation" */
  label: string;
  /** Resolved proposal title or pool name, when known. */
  title?: string;
  /** Truncated identifier, e.g. "8f3a…c21b#0" */
  detail?: string;
  /** Votes only: what happens to the rationale text. */
  rationale?:
    | { status: "will-publish-on-confirm"; excerpt: string }
    | { status: "anchored"; url: string }
    | { status: "none" };
};

export type TxReviewSummary = {
  kind: "preview" | "pending";
  wallet: { id: string; name: string; address: string; network: "mainnet" | "preprod" };
  threshold: { required: number; total: number; type: string };
  signatures: {
    signed: { address: string; label: string }[];
    rejected: { address: string; label: string }[];
    /** Signatures still needed to reach the threshold. */
    remaining: number;
  };
  description: string;
  metadataMessage: string;
  recipients: ReviewRecipient[];
  /** Change returning to the wallet, aggregated across change outputs. */
  change: ReviewAmount[];
  inputs: { count: number; total: ReviewAmount[]; unresolved: number };
  fee: ReviewAmount | null;
  /** Net protocol deposit implied by certificates (positive = paid). */
  deposit: ReviewAmount | null;
  actions: ReviewAction[];
  txHash: string;
  transactionId?: string;
  sizeBytes?: number;
  warnings: string[];
  /** ISO timestamp of when this summary was produced. */
  generatedAt: string;
};

export type SummarizeOptions = {
  kind: TxReviewSummary["kind"];
  wallet: { id: string; name: string; address: string; network: 0 | 1 };
  threshold: TxReviewSummary["threshold"];
  signedAddresses: string[];
  rejectedAddresses: string[];
  description: string | null | undefined;
  metadataMessage?: string;
  labelAddress: AddressLabeler;
  assetMetadata: AssetMetadataMap;
  resolvePoolName?: PoolNameResolver;
  resolveProposalTitle?: ProposalTitleResolver;
  /** Rationale text per "txHash#index", for votes not yet anchored. */
  pendingRationales?: Map<string, string>;
  txHash: string;
  transactionId?: string;
  sizeBytes?: number;
  warnings?: string[];
  now?: Date;
};

const STAKE_KEY_DEPOSIT = 2_000_000n;

export function formatReviewAmount(
  asset: AssetQuantity,
  metadata: AssetMetadataMap,
): ReviewAmount {
  if (asset.unit === "lovelace") {
    return {
      unit: asset.unit,
      quantity: asset.quantity,
      display: `${withThousands(baseToDisplay(asset.quantity, 6))} ADA`,
    };
  }
  const meta = metadata[asset.unit];
  const decimals = meta?.decimals ?? 0;
  const name =
    meta?.ticker?.trim() ||
    meta?.assetName?.trim() ||
    `${asset.unit.slice(0, 4)}…${asset.unit.slice(-4)}`;
  return {
    unit: asset.unit,
    quantity: asset.quantity,
    display: `${withThousands(baseToDisplay(asset.quantity, decimals))} ${name.slice(0, 24)}`,
  };
}

function withThousands(display: string): string {
  const [whole = "0", fraction] = display.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction ? `${grouped}.${fraction}` : grouped;
}

function sumAssets(lists: AssetQuantity[][]): AssetQuantity[] {
  const totals = new Map<string, bigint>();
  for (const list of lists) {
    for (const asset of list) {
      let quantity: bigint;
      try {
        quantity = BigInt(asset.quantity);
      } catch {
        continue;
      }
      totals.set(asset.unit, (totals.get(asset.unit) ?? 0n) + quantity);
    }
  }
  const out: AssetQuantity[] = [];
  // Lovelace first, then by unit for a stable order.
  for (const [unit, quantity] of [...totals.entries()].sort(([a], [b]) =>
    a === "lovelace" ? -1 : b === "lovelace" ? 1 : a.localeCompare(b),
  )) {
    if (quantity !== 0n) out.push({ unit, quantity: quantity.toString() });
  }
  return out;
}

/**
 * Summarize a MeshTxBuilderBody (the shape stored in `Transaction.txJson`
 * and returned by `buildDraftTx`). Parsed defensively like the token-flow
 * adapters: a malformed body degrades to fewer facts, never to a throw.
 */
export function summarizeMeshBody(
  body: any,
  opts: SummarizeOptions,
): TxReviewSummary {
  const metadata = opts.assetMetadata;
  const format = (asset: AssetQuantity) => formatReviewAmount(asset, metadata);
  const labelOf = (address: string) => {
    const { label } = opts.labelAddress(address);
    return label || getFirstAndLast(address, 12, 6);
  };

  // Outputs: trailing run at the change address is change.
  const outputs = (Array.isArray(body?.outputs) ? body.outputs : []).filter(
    (output: any) => typeof output?.address === "string",
  );
  const changeAddress =
    typeof body?.changeAddress === "string" ? body.changeAddress : opts.wallet.address;
  const { payments, change } = splitTrailingChange(outputs, changeAddress);

  const recipients: ReviewRecipient[] = payments.map((output: any) => {
    const { label, type } = opts.labelAddress(output.address);
    return {
      address: output.address,
      label,
      partyType: type,
      amounts: (Array.isArray(output.amount) ? output.amount : []).map(format),
    };
  });

  const changeAmounts = sumAssets(
    change.map((output: any) => (Array.isArray(output.amount) ? output.amount : [])),
  ).map(format);

  // Inputs: the builder body carries amounts for inputs it selected itself.
  const inputs = Array.isArray(body?.inputs) ? body.inputs : [];
  let unresolved = 0;
  const inputAmounts: AssetQuantity[][] = [];
  for (const input of inputs) {
    const amount = input?.txIn?.amount;
    if (Array.isArray(amount)) inputAmounts.push(amount);
    else unresolved++;
  }

  const feeRaw = typeof body?.fee === "string" ? body.fee : undefined;
  let fee: ReviewAmount | null = null;
  try {
    if (feeRaw && BigInt(feeRaw) > 0n) fee = format({ unit: "lovelace", quantity: feeRaw });
  } catch {
    fee = null;
  }

  // Certificates and votes as badges, with deposits implied by cert kinds.
  const actions: ReviewAction[] = [];
  let deposit = 0n;
  for (const cert of Array.isArray(body?.certificates) ? body.certificates : []) {
    const badge = meshCertificateToBadge(cert);
    const certType = cert?.certType?.type;
    const poolId = cert?.certType?.poolId;
    const poolName =
      certType === "DelegateStake" && typeof poolId === "string"
        ? opts.resolvePoolName?.(poolId)
        : undefined;
    actions.push({
      kind: "certificate",
      label: badge.label,
      ...(badge.detail ? { detail: badge.detail } : {}),
      ...(poolName ? { title: poolName } : {}),
    });
    if (badge.deposit) deposit += BigInt(badge.deposit);
    if (badge.refund) deposit -= BigInt(badge.refund);
    if (certType === "RegisterStake") deposit += STAKE_KEY_DEPOSIT;
    if (certType === "DeregisterStake") deposit -= STAKE_KEY_DEPOSIT;
  }
  for (const vote of Array.isArray(body?.votes) ? body.votes : []) {
    const badge = meshVoteToBadge(vote, opts.resolveProposalTitle);
    const govActionId = vote?.vote?.govActionId;
    const proposalId =
      govActionId?.txHash !== undefined && govActionId?.txIndex !== undefined
        ? `${govActionId.txHash}#${govActionId.txIndex}`
        : undefined;
    const anchorUrl = vote?.vote?.votingProcedure?.anchor?.anchorUrl;
    const pendingText = proposalId ? opts.pendingRationales?.get(proposalId) : undefined;
    actions.push({
      kind: "vote",
      label: badge.label,
      ...(badge.detail ? { detail: badge.detail } : {}),
      ...(badge.title ? { title: badge.title } : {}),
      rationale:
        typeof anchorUrl === "string" && anchorUrl
          ? { status: "anchored", url: anchorUrl }
          : pendingText
            ? { status: "will-publish-on-confirm", excerpt: excerpt(pendingText) }
            : { status: "none" },
    });
  }

  const signed = opts.signedAddresses.map((address) => ({ address, label: labelOf(address) }));
  const rejected = opts.rejectedAddresses.map((address) => ({ address, label: labelOf(address) }));

  return {
    kind: opts.kind,
    wallet: {
      id: opts.wallet.id,
      name: opts.wallet.name,
      address: opts.wallet.address,
      network: opts.wallet.network === 1 ? "mainnet" : "preprod",
    },
    threshold: opts.threshold,
    signatures: {
      signed,
      rejected,
      remaining: Math.max(0, opts.threshold.required - signed.length),
    },
    description: (opts.description ?? "").trim(),
    metadataMessage: (opts.metadataMessage ?? readMetadataMessage(body)).trim(),
    recipients,
    change: changeAmounts,
    inputs: {
      count: inputs.length,
      total: sumAssets(inputAmounts).map(format),
      unresolved,
    },
    fee,
    deposit:
      deposit !== 0n
        ? format({ unit: "lovelace", quantity: deposit.toString() })
        : null,
    actions,
    txHash: opts.txHash,
    ...(opts.transactionId ? { transactionId: opts.transactionId } : {}),
    ...(opts.sizeBytes !== undefined ? { sizeBytes: opts.sizeBytes } : {}),
    warnings: opts.warnings ?? [],
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };
}

/** CIP-20 message under label 674, if the body carries one. */
function readMetadataMessage(body: any): string {
  const metadata = body?.metadata;
  const entry =
    metadata instanceof Map
      ? metadata.get("674")
      : Array.isArray(metadata)
        ? metadata.find((m: any) => String(m?.tag ?? m?.label) === "674")?.metadata
        : metadata?.["674"];
  const msg = entry?.msg ?? entry?.metadata?.msg;
  if (Array.isArray(msg)) return msg.join("");
  return typeof msg === "string" ? msg : "";
}

function excerpt(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/**
 * Structured-content hint that a card image accompanies the result, for a
 * model that reads `structuredContent` rather than the content list.
 */
export const REVIEW_CARD_HINT = { attached: true, mimeType: "image/png" } as const;

/** Opening line of every review text: the model reads this before anything else. */
export const CARD_ATTACHED_LINE =
  "Review card attached as an image in this result — show it to the user now.";

/** The readable text block that accompanies the card. */
export function summaryToText(summary: TxReviewSummary): string {
  const lines: string[] = [CARD_ATTACHED_LINE];
  const state =
    summary.kind === "preview"
      ? "UNSIGNED PREVIEW — nothing has been saved, signed or broadcast."
      : `PENDING — ${summary.signatures.signed.length} of ${summary.threshold.required} signatures collected, ${summary.signatures.remaining} still needed.`;
  lines.push(`${summary.wallet.name} (${summary.wallet.network}) — ${state}`);
  if (summary.description) lines.push(`Description: ${summary.description}`);

  if (summary.recipients.length > 0) {
    lines.push("Recipients:");
    for (const recipient of summary.recipients) {
      const who = recipient.label
        ? `${recipient.label} (${getFirstAndLast(recipient.address, 12, 6)})`
        : getFirstAndLast(recipient.address, 16, 8);
      lines.push(`  - ${who}: ${recipient.amounts.map((a) => a.display).join(" + ")}`);
    }
  }
  if (summary.actions.length > 0) {
    lines.push("Actions:");
    for (const action of summary.actions) {
      const parts = [action.label];
      if (action.title) parts.push(action.title);
      if (action.detail) parts.push(`(${action.detail})`);
      let line = `  - ${parts.join(" — ")}`;
      if (action.rationale?.status === "will-publish-on-confirm") {
        line += ` · rationale will be published to IPFS on confirm: "${action.rationale.excerpt}"`;
      } else if (action.rationale?.status === "anchored") {
        line += ` · rationale: ${action.rationale.url}`;
      }
      lines.push(line);
    }
  }
  const facts: string[] = [];
  if (summary.fee) facts.push(`fee ${summary.fee.display}`);
  if (summary.deposit) facts.push(`deposit ${summary.deposit.display}`);
  if (summary.change.length > 0) {
    facts.push(`change back to the wallet ${summary.change.map((a) => a.display).join(" + ")}`);
  }
  facts.push(`${summary.inputs.count} input${summary.inputs.count === 1 ? "" : "s"}`);
  lines.push(`Totals: ${facts.join(", ")}.`);
  if (summary.metadataMessage) lines.push(`On-chain message: "${summary.metadataMessage}"`);
  lines.push(`Tx hash: ${summary.txHash}`);
  if (summary.transactionId) lines.push(`Transaction id: ${summary.transactionId}`);
  for (const warning of summary.warnings) lines.push(`Warning: ${warning}`);
  if (summary.kind === "preview") {
    lines.push(
      "Review the card above. If it is correct, confirm and I will create it for the signers with transaction_propose; it will still need their signatures in the app.",
    );
  }
  return lines.join("\n");
}
