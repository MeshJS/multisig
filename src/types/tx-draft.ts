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
 * A governance vote, either loaded from an existing pending transaction or
 * created in the builder. The choice can be changed, the rationale edited or
 * cleared, or the vote removed. The voter is re-derived from the wallet's
 * DRep identity at build time.
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

export type DraftCertificateKind =
  | "RegisterStake"
  | "DelegateStake"
  | "DeregisterStake";

/**
 * A staking certificate, either loaded from an existing pending transaction
 * or created in the builder. Loaded certs (no `origin`) can only change
 * their delegation pool and can't be removed individually: a
 * register/delegate pair must stay intact, and a lone delegation cert is the
 * whole point of its transaction. User-created certs are removable, but a
 * register+delegate pair (shared `pairId`) is removed atomically. The reward
 * address and staking script are re-derived from the wallet at build time.
 */
export type DraftCertificate = {
  /** Stable per-cert id; generated at load/add, drives inspector row identity. */
  id: string;
  kind: DraftCertificateKind;
  /** Canonical bech32 pool id (pool1...); present only on DelegateStake. */
  poolId?: string;
  /** stakeKeyAddress as stored in the loaded txJson — provenance only. */
  originalStakeAddress?: string;
  /** Present only on certs created in the builder; absent = loaded. */
  origin?: "user";
  /** Shared by the two certs of a user-created register+delegate pair. */
  pairId?: string;
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
  /** Staking certificates, loaded from a pending transaction or added here. */
  certificates: DraftCertificate[];
  /** Governance votes, loaded from a pending transaction or added here. */
  votes: DraftVote[];
};

/** What the builder UI currently has selected (canvas card or edge click). */
export type BuilderSelection =
  | { kind: "output"; outputId: string }
  | { kind: "tx" }
  | null;
