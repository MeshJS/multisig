/**
 * Types for the Ekklesia / Intersect Hydra voting API.
 * See src/lib/ekklesia/SPEC.md for the full reverse-engineered spec.
 */
import type { NativeScript } from "@meshsdk/core";

/** The Intersect 2026 budget ballot id (source: "hydra"). */
export const BUDGET_2026_BALLOT_ID = "6a1512d782978c99456fe6de";

/** Credential type a voter authenticates / votes as. We only use "drep". */
export type EkklesiaSignType = "drep" | "stake" | "pool" | "address";

/** A single option for a binary/multi question (e.g. Yes=1, No=2). */
export interface EkklesiaQuestionOption {
  label: string;
  value: number;
}

/** One proposal/question within a Hydra ballot. */
export interface EkklesiaQuestion {
  questionId: string;
  question: string;
  description: string;
  method: string; // "binary" for budget proposals
  options: EkklesiaQuestionOption[];
  minSelections: number;
  maxSelections: number;
  requireAnswer: boolean;
  contentHash: string;
}

/** The on-Hydra ballot definition embedded in a ballot's `hydra.ballot`. */
export interface EkklesiaHydraBallot {
  title: string;
  description: string;
  specVersion: string;
  endEpoch: number;
  questions: EkklesiaQuestion[];
  ekklesia: {
    namespace: string;
    votingAuthority: string;
    context: string;
    acceptedCredentials: string[];
    merkleRoot: string;
    votingWindow: { open: string; close: string };
  };
}

/** A ballot as returned by `GET /v1/ballots/:id`. */
export interface EkklesiaBallot {
  id: string;
  source: string;
  title: string;
  description: string;
  status: string;
  voterType: string;
  voteWeighted: boolean;
  votePeriodStart: string;
  votePeriodEnd: string;
  hydra: {
    headStatus: string;
    ballotCid: string;
    instancePolicyId: string;
    ballot: EkklesiaHydraBallot;
  };
}

/** A single vote selection sent in a draft body. */
export type EkklesiaVoteItem =
  | { questionId: string; selection: number[] }
  | { questionId: string; abstain: true };

/** Request body for `POST /v1/votes/:ballotId/draft`. */
export interface EkklesiaDraftRequest {
  votes: EkklesiaVoteItem[];
  /** Required for multisig DReps: the DRep native script (so the server can
   * parse the required-signer set / threshold). */
  nativeScript?: NativeScript;
}

/** Response from `POST /v1/votes/:ballotId/draft`. */
export interface EkklesiaDraftResponse {
  merkleRoot: string;
  nonce?: string;
  status?: string;
  multisig?: EkklesiaMultisigState | null;
  id?: string;
  _id?: string;
  package?: { id?: string; _id?: string; status?: string };
  error?: string;
}

/** Multisig progress info attached to a draft/package. */
export interface EkklesiaMultisigState {
  required?: number;
  collected?: number;
  signers?: string[];
  [key: string]: unknown;
}

/**
 * A vote witness. Mesh's `DataSignature` (`{ signature, key }`) is accepted
 * directly; the server also accepts `{ COSE_Sign1_hex, COSE_Key_hex }`.
 */
export interface EkklesiaWitness {
  signature: string;
  key: string;
}

/** A vote "package" as returned by `GET /v1/votes/:ballotId/packages`. */
export interface EkklesiaPackage {
  id?: string;
  _id?: string;
  status: string; // e.g. "awaiting-signatures", "submitted"
  merkleRoot?: string;
  nonce?: string;
  multisig?: EkklesiaMultisigState | null;
  votes?: unknown;
}

/** Auth challenge from `POST /v1/session`. */
export interface EkklesiaSessionChallenge {
  /** The nonce to sign with CIP-8 (hex). */
  dataHex: string;
  userId?: string;
  userIdHex?: string;
  signerAddressHex?: string;
  merkleRoot?: string;
  error?: string;
}
