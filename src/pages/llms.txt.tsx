import type { GetServerSideProps } from "next";
import { SITE_NAME, DEFAULT_DESCRIPTION, absoluteUrl } from "@/lib/seo";

/**
 * Serves /llms.txt — a concise, machine-readable orientation for AI agents and
 * LLM fetchers (see llmstxt.org). The whole app is a client-only SPA, so a
 * no-JS agent can't discover the bot API by crawling the UI; this file gives it
 * the entry points (OpenAPI spec, downloadable skill, human docs) plus a
 * self-contained bot quickstart so it can start calling the API immediately.
 *
 * Content is built from @/lib/seo so the URLs point at the canonical host of
 * whatever deployment serves this. Keep in sync with src/pages/api/v1/README.md,
 * which is the authoritative endpoint reference.
 */
export function buildLlmsTxt(): string {
  const spec = absoluteUrl("/api/swagger");
  const skill = absoluteUrl("/api/skill");
  const docs = absoluteUrl("/api-docs");

  return `# ${SITE_NAME}

> ${DEFAULT_DESCRIPTION}

${SITE_NAME} exposes a REST bot API (base path \`/api/v1\`, JSON over HTTPS) so
autonomous agents can create wallets, co-sign transactions, delegate stake, and
vote on Cardano governance under M-of-N approval. Every mutating call needs a bot
JWT, and the wallet's signing threshold still applies: a bot can propose and sign,
but funds move only once the required quorum of signatures is collected.

## Start here (machine-readable)

- [OpenAPI 3.0 spec](${spec}): complete, machine-readable definition of every
  endpoint, with an absolute \`servers\` base URL. Feed this to your tooling / codegen.
- [Agent skill (Markdown)](${skill}): a ready-to-load skill describing the full bot
  workflow end to end — download and give it to your agent.
- [Interactive API docs](${docs}): human Swagger UI with a wallet-based bearer-token generator.

## Authentication

Every bot request sends the header \`Authorization: Bearer <jwt>\`. A bot JWT is
minted once through the onboarding flow, then refreshed via botAuth:

1. POST /api/v1/botRegister — bot self-registers with \`requestedScopes\`; returns \`{ pendingBotId, claimCode }\`. Register **without** a \`paymentAddress\` — a fresh bot has no wallet yet; the address is bound later at first botAuth.
2. POST /api/v1/botClaim — the human owner approves the \`claimCode\` using their own JWT.
3. GET  /api/v1/botPickupSecret?pendingBotId=... — bot retrieves \`{ botKeyId, secret }\` exactly once (the secret then stays valid for repeated botAuth).
4. POST /api/v1/botAuth — bot exchanges \`botKeyId\` + \`secret\` for a bot JWT \`{ token, botId }\`. Supply \`paymentAddress\` on the **first** botAuth to bind the bot's identity; the JWT always carries that server-bound address.

Refresh by repeating step 4 (tokens expire after ~1 hour; there is no separate
refresh endpoint). Rotate a leaked secret with POST /api/v1/botRotateSecret
(\`{ botKeyId, secret }\` -> a new secret, returned once). Scopes:
\`multisig:read\`, \`multisig:create\`, \`multisig:sign\`, \`governance:read\`, \`ballot:write\`.
The \`address\` in the JWT must match the \`address\` sent in each request.

Human owners authenticate differently: GET /api/v1/getNonce -> sign the nonce ->
POST /api/v1/authSigner -> JWT.

## Common endpoints

Read:
- GET /api/v1/botMe — the bot's own identity, owner address, and wallet grants.
- GET /api/v1/walletIds?address=... — wallets the caller can access.
- GET /api/v1/freeUtxos?walletId=...&address=... — spendable UTxOs; pass these refs (\`{ txHash, outputIndex }\`) when building transactions.
- GET /api/v1/pendingTransactions?walletId=...&address=... — transactions awaiting signatures.
- GET /api/v1/governanceActiveProposals — active governance proposals (scope \`governance:read\`).
- GET /api/v1/botBallots?walletId=... — the bot's governance ballot drafts (\`ballot:write\`).

Write (required scope in parentheses):
- POST /api/v1/createWallet — create a multisig wallet (\`multisig:create\`).
- POST /api/v1/addTransaction — submit a built tx (CBOR/JSON) for signing or queuing (\`multisig:sign\`).
- POST /api/v1/signTransaction — add a witness; auto-submits when the threshold is met (\`multisig:sign\`).
- POST /api/v1/botStakeCertificate — server-build a stake register/delegate/deregister tx (\`multisig:sign\`).
- POST /api/v1/botDRepCertificate — server-build a DRep register/retire tx (\`multisig:sign\`).
- POST /api/v1/botBallotsUpsert — record governance vote decisions + draft rationale (\`ballot:write\`; an observer grant is enough).

Plutus proxy endpoints (\`/api/v1/proxy*\`) follow the same request pattern; see the OpenAPI spec.

## Notes

- Status: alpha — endpoints may change. The OpenAPI spec at ${spec} is the source of truth.
- UTxO-consuming builders take references only (\`{ txHash, outputIndex }\`) from freeUtxos — never raw UTxO JSON.
- Errors use standard HTTP status codes: 400 validation, 401 auth, 403 scope/access, 409 conflict, 429 rate limit.
`;
}

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600, s-maxage=3600");
  res.write(buildLlmsTxt());
  res.end();
  return { props: {} };
};

export default function LlmsTxt() {
  return null;
}
