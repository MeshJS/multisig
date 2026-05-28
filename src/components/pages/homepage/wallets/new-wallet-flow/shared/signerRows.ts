/**
 * Shared synthetic-id minter for the parallel signer arrays that
 * `useWalletFlowState` and `useMigrationWalletFlowState` maintain
 * (signersAddresses / signersDescriptions / signersStakeKeys /
 * signersDRepKeys / signerIds).
 *
 * Lives in a standalone module — with no React, next/router, zustand,
 * tRPC, or toast imports — so it can be unit-tested without rendering
 * either hook. Both hooks import `makeSignerId` directly when
 * appending a new row.
 */

/**
 * Generate a stable synthetic id for a signer row. `crypto.randomUUID`
 * is available in modern browsers and Node >= 14.17; fall back to a
 * timestamp+random string in environments where it isn't.
 */
export function makeSignerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `signer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
