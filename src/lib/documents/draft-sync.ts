/**
 * What the editor should do when the server's draft has moved.
 *
 * Pulled out of the component because this is the one rule in the editor whose
 * failure mode is silently destroying someone's writing, and there is no React
 * testing library here to exercise it in place. As a pure function it can be
 * tested exhaustively.
 *
 * The rule, in words: adopt the server's copy whenever there is nothing local
 * to lose; stop and ask whenever there is. Never merge, because a wrong merge
 * is worse than an honest halt — and `saveDraft` enforces the same thing
 * server-side through the revision, so a lost update stays impossible even if
 * this function is wrong.
 */

export type DraftSyncDecision =
  /** Take the server's body — the local copy has nothing unsaved. */
  | "adopt"
  /** Someone else saved while this author had unsaved edits. Stop. */
  | "conflict"
  /** Nothing to do. */
  | "ignore";

export function decideDraftSync(input: {
  /** Revision the local body was derived from; null before the first load. */
  baseRevision: number | null;
  /** Whether the author has typed since that revision was adopted. */
  dirty: boolean;
  /** Revision the server currently holds, or null when there is no draft yet. */
  remoteRevision: number | null;
}): DraftSyncDecision {
  const { baseRevision, dirty, remoteRevision } = input;

  if (remoteRevision === null) return "ignore";
  // First load: there is nothing local, so the server's copy is the truth.
  if (baseRevision === null) return "adopt";
  // Not newer — including the case where a stale poll answers with an older
  // revision than the one we just saved, which must never roll the author back.
  if (remoteRevision <= baseRevision) return "ignore";

  return dirty ? "conflict" : "adopt";
}
