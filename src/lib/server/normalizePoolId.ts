import { deserializePoolId, resolvePoolId } from "@meshsdk/core";

/**
 * Accepts bech32 `pool1...` or 56-char hex pool id; returns Mesh `delegateStakeCertificate` pool id string.
 */
export function normalizePoolIdForDelegation(poolIdRaw: string): string {
  const poolId = poolIdRaw.trim();
  if (!poolId) {
    throw new Error("poolId is required");
  }
  if (poolId.startsWith("pool")) {
    const hash = deserializePoolId(poolId);
    return resolvePoolId(hash);
  }
  const hex = /^[0-9a-fA-F]{56}$/;
  if (hex.test(poolId)) {
    return resolvePoolId(poolId.toLowerCase());
  }
  throw new Error(
    "Invalid poolId: expected bech32 pool1... or 56-character hex pool id",
  );
}
