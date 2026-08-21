# OAuth 2.1 authorization server

Issues access tokens for the [MCP endpoint](../mcp/README.md), so a user can approve an
AI client through a consent screen instead of pasting a long-lived bot secret into a
config file.

Implements what the MCP 2026-07-28 authorization spec requires of a resource server and
its authorization server: RFC 9728 protected-resource metadata, RFC 8414 AS metadata,
PKCE S256, RFC 8707 audience binding, rotating refresh tokens, and RFC 9207 `iss`.

## Endpoints

| Route | Purpose |
|---|---|
| `/.well-known/oauth-authorization-server` | RFC 8414 AS metadata |
| `/.well-known/oauth-protected-resource[/api/mcp]` | RFC 9728 resource metadata |
| `GET /api/oauth/authorize` | Authorization endpoint → consent screen |
| `POST /api/oauth/decision` | Records consent, issues the code |
| `POST /api/oauth/token` | `authorization_code` + `refresh_token` grants |
| `POST /api/oauth/register` | RFC 7591 DCR (deprecated fallback) |
| `/oauth/consent` | The consent UI |

The two well-known paths are **rewrites** declared in `next.config.js` — Next ignores
dot-directories under `pages/`, so they cannot be files. Both the path-aware and root
forms of the resource metadata are served, because clients probe path-first then root.

## Flow

1. The MCP endpoint answers an unauthenticated request with `401` and a
   `WWW-Authenticate` header naming the resource-metadata URL.
2. The client fetches that, finds `authorization_servers`, and fetches AS metadata.
3. The client obtains a `client_id` (see below) and sends the user to `/api/oauth/authorize`.
4. `authorize` validates everything, then redirects to `/oauth/consent` carrying a
   **signed handle** describing the validated request.
5. The user signs in with their Cardano wallet and approves.
6. `/api/oauth/decision` verifies handle **and** wallet session, issues a code, and
   redirects back to the client.
7. The client exchanges the code at `/api/oauth/token` with its PKCE verifier.

### Why a signed handle

The handle is what binds the approval to a *specific* client, scope set and redirect URI.
The wallet-session cookie proves only "this wallet is present in this browser" — it
carries no notion of what is being approved, so consent is never inferred from the cookie
alone. The consent page cannot alter the handle; `decision` re-verifies it.

## Client registration

Both mechanisms the spec describes, in its stated priority order:

- **Client ID Metadata Documents** — the `client_id` is an https URL serving the client's
  own metadata. Advertised via `client_id_metadata_document_supported: true` plus `"none"`
  in `token_endpoint_auth_methods_supported`; Claude Code selects CIMD only when **both**
  are present. The document's own `client_id` must equal the URL it was fetched from, or a
  document could impersonate another client. The fetch is SSRF-guarded
  (`src/lib/security/ssrf.ts`) because the URL is attacker-controlled.
- **Dynamic Client Registration** — deprecated by the 2026-07-28 revision, kept because a
  client that cannot do CIMD has no other way to get a `client_id`. Open registration, so
  it is rate-limited hard rather than authenticated.

Loopback redirect URIs match with the **port ignored** (RFC 8252): a native client binds
an ephemeral port at runtime and cannot register it in advance. The carve-out applies only
to literal loopback hosts, and never across differing hosts or paths.

## Security properties worth not regressing

Each of these has a test in `src/__tests__/oauthFlow.test.ts` or `oauthTokens.test.ts`:

- **No open redirect.** An unregistered `redirect_uri` is rendered as an error, never
  redirected to. Redirecting it would leak authorization codes to the attacker.
- **PKCE S256 only.** `plain` is not implemented; OAuth 2.1 removes it.
- **Code replay revokes the grant.** A code presented twice means it leaked, so every
  refresh token under that grant is revoked rather than just refusing the request.
- **Codes are consumed atomically** via a conditional `updateMany`, so two concurrent
  redemptions cannot both succeed.
- **Refresh rotation with replay detection.** Presenting a token that already has a
  successor revokes the whole chain.
- **Audience binding.** A token minted for another resource is rejected here.
- **Scope can narrow on refresh, never widen.**
- **Nothing is stored in plaintext** — codes, refresh tokens and client secrets are all
  SHA-256 hashed at rest, and the four tables have RLS enabled in their migration.

## Configuration

`OAUTH_ISSUER_URL` (optional) — canonical issuer origin. Falls back to
`NEXT_PUBLIC_SITE_URL`. Deliberately **not** derived from the request `Host` header in
production: a header-derived issuer would let anyone controlling DNS publish metadata
pointing at their own authorization server. In non-production it does fall back to the
request host so a local `next start` on any port works unconfigured.
