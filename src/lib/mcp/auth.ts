import jwt from "jsonwebtoken";
import type { NextApiRequest } from "next";

import { db } from "@/server/db";
import { parseScope, scopeIncludes, type BotScope } from "@/lib/auth/botKey";
import { isBotJwt, verifyJwt } from "@/lib/verifyJwt";
import { MCP_SCOPES, isMcpScope, type McpScope } from "@/lib/mcp/scopes";
import { issuerOrigin, resourceUrl } from "@/lib/oauth/config";
import { verifyAccessToken } from "@/lib/oauth/accessToken";

const { sign } = jwt;

/**
 * The authenticated principal behind one MCP request.
 *
 * Everything the tool layer needs is resolved once, up front, per request —
 * there is no session, so nothing is cached between requests.
 */
export type McpCaller = {
  /** Address the tools act as. v1 handlers compare their `address` param to this. */
  subject: string;
  /** Every address this grant covers. `subject` is always a member. */
  addresses: string[];
  scopes: McpScope[];
  /** Human-readable identity of the MCP client, for `multisig_whoami`. */
  clientName: string | null;
  /** Set only when the caller authenticated as a bot rather than a human. */
  botId: string | null;
  /** Epoch seconds. The SDK's bearer helpers reject tokens without one. */
  expiresAt: number;
};

/**
 * Mint a short-lived internal bearer for `invokeV1`.
 *
 * This is *not* the caller's own token. The v1 handlers expect the payload shape
 * from `src/lib/verifyJwt.ts`, which carries no audience and no scope, so it must
 * never be handed back out — it exists only to cross the in-process call boundary
 * and lives for a minute.
 */
export function mintV1Token(caller: McpCaller, address: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is not defined");

  if (!caller.addresses.includes(address)) {
    throw new Error("Address is not covered by this grant");
  }

  const payload =
    caller.botId !== null
      ? { address, botId: caller.botId, type: "bot" as const }
      : { address };

  return sign(payload, secret, { expiresIn: "1m" });
}

/**
 * Resolve the caller from the `Authorization` header.
 *
 * Two credential families are accepted, tried in order:
 *
 *  1. **An OAuth 2.1 access token** issued by this app's authorization server —
 *     the spec-conformant path, audience-bound to this resource.
 *  2. **An existing v1 bearer token** — a human wallet JWT, or a bot JWT from
 *     `POST /api/v1/botAuth`. Kept so existing bots and the REST tooling can
 *     reach the MCP surface without a browser consent flow.
 *
 * The two cannot be confused for each other even though they share `JWT_SECRET`:
 * OAuth tokens carry the subject in `sub` (so `verifyJwt` rejects them) and are
 * typed `mcp_at` (so a v1 token fails OAuth verification). See
 * `src/lib/oauth/tokens.ts`.
 *
 * Returns `null` for anything unauthenticated — the caller turns that into a 401
 * with the RFC 9728 challenge.
 */
export async function resolveMcpCaller(
  req: NextApiRequest,
): Promise<McpCaller | null> {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return null;

  const oauth = verifyAccessToken(token, {
    issuer: issuerOrigin(req),
    resource: resourceUrl(req),
  });
  if (oauth) {
    // The stored grant is authoritative, not the token's `scope` claim.
    //
    // Access tokens are self-contained and live for an hour, so trusting the
    // claim alone would mean a permission removed in the profile — or the whole
    // connection revoked — kept working until the token happened to expire.
    // Re-reading the grant costs one indexed lookup and makes the UI mean what
    // it says: changes apply on the very next request.
    const grant = await db.oAuthGrant.findUnique({
      where: {
        subjectAddress_clientId: {
          subjectAddress: oauth.subject,
          clientId: oauth.clientId,
        },
      },
    });
    if (!grant) return null; // revoked, or never granted

    // Intersect rather than replace: a token must never gain reach it was not
    // issued with, even if the grant was later widened.
    const granted = grant.scopes.filter(isMcpScope);
    const scopes = oauth.scopes.filter((s) => granted.includes(s));

    return {
      subject: oauth.subject,
      // The grant also decides which wallets are in play.
      addresses: grant.grantedAddresses.length > 0
        ? oauth.addresses.filter((a) => grant.grantedAddresses.includes(a))
        : oauth.addresses,
      scopes,
      clientName: oauth.clientId,
      botId: null,
      expiresAt: oauth.expiresAt,
    };
  }

  const payload = verifyJwt(token);
  if (!payload) return null;

  const decoded = jwt.decode(token);
  const exp =
    decoded && typeof decoded === "object" && typeof decoded.exp === "number"
      ? decoded.exp
      : Math.floor(Date.now() / 1000) + 3600;

  if (!isBotJwt(payload)) {
    // A human wallet JWT. It grants exactly what the signed-in user can already
    // do through the app's own UI, so the full MCP scope set applies.
    return {
      subject: payload.address,
      addresses: [payload.address],
      scopes: [...MCP_SCOPES],
      clientName: null,
      botId: null,
      expiresAt: exp,
    };
  }

  const botUser = await db.botUser.findUnique({
    where: { id: payload.botId },
    include: { botKey: { select: { name: true, scope: true } } },
  });
  if (!botUser?.botKey) return null;

  return {
    subject: botUser.paymentAddress,
    addresses: [botUser.paymentAddress],
    scopes: mcpScopesForBot(parseScope(botUser.botKey.scope)),
    clientName: botUser.displayName ?? botUser.botKey.name,
    botId: botUser.id,
    expiresAt: exp,
  };
}

/**
 * Project the bot-key scope vocabulary onto the MCP one.
 *
 * A bot never gains reach it did not already have over REST: each MCP scope is
 * granted only if the bot holds the bot scope that guards the same endpoints.
 */
export function mcpScopesForBot(botScopes: BotScope[]): McpScope[] {
  const granted: McpScope[] = [];
  if (scopeIncludes(botScopes, "multisig:read" as BotScope)) {
    granted.push("wallets:read");
  }
  if (scopeIncludes(botScopes, "governance:read" as BotScope)) {
    granted.push("governance:read");
  }
  if (scopeIncludes(botScopes, "ballot:write" as BotScope)) {
    granted.push("ballots:write");
  }
  return granted;
}
