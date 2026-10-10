import { createHash } from "crypto";
import type { OAuthClient } from "@prisma/client";

import { db } from "@/server/db";
import { assertSafeHost } from "@/lib/security/ssrf";
import {
  isAcceptableRedirectUri,
  isMetadataUrlClientId,
  MAX_REDIRECT_URIS,
} from "@/lib/oauth/redirects";

// Re-exported so existing importers keep one entry point for client concerns.
export {
  findMatchingRedirectUri,
  isAcceptableRedirectUri,
  isMetadataUrlClientId,
  MAX_REDIRECT_URIS,
  redirectUriMatches,
} from "@/lib/oauth/redirects";

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

/**
 * OAuth client resolution.
 *
 * Two registration mechanisms, in the priority the MCP specification sets out:
 *
 *  1. **Client ID Metadata Documents** — the `client_id` IS an https URL serving
 *     the client's own metadata. This is the current recommendation; the client
 *     is portable across authorization servers and nothing is pre-provisioned.
 *  2. **Dynamic Client Registration (RFC 7591)** — deprecated as of the
 *     2026-07-28 revision, kept because clients that cannot do CIMD still rely
 *     on it. Claude Code, for instance, only selects CIMD when the AS advertises
 *     both `client_id_metadata_document_supported` and `"none"` auth.
 */

const CIMD_FETCH_TIMEOUT_MS = 5000;
const CIMD_MAX_BYTES = 64 * 1024;
/** How long a fetched CIMD document is trusted before being re-fetched. */
const CIMD_REVALIDATE_MS = 60 * 60 * 1000;

type CimdDocument = {
  client_id?: unknown;
  client_name?: unknown;
  client_uri?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
};

/**
 * Fetch and validate a Client ID Metadata Document, then cache it as a client row.
 *
 * The document's own `client_id` MUST equal the URL it was fetched from —
 * otherwise a document could impersonate another client's identity.
 */
export async function resolveMetadataUrlClient(
  clientId: string,
): Promise<OAuthClient | null> {
  const cached = await db.oAuthClient.findUnique({ where: { clientId } });
  if (
    cached &&
    Date.now() - cached.lastSeenAt.getTime() < CIMD_REVALIDATE_MS
  ) {
    return cached;
  }

  let doc: CimdDocument;
  try {
    const url = new URL(clientId);
    // The client_id is attacker-controlled, so this fetch is an SSRF sink.
    await assertSafeHost(url.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CIMD_FETCH_TIMEOUT_MS);
    let raw: string;
    try {
      const response = await fetch(clientId, {
        method: "GET",
        redirect: "error",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) return cached ?? null;
      raw = await readCapped(response, CIMD_MAX_BYTES);
    } finally {
      clearTimeout(timer);
    }
    doc = JSON.parse(raw) as CimdDocument;
  } catch {
    // A transient fetch failure must not lock out an already-known client.
    return cached ?? null;
  }

  if (doc.client_id !== clientId) return null;
  if (typeof doc.client_name !== "string" || doc.client_name.length === 0) {
    return null;
  }
  // Same scheme check DCR applies. Without it a CIMD document could register a
  // `javascript:` or plaintext-`http:` redirect target.
  const redirectUris = Array.isArray(doc.redirect_uris)
    ? doc.redirect_uris
        .filter((u): u is string => typeof u === "string")
        .filter(isAcceptableRedirectUri)
        .slice(0, MAX_REDIRECT_URIS)
    : [];
  if (redirectUris.length === 0) return null;

  const data = {
    clientName: doc.client_name.slice(0, 200),
    clientUri: typeof doc.client_uri === "string" ? doc.client_uri : null,
    redirectUris,
    tokenEndpointAuthMethod:
      typeof doc.token_endpoint_auth_method === "string"
        ? doc.token_endpoint_auth_method
        : "none",
    isMetadataUrl: true,
    lastSeenAt: new Date(),
  };

  return db.oAuthClient.upsert({
    where: { clientId },
    update: data,
    create: { clientId, ...data },
  });
}

/**
 * Read at most `maxBytes` of a response body, aborting the stream once past it.
 *
 * `response.text()` would buffer the whole body first and only then let us trim
 * it, so a hostile document could pin arbitrary memory on an unauthenticated
 * request — `/api/oauth/authorize` fetches the client_id URL before any session
 * exists. Reading incrementally caps what is ever resident.
 */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new Error("Client metadata document exceeds the size limit");
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

/** Resolve a client_id by whichever mechanism registered it. */
export async function resolveClient(
  clientId: string,
): Promise<OAuthClient | null> {
  if (isMetadataUrlClientId(clientId)) {
    return resolveMetadataUrlClient(clientId);
  }
  return db.oAuthClient.findUnique({ where: { clientId } });
}
