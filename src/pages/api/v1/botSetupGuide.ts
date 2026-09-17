import type { NextApiRequest, NextApiResponse } from "next";

const BOT_SCOPES = [
  "multisig:read",
  "multisig:create",
  "multisig:sign",
  "governance:read",
  "ballot:write",
] as const;

function originFromRequest(req: NextApiRequest): string {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host = req.headers.host ?? "multisig.meshjs.dev";
  return `${proto}://${host}`;
}

function buildGuide(origin: string): string {
  return `# Mesh Multisig Bot Setup Guide

This document is written for AI agents and developer scripts. It describes the
exact HTTP calls needed to provision a bot identity on this instance and start
operating against multisig wallets.

Instance base URL: \`${origin}\`

## Concepts

- **Bot** — a non-human identity that authenticates with a stored secret and can
  read or sign for multisig wallets to which it has been granted access.
- **Owner** — the human user who claims a registered bot. Owners always
  authorize scopes and grant wallet access.
- **Scopes** — capabilities the bot may exercise. Available values:
  ${BOT_SCOPES.map((s) => `\n  - \`${s}\``).join("")}
- **Wallet access roles** — \`observer\` (read-only) or \`cosigner\` (can sign).

## Five-phase setup

### 1. Register (bot-initiated, no auth)

\`POST ${origin}/api/v1/botRegister\`

Body:
\`\`\`json
{
  "name": "My Bot",
  "paymentAddress": "addr1_your_bot_payment_address",
  "stakeAddress": "stake1_optional",
  "requestedScopes": ["multisig:read"]
}
\`\`\`

Response:
\`\`\`json
{
  "pendingBotId": "cxyz...",
  "claimCode": "base64url_code...",
  "claimExpiresAt": "ISO-8601 timestamp (10 minutes from now)"
}
\`\`\`

Persist \`pendingBotId\` and \`claimCode\`. Surface both to the human user so
they can approve in the UI within 10 minutes.

### 2. Human claim (in the UI)

The human navigates to the **User → Bot accounts** page and enters
\`pendingBotId\` + \`claimCode\`. They review and approve scopes. On success
the server provisions a \`BotKey\` + \`BotUser\` and stages a one-time secret
for pickup. No action from the bot at this stage; poll
\`GET ${origin}/api/v1/botPickupSecret?pendingBotId=...\` for readiness.

### 3. Pickup credentials (bot-initiated, no auth)

\`GET ${origin}/api/v1/botPickupSecret?pendingBotId=cxyz...\`

Response (one-time only; secret is cleared after pickup):
\`\`\`json
{
  "botKeyId": "key_id...",
  "secret": "hex_secret...",
  "paymentAddress": "addr1_your_bot_payment_address"
}
\`\`\`

Persist \`botKeyId\` + \`secret\` in your bot config. Never log the secret.

### 4. Authenticate (exchange secret for JWT)

\`POST ${origin}/api/v1/botAuth\`

Body:
\`\`\`json
{
  "botKeyId": "key_id...",
  "secret": "hex_secret...",
  "paymentAddress": "addr1_your_bot_payment_address"
}
\`\`\`

Response:
\`\`\`json
{
  "token": "JWT...",
  "botId": "bot_id..."
}
\`\`\`

The JWT expires in 1 hour. Re-authenticate with the same secret when it
expires; the secret itself does not rotate.

### 5. Confirm and operate

Send the bearer token on every subsequent request:
\`Authorization: Bearer <token>\`

Sanity check:
\`GET ${origin}/api/v1/botMe\` — returns the bot's own info plus the
\`ownerAddress\` of the human who claimed it.

Once the human grants wallet access in the UI, the bot can call any
bot-enabled endpoint within its scopes.

## Bot-enabled endpoints

| Method | Path | Required scope | Notes |
| --- | --- | --- | --- |
| GET  | \`/api/v1/botMe\` | — | Bot self-info. |
| GET  | \`/api/v1/walletIds?address=<bot_address>\` | \`multisig:read\` | Wallets the bot can access. |
| GET  | \`/api/v1/pendingTransactions\` | \`multisig:read\` | Pending sigs. |
| GET  | \`/api/v1/freeUtxos\` | \`multisig:read\` | Wallet UTxOs. |
| POST | \`/api/v1/createWallet\` | \`multisig:create\` | Create a wallet. |
| POST | \`/api/v1/signTransaction\` | \`multisig:sign\` | Cosigner role required. |
| GET  | \`/api/v1/governanceActiveProposals\` | \`governance:read\` | Live proposals. |
| POST | \`/api/v1/botBallotsUpsert\` | \`ballot:write\` | Draft ballots. |

## Error model

- \`400\` — malformed request body or missing parameter.
- \`401\` — missing/expired/invalid JWT, or secret mismatch.
- \`403\` — insufficient scope or wallet access role.
- \`409\` — disambiguation needed (e.g., ballot name collision).
- \`429\` — rate limited.

## Reference client

A Node/TypeScript reference client lives at
\`scripts/bot-ref/bot-client.ts\` in the repo. It exercises the full
register → claim → pickup → auth → operate flow.

## Audit

All claim, auth, and privilege-changing actions are recorded in the
\`AuditLog\` table on the server. Treat your bot's secret like a password.
`;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }
  const guide = buildGuide(originFromRequest(req));
  res.setHeader("Content-Type", "text/markdown; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).send(guide);
}
