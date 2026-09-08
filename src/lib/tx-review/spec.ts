import type { AssetQuantity } from "@/types/token-flow";
import type {
  DraftCertificateKind,
  DraftVoteKind,
  TxDraft,
} from "@/types/tx-draft";
import { displayToBase } from "@/lib/tx-draft/decimal";
import {
  addCertificate,
  addOutput,
  addVote,
  createDraft,
} from "@/lib/tx-draft/mutations";
import { parseProposalId } from "@/lib/governance";
import { normalizePoolIdForDelegation } from "@/utils/normalizePoolId";

/**
 * The transaction spec: what the model asks for, and what the draft token
 * carries.
 *
 * Two shapes on purpose. `TxSpecInput` is the tool-facing one — amounts in
 * display units ("12.5" ADA, "100" of a token with its registered decimals),
 * proposals as "txHash#index", pool ids in either encoding — because that is
 * how a human phrases a payment in chat and how the model will relay it.
 * `TxSpec` is the canonical one — base units, parsed ids, defaults applied —
 * so that the token binds an unambiguous transaction and `specToDraft` is a
 * pure, deterministic projection onto the builder's `TxDraft`.
 */

export const CERTIFICATE_KINDS: readonly DraftCertificateKind[] = [
  "RegisterStake",
  "DelegateStake",
  "DeregisterStake",
];
/** Ledger-valid emission order: register → delegate → deregister. */
const CERTIFICATE_ORDER: Record<DraftCertificateKind, number> = {
  RegisterStake: 0,
  DelegateStake: 1,
  DeregisterStake: 2,
};
export const VOTE_KINDS: readonly DraftVoteKind[] = ["Yes", "No", "Abstain"];

export const MAX_DESCRIPTION_LENGTH = 128;
export const MAX_METADATA_MESSAGE_LENGTH = 64;
export const MAX_RATIONALE_LENGTH = 10_000;

export type TxSpecInput = {
  walletId: string;
  outputs?: {
    address: string;
    /** ADA in display units, e.g. "12.5". */
    ada?: string;
    /** Native assets: unit = policyId + hex asset name; quantity in display units. */
    assets?: { unit: string; quantity: string }[];
  }[];
  certificates?: { kind: string; poolId?: string }[];
  votes?: { proposalId: string; vote: string; rationale?: string }[];
  description?: string;
  metadataMessage?: string;
};

export type TxSpec = {
  v: 1;
  walletId: string;
  outputs: { address: string; assets: AssetQuantity[] }[];
  certificates: { kind: DraftCertificateKind; poolId?: string }[];
  votes: {
    govActionTxHash: string;
    govActionIndex: number;
    voteKind: DraftVoteKind;
    /** Rationale text; pinned to IPFS and anchored only on propose. */
    rationale?: string;
  }[];
  description: string;
  metadataMessage: string;
};

export type SpecIssue = {
  level: "error" | "warning";
  code:
    | "no-actions"
    | "invalid-amount"
    | "unknown-decimals"
    | "invalid-unit"
    | "invalid-certificate"
    | "invalid-pool-id"
    | "invalid-proposal-id"
    | "invalid-vote"
    | "too-long";
  message: string;
  /** 0-based index into the offending input list, when there is one. */
  outputIndex?: number;
  voteIndex?: number;
  certificateIndex?: number;
};

const UNIT_PATTERN = /^[0-9a-f]{56,120}$/;

/** Distinct native-asset units named by the input, for a metadata lookup. */
export function collectSpecUnits(input: TxSpecInput): string[] {
  const units = new Set<string>();
  for (const output of input.outputs ?? []) {
    for (const asset of output.assets ?? []) {
      if (asset.unit && asset.unit !== "lovelace") units.add(asset.unit.toLowerCase());
    }
  }
  return [...units];
}

/**
 * Normalize the tool input into a canonical spec.
 *
 * `decimalsFor` answers from asset metadata already fetched for
 * `collectSpecUnits`. When decimals are unknown the amount is only accepted
 * if it is an integer, and then as base units with a warning — a guess at
 * the scale of a token is exactly the kind of mistake a review card exists
 * to prevent, so it is never made silently.
 */
export function normalizeTxSpec(
  input: TxSpecInput,
  opts: { decimalsFor: (unit: string) => number | undefined },
): { spec: TxSpec; issues: SpecIssue[] } {
  const issues: SpecIssue[] = [];

  const outputs: TxSpec["outputs"] = [];
  (input.outputs ?? []).forEach((output, outputIndex) => {
    const assets: AssetQuantity[] = [];
    if (output.ada !== undefined && String(output.ada).trim() !== "") {
      const lovelace = displayToBase(String(output.ada), 6);
      if (lovelace === undefined || BigInt(lovelace) <= 0n) {
        issues.push({
          level: "error",
          code: "invalid-amount",
          message: `Recipient ${outputIndex + 1}: "${output.ada}" is not a valid ADA amount.`,
          outputIndex,
        });
      } else {
        assets.push({ unit: "lovelace", quantity: lovelace });
      }
    }
    for (const asset of output.assets ?? []) {
      const unit = String(asset.unit ?? "").toLowerCase();
      if (unit === "lovelace") {
        issues.push({
          level: "error",
          code: "invalid-unit",
          message: `Recipient ${outputIndex + 1}: use the "ada" field for ADA rather than an asset entry.`,
          outputIndex,
        });
        continue;
      }
      if (!UNIT_PATTERN.test(unit)) {
        issues.push({
          level: "error",
          code: "invalid-unit",
          message: `Recipient ${outputIndex + 1}: "${asset.unit}" is not a valid asset unit (policy id + hex asset name).`,
          outputIndex,
        });
        continue;
      }
      const quantityRaw = String(asset.quantity ?? "").trim();
      const decimals = opts.decimalsFor(unit);
      let base: string | undefined;
      if (decimals === undefined) {
        if (/^\d+$/.test(quantityRaw)) {
          base = BigInt(quantityRaw).toString();
          issues.push({
            level: "warning",
            code: "unknown-decimals",
            message: `Recipient ${outputIndex + 1}: no decimals are registered for ${shortUnit(unit)}, so ${quantityRaw} is treated as the raw on-chain quantity.`,
            outputIndex,
          });
        } else {
          issues.push({
            level: "error",
            code: "unknown-decimals",
            message: `Recipient ${outputIndex + 1}: no decimals are registered for ${shortUnit(unit)}; give a whole-number quantity in raw on-chain units.`,
            outputIndex,
          });
          continue;
        }
      } else {
        base = displayToBase(quantityRaw, decimals);
      }
      if (base === undefined || BigInt(base) <= 0n) {
        issues.push({
          level: "error",
          code: "invalid-amount",
          message: `Recipient ${outputIndex + 1}: "${asset.quantity}" is not a valid quantity for ${shortUnit(unit)}.`,
          outputIndex,
        });
        continue;
      }
      const existing = assets.find((a) => a.unit === unit);
      if (existing) {
        existing.quantity = (BigInt(existing.quantity) + BigInt(base)).toString();
      } else {
        assets.push({ unit, quantity: base });
      }
    }
    outputs.push({ address: String(output.address ?? "").trim(), assets });
  });

  const certificates: TxSpec["certificates"] = [];
  (input.certificates ?? []).forEach((cert, certificateIndex) => {
    const kind = cert.kind as DraftCertificateKind;
    if (!CERTIFICATE_KINDS.includes(kind)) {
      issues.push({
        level: "error",
        code: "invalid-certificate",
        message: `Certificate ${certificateIndex + 1}: unknown kind "${cert.kind}".`,
        certificateIndex,
      });
      return;
    }
    if (kind === "DelegateStake") {
      let poolId: string | undefined;
      try {
        poolId = normalizePoolIdForDelegation(String(cert.poolId ?? ""));
      } catch (error) {
        issues.push({
          level: "error",
          code: "invalid-pool-id",
          message: `Certificate ${certificateIndex + 1}: ${error instanceof Error ? error.message : "invalid pool id"}.`,
          certificateIndex,
        });
        return;
      }
      certificates.push({ kind, poolId });
    } else {
      certificates.push({ kind });
    }
  });

  const votes: TxSpec["votes"] = [];
  (input.votes ?? []).forEach((vote, voteIndex) => {
    let parsed: { txHash: string; certIndex: number };
    try {
      parsed = parseProposalId(String(vote.proposalId ?? "").trim());
    } catch {
      issues.push({
        level: "error",
        code: "invalid-proposal-id",
        message: `Vote ${voteIndex + 1}: "${vote.proposalId}" is not a proposal id (expected <txHash>#<index>).`,
        voteIndex,
      });
      return;
    }
    if (!/^[0-9a-f]{64}$/i.test(parsed.txHash)) {
      issues.push({
        level: "error",
        code: "invalid-proposal-id",
        message: `Vote ${voteIndex + 1}: proposal tx hash must be 64 hex characters.`,
        voteIndex,
      });
      return;
    }
    const voteKind = vote.vote as DraftVoteKind;
    if (!VOTE_KINDS.includes(voteKind)) {
      issues.push({
        level: "error",
        code: "invalid-vote",
        message: `Vote ${voteIndex + 1}: choice must be Yes, No or Abstain.`,
        voteIndex,
      });
      return;
    }
    const rationale = vote.rationale?.trim();
    if (rationale && rationale.length > MAX_RATIONALE_LENGTH) {
      issues.push({
        level: "error",
        code: "too-long",
        message: `Vote ${voteIndex + 1}: rationale exceeds ${MAX_RATIONALE_LENGTH} characters.`,
        voteIndex,
      });
      return;
    }
    votes.push({
      govActionTxHash: parsed.txHash.toLowerCase(),
      govActionIndex: parsed.certIndex,
      voteKind,
      ...(rationale ? { rationale } : {}),
    });
  });

  const description = (input.description ?? "").trim();
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    issues.push({
      level: "error",
      code: "too-long",
      message: `Description exceeds ${MAX_DESCRIPTION_LENGTH} characters.`,
    });
  }
  const metadataMessage = (input.metadataMessage ?? "").trim();
  if (metadataMessage.length > MAX_METADATA_MESSAGE_LENGTH) {
    issues.push({
      level: "error",
      code: "too-long",
      message: `Metadata message exceeds ${MAX_METADATA_MESSAGE_LENGTH} characters.`,
    });
  }

  if (outputs.length === 0 && certificates.length === 0 && votes.length === 0) {
    issues.push({
      level: "error",
      code: "no-actions",
      message: "Nothing to build: give at least one recipient, certificate or vote.",
    });
  }

  return {
    spec: {
      v: 1,
      walletId: input.walletId,
      outputs,
      certificates,
      votes,
      description,
      metadataMessage,
    },
    issues,
  };
}

/**
 * Project a spec onto the builder's draft model with deterministic ids, so
 * the draft built at propose time is structurally identical to the one
 * previewed (the ids are only used for issue anchoring and node identity).
 */
export function specToDraft(spec: TxSpec, id: string): TxDraft {
  let draft = createDraft(id);
  spec.outputs.forEach((output, index) => {
    draft = addOutput(draft, {
      id: `out-${index}`,
      address: output.address,
      assets: output.assets.map((asset) => ({ ...asset })),
    }).draft;
  });
  // Ledger order: a registration must precede the delegation it enables,
  // and a deregistration must come last. The model may list them any way.
  const orderedCertificates = [...spec.certificates].sort(
    (a, b) => CERTIFICATE_ORDER[a.kind] - CERTIFICATE_ORDER[b.kind],
  );
  orderedCertificates.forEach((cert, index) => {
    draft = addCertificate(draft, {
      id: `cert-${index}`,
      kind: cert.kind,
      ...(cert.poolId ? { poolId: cert.poolId } : {}),
      origin: "user",
    }).draft;
  });
  spec.votes.forEach((vote, index) => {
    draft = addVote(draft, {
      id: `vote-${index}`,
      govActionTxHash: vote.govActionTxHash,
      govActionIndex: vote.govActionIndex,
      voteKind: vote.voteKind,
      ...(vote.rationale ? { rationaleEdit: vote.rationale } : {}),
    }).draft;
  });
  return {
    ...draft,
    description: spec.description,
    metadata: spec.metadataMessage,
  };
}

export function hasSpecErrors(issues: SpecIssue[]): boolean {
  return issues.some((issue) => issue.level === "error");
}

function shortUnit(unit: string): string {
  return `${unit.slice(0, 8)}…${unit.slice(-6)}`;
}
