# Bot Features and Usage Guide

This document explains the current bot system in this repository: what exists, how it works, and how to use it end to end.

## What the bot system includes

The bot feature set has four main parts:

1. Claim-based onboarding (no manual secret copy/paste by humans)
2. Bot authentication and scoped JWTs
3. Wallet and governance API capabilities for bots
4. Owner-side management (claim, scope edits, revoke, access grants)

## Core concepts

- `BotKey`: Credential record owned by a human wallet address.
- `BotUser`: Runtime bot identity mapped to one `paymentAddress`.
- `PendingBot`: Temporary registration record created by bot self-registration.
- `BotClaimToken`: Hashed one-time claim code for secure human claim.
- `WalletBotAccess`: Per-wallet bot access role (`cosigner` or `observer`).
- Bot scopes (`BOT_SCOPES`):
  - `multisig:create`
  - `multisig:read`
  - `multisig:sign`
  - `governance:read`
  - `ballot:write`

## Onboarding flow (claim-only)

Manual "Create bot" provisioning is removed from the user UI. The supported flow is:

1. Bot calls `POST /api/v1/botRegister`.
2. API returns `pendingBotId` and `claimCode`.
3. Human opens User page -> **Claim a bot**, enters both values, approves scopes.
4. API creates `BotKey` + `BotUser` and marks pending registration as claimed.
5. Bot calls `GET /api/v1/botPickupSecret?pendingBotId=...` once.
6. Bot receives `botKeyId` + `secret` and then uses `POST /api/v1/botAuth`.

Important security behavior:

- Claim code TTL: 10 minutes.
- Claim attempts lockout: 3 failed attempts.
- Claim token stored as hash (`sha256`), not plaintext.
- Pickup secret is one-time; second pickup returns `410 already_picked_up`.
- Cleanup job removes expired/stale pending artifacts.

## API quick reference

### 1. Register bot

`POST /api/v1/botRegister` (public, strict rate limit)

Request body:

```json
{
  "name": "My Governance Bot",
  "paymentAddress": "addr1...",
  "stakeAddress": "stake1...",
  "requestedScopes": ["multisig:read", "ballot:write"]
}
```

Response:

```json
{
  "pendingBotId": "cl...",
  "claimCode": "base64url...",
  "claimExpiresAt": "2026-03-06T12:10:00.000Z"
}
```

Note: the request key is `requestedScopes`.

### 2. Human claim

`POST /api/v1/botClaim` (human JWT required)

Request body:

```json
{
  "pendingBotId": "cl...",
  "claimCode": "base64url...",
  "approvedScopes": ["multisig:read", "ballot:write"]
}
```

- `approvedScopes` must be a subset of requested scopes.
- Bot JWTs cannot use this endpoint.

### 3. Bot pickup secret

`GET /api/v1/botPickupSecret?pendingBotId=...` (public, one-time)

Response:

```json
{
  "botKeyId": "cl...",
  "secret": "64_hex_chars",
  "paymentAddress": "addr1..."
}
```

### 4. Bot auth

`POST /api/v1/botAuth`

Request body:

```json
{
  "botKeyId": "cl...",
  "secret": "64_hex_chars",
  "paymentAddress": "addr1...",
  "stakeAddress": "stake1..."
}
```

Response:

```json
{
  "token": "<jwt>",
  "botId": "cl..."
}
```

`multisig:read` is required on the bot key for auth to succeed.

### 5. Bot self info

`GET /api/v1/botMe` with `Authorization: Bearer <bot-jwt>`

Useful for discovering `ownerAddress` (human claimer address).

## Postman setup for all bot endpoints

This section gives you a complete Postman workflow to test every bot-related route in this repo.

### 1. Create a Postman environment

Create an environment named `multisig-local` with these variables:

- `baseUrl` = `http://localhost:3000`
- `paymentAddress` = `addr1...` (bot payment address)
- `stakeAddress` = `stake1...` (optional)
- `ownerJwt` = ``(human JWT used for`/api/v1/botClaim`)
- `pendingBotId` = ``
- `claimCode` = ``
- `botKeyId` = ``
- `botSecret` = ``
- `botToken` = ``
- `walletId` = ``
- `transactionId` = ``
- `ballotId` = ``

Optional helper variables:

- `network` = `1`
- `proposalId` = `<txHash>#<certIndex>`

### 2. Create a collection-level auth helper

At the collection level, add this **Pre-request Script**:

```javascript
const token = pm.environment.get("botToken");
if (token) {
  pm.request.headers.upsert({ key: "Authorization", value: `Bearer ${token}` });
}
```

For endpoints that must not send bot auth (`botRegister`, `botPickupSecret`) or that need human auth (`botClaim`), override/remove the `Authorization` header at request level.

### 3. Optional request scripts to auto-save values

Use these snippets in the **Tests** tab of specific requests.

`POST /api/v1/botRegister`:

```javascript
if (pm.response.code === 201) {
  const json = pm.response.json();
  pm.environment.set("pendingBotId", json.pendingBotId);
  pm.environment.set("claimCode", json.claimCode);
}
```

`GET /api/v1/botPickupSecret`:

```javascript
if (pm.response.code === 200) {
  const json = pm.response.json();
  pm.environment.set("botKeyId", json.botKeyId);
  pm.environment.set("botSecret", json.secret);
  pm.environment.set("paymentAddress", json.paymentAddress);
}
```

`POST /api/v1/botAuth`:

```javascript
if (pm.response.code === 200) {
  const json = pm.response.json();
  pm.environment.set("botToken", json.token);
}
```

### 4. Endpoint checklist (all bot routes)

Use this as your complete Postman request matrix.

| Endpoint                            | Method | Auth                   | Required scope                       | Minimal input                                                                           |
| ----------------------------------- | ------ | ---------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- | -------------- | ------ |
| `/api/v1/botRegister`               | `POST` | None                   | None                                 | `{ "name", "paymentAddress", "stakeAddress?", "requestedScopes": [..] }`                |
| `/api/v1/botClaim`                  | `POST` | Human JWT (`ownerJwt`) | N/A                                  | `{ "pendingBotId", "claimCode", "approvedScopes" }`                                     |
| `/api/v1/botPickupSecret`           | `GET`  | None                   | None                                 | Query: `pendingBotId={{pendingBotId}}`                                                  |
| `/api/v1/botAuth`                   | `POST` | None                   | Bot key must include `multisig:read` | `{ "botKeyId", "secret", "paymentAddress", "stakeAddress?" }`                           |
| `/api/v1/botMe`                     | `GET`  | Bot JWT                | None                                 | No body                                                                                 |
| `/api/v1/walletIds`                 | `GET`  | Bot JWT                | None                                 | Query: `address={{paymentAddress}}`                                                     |
| `/api/v1/pendingTransactions`       | `GET`  | Bot JWT                | Wallet access required               | Query: `walletId={{walletId}}&address={{paymentAddress}}`                               |
| `/api/v1/freeUtxos`                 | `GET`  | Bot JWT                | Wallet access required               | Query: `walletId={{walletId}}&address={{paymentAddress}}`                               |
| `/api/v1/createWallet`              | `POST` | Bot JWT                | `multisig:create`                    | See payload template below                                                              |
| `/api/v1/addTransaction`            | `POST` | Bot JWT                | Wallet `cosigner` access             | `{ "walletId", "address", "txCbor", "txJson", "description?" }`                         |
| `/api/v1/signTransaction`           | `POST` | Bot JWT                | Wallet `cosigner` access             | `{ "walletId", "transactionId", "address", "signature", "key", "broadcast?" }`          |
| `/api/v1/submitDatum`               | `POST` | Bot JWT                | Wallet `cosigner` access             | `{ "walletId", "signature", "key", "address", "datum", "callbackUrl", "description?" }` |
| `/api/v1/governanceActiveProposals` | `GET`  | Bot JWT                | `governance:read`                    | Query: `network=0                                                                       | 1&details=true | false` |
| `/api/v1/botBallotsUpsert`          | `POST` | Bot JWT                | `ballot:write` + wallet `cosigner`   | `{ "walletId", "ballotId?", "ballotName?", "proposals": [...] }`                        |

Note on `/api/v1/nativeScript`: it is not bot-specific. It requires `address` to match JWT and uses wallet ownership/signer authorization flow, so include it only if your bot address is valid for the target wallet.

### 5. Request templates for Postman

`POST {{baseUrl}}/api/v1/botRegister`

```json
{
  "name": "My Governance Bot",
  "paymentAddress": "{{paymentAddress}}",
  "stakeAddress": "{{stakeAddress}}",
  "requestedScopes": [
    "multisig:read",
    "multisig:create",
    "multisig:sign",
    "governance:read",
    "ballot:write"
  ]
}
```

`POST {{baseUrl}}/api/v1/botClaim`

Headers:

- `Authorization: Bearer {{ownerJwt}}`

Body:

```json
{
  "pendingBotId": "{{pendingBotId}}",
  "claimCode": "{{claimCode}}",
  "approvedScopes": [
    "multisig:read",
    "multisig:create",
    "multisig:sign",
    "governance:read",
    "ballot:write"
  ]
}
```

`GET {{baseUrl}}/api/v1/botPickupSecret?pendingBotId={{pendingBotId}}`

`POST {{baseUrl}}/api/v1/botAuth`

```json
{
  "botKeyId": "{{botKeyId}}",
  "secret": "{{botSecret}}",
  "paymentAddress": "{{paymentAddress}}",
  "stakeAddress": "{{stakeAddress}}"
}
```

`POST {{baseUrl}}/api/v1/createWallet`

```json
{
  "name": "Bot-owned Wallet",
  "description": "Created from Postman",
  "signersAddresses": ["{{paymentAddress}}"],
  "signersDescriptions": ["Bot signer"],
  "numRequiredSigners": 1,
  "scriptType": "atLeast",
  "network": 1
}
```

`POST {{baseUrl}}/api/v1/botBallotsUpsert`

```json
{
  "walletId": "{{walletId}}",
  "ballotName": "Bot test ballot",
  "proposals": [
    {
      "proposalId": "{{proposalId}}",
      "proposalTitle": "Example governance action",
      "choice": "Yes",
      "rationaleComment": "Automated test vote"
    }
  ]
}
```

### 6. Suggested Postman run order

Run requests in this order:

1. `botRegister`
2. `botClaim` (human JWT)
3. `botPickupSecret` (first time should return `200`)
4. `botAuth` (saves `botToken`)
5. `botMe`
6. `walletIds`
7. `pendingTransactions`
8. `freeUtxos`
9. `createWallet` (if testing creation scope)
10. `governanceActiveProposals` (if testing governance scope)
11. `botBallotsUpsert` (if testing ballot scope)
12. `addTransaction` / `signTransaction` / `submitDatum` (when you have valid tx/signature data)
13. `botPickupSecret` again (expected `410 already_picked_up`)

### 7. Known gotchas while testing in Postman

- `botClaim` rejects bot JWTs. Use a human JWT in `ownerJwt`.
- `approvedScopes` in `botClaim` must be a subset of `requestedScopes`.
- `walletIds`, `pendingTransactions`, and `freeUtxos` require `address={{paymentAddress}}` and must match JWT address.
- `createWallet` only accepts bot JWTs and requires `multisig:create`.
- `signTransaction` requires the signature public key to match the `address` payment key hash.
- `submitDatum` currently requires `callbackUrl` in request body.
- Several endpoints are rate-limited. Repeated rapid calls can return `429`/`503` depending on provider path.

## Bot capabilities by endpoint

Use bot JWT bearer auth after `botAuth`.

### Wallet discovery and reads

- `GET /api/v1/walletIds?address=<bot-payment-address>`
  - Returns wallets visible to the bot.
- `GET /api/v1/pendingTransactions?walletId=<id>&address=<bot-payment-address>`
- `GET /api/v1/freeUtxos?walletId=<id>&address=<bot-payment-address>`

### Wallet creation

- `POST /api/v1/createWallet`
  - Requires bot JWT and `multisig:create` scope.
  - Grants the bot `cosigner` access to the created wallet.

### Transaction flows

- `POST /api/v1/addTransaction`
  - Bot must have wallet access and mutating rights (`cosigner`).
- `POST /api/v1/signTransaction`
  - Bot must be `cosigner` and signer address must match payload address.
- `POST /api/v1/submitDatum`
  - Bot path enforces wallet access checks for mutating operation.

### Governance flows

- `GET /api/v1/governanceActiveProposals?network=0|1&details=true|false`
  - Requires `governance:read` scope.
- `POST /api/v1/botBallotsUpsert`
  - Requires `ballot:write` scope.
  - Requires wallet `cosigner` access.
  - Accepts vote choices and optional `rationaleComment`.
  - Bots cannot set `anchorUrl`/`anchorHash` directly.

## Owner-side management in UI

User page -> `BotManagementCard` supports:

- Claiming bots via 3-step dialog:
  - enter code
  - review requested scopes
  - success confirmation
- Listing claimed bots
- Editing bot scopes
- Revoking bot keys

Empty state now guides users to register and claim bots (not manual creation).

## Wallet access roles for bots

Roles are stored in `WalletBotAccess`:

- `cosigner`: read + mutating wallet actions
- `observer`: read-only access where allowed

Mutating endpoints call wallet access checks that require `cosigner`.

## Reference client (`scripts/bot-ref`)

Use `scripts/bot-ref/bot-client.ts` for local testing.

Setup:

```bash
cd scripts/bot-ref
npm install
```

### Register

```bash
BOT_CONFIG='{"baseUrl":"http://localhost:3000","paymentAddress":"addr1..."}' npx tsx bot-client.ts register "Reference Bot" multisig:read,governance:read,ballot:write
```

### Pickup after human claim

```bash
BOT_CONFIG='{"baseUrl":"http://localhost:3000"}' npx tsx bot-client.ts pickup <pendingBotId>
```

### Authenticate

```bash
BOT_CONFIG='{"baseUrl":"http://localhost:3000","botKeyId":"...","secret":"...","paymentAddress":"addr1..."}' npx tsx bot-client.ts auth
```

### Call APIs

```bash
BOT_TOKEN='<jwt>' BOT_CONFIG_PATH=bot-config.json npx tsx bot-client.ts walletIds
BOT_TOKEN='<jwt>' BOT_CONFIG_PATH=bot-config.json npx tsx bot-client.ts botMe
BOT_TOKEN='<jwt>' BOT_CONFIG_PATH=bot-config.json npx tsx bot-client.ts pendingTransactions <walletId>
BOT_TOKEN='<jwt>' BOT_CONFIG_PATH=bot-config.json npx tsx bot-client.ts freeUtxos <walletId>
```

`bot-config.sample.json` documents the expected config shape for registration and authenticated phases.

## Ops and housekeeping

### Cleanup endpoint

`POST /api/cron/cleanupPendingBots` (requires `Authorization: Bearer <CRON_SECRET>`)

It performs:

- Delete expired unclaimed pending bots
- Delete consumed claim tokens older than 1 hour
- Clear stale unpicked secrets on claimed pending bots

### Scheduled workflow

`.github/workflows/cleanup-pending-bots.yml` runs every 15 minutes and invokes the cleanup endpoint.

## Troubleshooting

- `400 invalid_registration_payload`
  - Check `name`, `paymentAddress`, and `requestedScopes` values.
- `409 address_already_registered`
  - Address is already linked to an existing bot identity.
- `409 invalid_or_expired_claim_code`
  - Wrong code or expired registration.
- `409 claim_locked_out`
  - Too many failed attempts; bot must register again.
- `410 already_picked_up`
  - Credentials were already collected.
- `403 Insufficient scope`
  - Add/approve required scope and re-authenticate.
- `403 Not authorized for this wallet`
  - Ensure wallet access exists and role is `cosigner` for mutating actions.

## Recommended end-to-end test sequence

1. Register a bot via `botRegister`.
2. Claim in UI and narrow scopes if needed.
3. Pickup credentials once.
4. Authenticate with `botAuth`.
5. Verify identity with `botMe`.
6. Verify wallet visibility with `walletIds`.
7. Exercise one read endpoint and one scoped endpoint (for example governance or transaction flow).
8. Confirm second pickup attempt returns `410`.
