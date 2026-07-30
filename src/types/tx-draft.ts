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

export type TxDraft = {
  /** Draft id; the flow tx node id becomes `txd:<id>`. */
  id: string;
  outputs: DraftOutput[];
  utxoSelection: DraftUtxoSelection;
  /** Defaults to the multisig wallet address at build time. */
  changeAddress?: string;
  /** Off-chain description shown to signers (≤128 chars convention). */
  description: string;
  /** On-chain 674 metadata message ("" = none). */
  metadata: string;
  /**
   * v1 extension points: typed as never[] so they can only be empty today;
   * widened to real certificate/vote intents when staking, DRep and voting
   * actions land in the builder.
   */
  certificates: never[];
  votes: never[];
};

/** What the builder UI currently has selected (canvas card or edge click). */
export type BuilderSelection =
  | { kind: "output"; outputId: string }
  | { kind: "tx" }
  | null;
