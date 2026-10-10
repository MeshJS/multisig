/**
 * Orchestration for casting a multisig-DRep vote on an Ekklesia / Hydra ballot.
 *
 * Framework-agnostic: the React layer supplies a `signDataHex` callback (which
 * wraps the connected wallet's CIP-8/CIP-95 `signData`) and persists the shared
 * package via the existing `signable` tRPC router. See SPEC.md.
 *
 * Multisig model: ONE shared draft → one `merkleRoot` / `packageId`; every
 * cosigner signs that same merkleRoot and posts their witness separately. Do not
 * redraft per signer (each draft gets a fresh nonce → a different merkleRoot →
 * witnesses cannot aggregate).
 */
import type { NativeScript } from "@meshsdk/core";
import {
  draftVote,
  merkleRootToDataHex,
  getPackageId,
  requestSession,
  submitSession,
  submitSignature,
} from "./client";
import type {
  EkklesiaQuestion,
  EkklesiaSignType,
  EkklesiaVoteItem,
  EkklesiaWitness,
} from "./types";

export type VoteChoice = "Yes" | "No" | "Abstain";

/** Callback that signs a hex payload with the connected wallet (returns COSE). */
export type SignDataHex = (dataHex: string) => Promise<EkklesiaWitness>;

/**
 * Map a {questionId -> choice} selection into Ekklesia vote items, resolving
 * "Yes"/"No" to the question's option `value` (Yes/No are by-label).
 */
export function buildVoteItems(
  questions: EkklesiaQuestion[],
  choices: Record<string, VoteChoice>,
): EkklesiaVoteItem[] {
  const items: EkklesiaVoteItem[] = [];
  for (const q of questions) {
    const choice = choices[q.questionId];
    if (!choice) continue; // unanswered questions are omitted
    if (choice === "Abstain") {
      items.push({ questionId: q.questionId, abstain: true });
      continue;
    }
    const option = q.options.find(
      (o) => o.label.toLowerCase() === choice.toLowerCase(),
    );
    if (!option) {
      throw new Error(
        `Question ${q.questionId} has no "${choice}" option`,
      );
    }
    items.push({ questionId: q.questionId, selection: [option.value] });
  }
  return items;
}

/**
 * Authenticate one signer with Ekklesia: request a nonce, sign it, exchange for
 * a session. Returns the bearer token (also set as a cookie by the proxy).
 */
export async function authenticate(params: {
  signerAddress: string;
  signType: EkklesiaSignType;
  signDataHex: SignDataHex;
}): Promise<string | undefined> {
  const { signerAddress, signType, signDataHex } = params;
  const challenge = await requestSession(signerAddress, signType);
  if (challenge.error) throw new Error(challenge.error);
  if (!challenge.dataHex) {
    throw new Error("Ekklesia session: no challenge returned");
  }
  const witness = await signDataHex(challenge.dataHex);
  const session = await submitSession(signerAddress, signType, witness);
  return session.token;
}

/**
 * Initiator path: create the shared draft (with the DRep native script) and
 * attach the initiator's witness. Returns the package coordinates that
 * cosigners need (persist these in a `signable` record, method "ekklesia-vote").
 */
export async function createVotePackage(params: {
  ballotId: string;
  votes: EkklesiaVoteItem[];
  nativeScript: NativeScript;
  signDataHex: SignDataHex;
  token?: string;
}): Promise<{ packageId: string; merkleRoot: string; witness: EkklesiaWitness }> {
  const { ballotId, votes, nativeScript, signDataHex, token } = params;
  const draft = await draftVote(ballotId, { votes, nativeScript }, token);
  if (draft.error) throw new Error(draft.error);
  const packageId = getPackageId(draft);
  if (!packageId || !draft.merkleRoot) {
    throw new Error("Ekklesia draft: missing packageId or merkleRoot");
  }
  const witness = await signDataHex(merkleRootToDataHex(draft.merkleRoot));
  const res = await submitSignature(ballotId, packageId, witness, token);
  if (res.error) throw new Error(res.error);
  return { packageId, merkleRoot: draft.merkleRoot, witness };
}

/**
 * Cosigner path: sign the already-created shared merkleRoot and submit the
 * witness against the same package.
 */
export async function coSignVotePackage(params: {
  ballotId: string;
  packageId: string;
  merkleRoot: string;
  signDataHex: SignDataHex;
  token?: string;
}): Promise<EkklesiaWitness> {
  const { ballotId, packageId, merkleRoot, signDataHex, token } = params;
  const witness = await signDataHex(merkleRootToDataHex(merkleRoot));
  const res = await submitSignature(ballotId, packageId, witness, token);
  if (res.error) throw new Error(res.error);
  return witness;
}
