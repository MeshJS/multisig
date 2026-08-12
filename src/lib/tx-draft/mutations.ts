import type {
  DraftCertificate,
  DraftOutput,
  DraftUtxoSelection,
  DraftVote,
  DraftVoteKind,
  TxDraft,
} from "@/types/tx-draft";
import { safeBigInt } from "./assets";

/**
 * Pure draft mutations: every function returns a new draft and never touches
 * its input, so the zustand store stays a thin wrapper and everything here is
 * trivially unit-testable.
 */

function generateId(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}

export function createDraft(id?: string): TxDraft {
  return {
    id: id ?? generateId(),
    outputs: [],
    utxoSelection: { mode: "auto" },
    description: "",
    metadata: "",
    certificates: [],
    votes: [],
  };
}

export function addOutput(
  draft: TxDraft,
  partial?: Partial<DraftOutput>,
): { draft: TxDraft; outputId: string } {
  const outputId = partial?.id ?? generateId();
  const output: DraftOutput = {
    id: outputId,
    address: partial?.address ?? "",
    assets: partial?.assets ?? [],
  };
  return { draft: { ...draft, outputs: [...draft.outputs, output] }, outputId };
}

export function updateOutput(
  draft: TxDraft,
  outputId: string,
  patch: Partial<Omit<DraftOutput, "id">>,
): TxDraft {
  return {
    ...draft,
    outputs: draft.outputs.map((output) =>
      output.id === outputId ? { ...output, ...patch } : output,
    ),
  };
}

export function removeOutput(draft: TxDraft, outputId: string): TxDraft {
  return {
    ...draft,
    outputs: draft.outputs.filter((output) => output.id !== outputId),
  };
}

/**
 * Upserts one asset on an output; a zero quantity removes the entry so the
 * inspector's amount field can clear an asset without a separate action.
 */
export function setOutputAsset(
  draft: TxDraft,
  outputId: string,
  unit: string,
  quantity: string,
): TxDraft {
  return {
    ...draft,
    outputs: draft.outputs.map((output) => {
      if (output.id !== outputId) return output;
      if (safeBigInt(quantity) === 0n) {
        return {
          ...output,
          assets: output.assets.filter((asset) => asset.unit !== unit),
        };
      }
      const exists = output.assets.some((asset) => asset.unit === unit);
      return {
        ...output,
        // Update in place so inspector asset rows keep their order.
        assets: exists
          ? output.assets.map((asset) =>
              asset.unit === unit ? { unit, quantity } : asset,
            )
          : [...output.assets, { unit, quantity }],
      };
    }),
  };
}

export function setUtxoSelection(
  draft: TxDraft,
  utxoSelection: DraftUtxoSelection,
): TxDraft {
  return { ...draft, utxoSelection };
}

export function setDescription(draft: TxDraft, description: string): TxDraft {
  return { ...draft, description };
}

export function setMetadata(draft: TxDraft, metadata: string): TxDraft {
  return { ...draft, metadata };
}

/**
 * Appends a staking certificate loaded from an existing pending transaction.
 * The builder never creates certificates from scratch — this exists for
 * `txJsonToDraft`.
 */
export function addCertificate(
  draft: TxDraft,
  partial: Omit<DraftCertificate, "id"> & { id?: string },
): { draft: TxDraft; certificateId: string } {
  const certificateId = partial.id ?? generateId();
  const certificate: DraftCertificate = { ...partial, id: certificateId };
  return {
    draft: { ...draft, certificates: [...draft.certificates, certificate] },
    certificateId,
  };
}

/**
 * Changes the target pool of a delegation certificate. Guarded to
 * DelegateStake so a stray call can't attach a pool to a register/deregister
 * cert. There is deliberately no removeCertificate: dropping one half of a
 * register/delegate pair would build a chain-invalid transaction.
 */
export function updateCertificatePool(
  draft: TxDraft,
  certificateId: string,
  poolId: string,
): TxDraft {
  return {
    ...draft,
    certificates: draft.certificates.map((certificate) =>
      certificate.id === certificateId && certificate.kind === "DelegateStake"
        ? { ...certificate, poolId }
        : certificate,
    ),
  };
}

/**
 * Appends a vote loaded from an existing pending transaction. The builder
 * never creates votes from scratch — this exists for `txJsonToDraft`.
 */
export function addVote(
  draft: TxDraft,
  partial: Omit<DraftVote, "id"> & { id?: string },
): { draft: TxDraft; voteId: string } {
  const voteId = partial.id ?? generateId();
  const vote: DraftVote = { ...partial, id: voteId };
  return { draft: { ...draft, votes: [...draft.votes, vote] }, voteId };
}

export function updateVoteKind(
  draft: TxDraft,
  voteId: string,
  voteKind: DraftVoteKind,
): TxDraft {
  return {
    ...draft,
    votes: draft.votes.map((vote) =>
      vote.id === voteId ? { ...vote, voteKind } : vote,
    ),
  };
}

export function removeVote(draft: TxDraft, voteId: string): TxDraft {
  return {
    ...draft,
    votes: draft.votes.filter((vote) => vote.id !== voteId),
  };
}

/**
 * Detaches the rationale anchor from a vote. Also drops any pending
 * rationale edit so a stale edit can't resurrect a rationale the user
 * explicitly detached.
 */
export function clearVoteAnchor(draft: TxDraft, voteId: string): TxDraft {
  return {
    ...draft,
    votes: draft.votes.map((vote) => {
      if (vote.id !== voteId) return vote;
      const { anchor: _anchor, rationaleEdit: _edit, ...rest } = vote;
      return rest;
    }),
  };
}

/** Sets the edited rationale text; undefined reverts the vote to untouched. */
export function setVoteRationale(
  draft: TxDraft,
  voteId: string,
  text: string | undefined,
): TxDraft {
  return {
    ...draft,
    votes: draft.votes.map((vote) => {
      if (vote.id !== voteId) return vote;
      if (text === undefined) {
        const { rationaleEdit: _edit, ...rest } = vote;
        return rest;
      }
      return { ...vote, rationaleEdit: text };
    }),
  };
}

/**
 * Replaces (or removes, when undefined) a vote's anchor and consumes its
 * rationaleEdit — used by the build flow after uploading edited rationales.
 */
export function withVoteAnchor(
  draft: TxDraft,
  voteId: string,
  anchor: { anchorUrl: string; anchorDataHash: string } | undefined,
): TxDraft {
  return {
    ...draft,
    votes: draft.votes.map((vote) => {
      if (vote.id !== voteId) return vote;
      const { anchor: _anchor, rationaleEdit: _edit, ...rest } = vote;
      return anchor ? { ...rest, anchor } : rest;
    }),
  };
}
