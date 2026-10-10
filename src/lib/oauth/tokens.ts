import { db } from "@/server/db";
import type { McpScope } from "@/lib/mcp/scopes";
import { REFRESH_TOKEN_TTL_SECONDS } from "@/lib/oauth/config";
import { generateOpaqueToken, hashToken } from "@/lib/oauth/accessToken";

/**
 * Refresh-token storage and rotation. Everything here touches the database;
 * the pure access-token crypto lives in `@/lib/oauth/accessToken`.
 */

// Re-exported so callers keep a single import site for token concerns.
export {
  ACCESS_TOKEN_TYPE,
  generateOpaqueToken,
  hashToken,
  mintAccessToken,
  verifyAccessToken,
  type AccessTokenClaims,
  type VerifiedAccessToken,
} from "@/lib/oauth/accessToken";

export async function issueRefreshToken(args: {
  clientId: string;
  subjectAddress: string;
  grantedAddresses: string[];
  scopes: readonly McpScope[];
  resource: string;
}): Promise<string> {
  const token = generateOpaqueToken();
  await db.oAuthRefreshToken.create({
    data: {
      tokenHash: hashToken(token),
      clientId: args.clientId,
      subjectAddress: args.subjectAddress,
      grantedAddresses: args.grantedAddresses,
      scopes: [...args.scopes],
      resource: args.resource,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    },
  });
  return token;
}

export type RefreshRedemption =
  | { ok: true; record: NonNullable<Awaited<ReturnType<typeof findRefreshToken>>> }
  | { ok: false; reason: "unknown" | "expired" | "revoked" | "replayed" };

function findRefreshToken(tokenHash: string) {
  return db.oAuthRefreshToken.findUnique({ where: { tokenHash } });
}

/**
 * Redeem a refresh token, rotating it.
 *
 * OAuth 2.1 requires rotation for public clients. Rotation also gives replay
 * detection for free: a token that already has a successor has been used twice,
 * which means it leaked — so the entire chain for that client and subject is
 * revoked rather than just refusing this one request.
 */
export async function redeemRefreshToken(
  token: string,
  clientId: string,
): Promise<RefreshRedemption> {
  const record = await findRefreshToken(hashToken(token));
  if (!record) return { ok: false, reason: "unknown" };
  // A token issued to one client must not be redeemable by another.
  if (record.clientId !== clientId) return { ok: false, reason: "unknown" };

  if (record.replacedById) {
    await revokeChain(record.clientId, record.subjectAddress);
    return { ok: false, reason: "replayed" };
  }

  if (record.revokedAt) return { ok: false, reason: "revoked" };
  if (record.expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }

  // Claim the token atomically before issuing anything against it.
  //
  // The checks above are a read, and issuing takes several more round trips, so
  // without this two concurrent redemptions of the same token would both pass
  // the in-memory `replacedById` check and both mint tokens — defeating the
  // replay detection that rotation exists to provide. The conditional update is
  // the serialization point: exactly one caller sees count === 1.
  const claimed = await db.oAuthRefreshToken.updateMany({
    where: { id: record.id, revokedAt: null, replacedById: null },
    data: { revokedAt: new Date() },
  });
  if (claimed.count === 0) {
    await revokeChain(record.clientId, record.subjectAddress);
    return { ok: false, reason: "replayed" };
  }

  return { ok: true, record };
}

/** Revoke every live refresh token for one (client, subject) pair. */
async function revokeChain(clientId: string, subjectAddress: string) {
  await db.oAuthRefreshToken.updateMany({
    where: { clientId, subjectAddress, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Point a claimed token at its successor.
 *
 * `revokedAt` was already set when the token was claimed in `redeemRefreshToken`;
 * this only records the link, which is what turns a later presentation into a
 * detectable replay rather than a plain "revoked".
 */
export async function markRefreshTokenRotated(
  oldTokenHash: string,
  newToken: string,
): Promise<void> {
  const successor = await db.oAuthRefreshToken.findUnique({
    where: { tokenHash: hashToken(newToken) },
  });
  await db.oAuthRefreshToken.update({
    where: { tokenHash: oldTokenHash },
    data: { replacedById: successor?.id ?? null },
  });
}
