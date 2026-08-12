import type { UTxO } from "@meshsdk/core";

import type { AssetQuantity } from "./token-flow";

/**
 * Editable intent model for the canvas transaction builder. The draft — not
 * the React Flow canvas — is the source of truth: canvas gestures and
 * inspector forms dispatch mutations against it, and the canvas renders a
 * projection via `draftToTokenFlow`.
 *
 * Asset amounts are stored in BASE units (lovelace / token base quantity) as
 * BigInt-safe strings so validation and building are exact integer math; only
 * the inspector converts to display units via asset metadata decimals.
 */

export type DraftOutput = {
  /** Stable per-output id; survives address edits and drives node identity. */
  id: string;
  /** Empty string while unset; bech32 payment address once chosen. */
  address: string;
  assets: AssetQuantity[];
};

export type DraftUtxoSelection =
  | { mode: "auto" } // keepRelevant over available UTxOs at build time
  | { mode: "manual"; utxos: UTxO[] };

export type DraftVoteKind = "Yes" | "No" | "Abstain";

/**
 * A governance vote loaded from an existing pending transaction. Votes can't
 * be created in the builder (that stays on the governance pages) — the
 * choice can be changed, the rationale edited or cleared, or the vote
 * removed. The voter is re-derived from the wallet's DRep identity at build
 * time.
 */
export type DraftVote = {
  /** Stable per-vote id; generated at load, drives inspector row identity. */
  id: string;
  /** Governance action ref; proposalId = `${govActionTxHash}#${govActionIndex}`. */
  govActionTxHash: string;
  govActionIndex: number;
  voteKind: DraftVoteKind;
  /**
   * Rationale anchor preserved from the loaded tx; replaced at build time
   * when `rationaleEdit` is set.
   */
  anchor?: { anchorUrl: string; anchorDataHash: string };
  /**
   * Edited rationale text; present ONLY when the user changed it.
   * ""/whitespace clears the anchor on rebuild; non-empty re-uploads the
   * CIP-100 document and attaches a new anchor.
   */
  rationaleEdit?: string;
  /** Voter drepId as stored in the loaded txJson — provenance only. */
  originalDrepId?: string;
};

export type TxDraft = {
  /** Draft id; the flow tx node id becomes `txd:<id>`. */
  id: string;
  outputs: DraftOutput[];
  utxoSelection: DraftUtxoSelection;
  /** Off-chain description shown to signers (≤128 chars convention). */
  description: string;
  /** On-chain 674 metadata message ("" = none). */
  metadata: string;
  /**
   * v1 extension point: typed as never[] so it can only be empty today;
   * widened to real certificate intents when staking and DRep actions land
   * in the builder.
   */
  certificates: never[];
  /** Governance votes loaded from an existing pending transaction. */
  votes: DraftVote[];
};

/** What the builder UI currently has selected (canvas card or edge click). */
export type BuilderSelection =
  | { kind: "output"; outputId: string }
  | { kind: "tx" }
  | null;
