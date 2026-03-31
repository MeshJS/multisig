# API v1 Directory

A comprehensive REST API implementation for the multisig wallet application, providing secure endpoints for wallet management, transaction handling, authentication, and blockchain interactions. This API follows RESTful principles with JWT-based authentication and comprehensive error handling.

## Authentication & Security

### JWT-Based Authentication

- **Bearer Token Authentication**: All endpoints require valid JWT tokens
- **Address-Based Authorization**: Token payload contains user address for authorization
- **Session Management**: 1-hour token expiration with automatic renewal
- **CORS Support**: Cross-origin resource sharing enabled for web clients
- **Address Validation**: Strict address matching between token and request parameters

### Security Features

- **Input Validation**: Comprehensive parameter validation and sanitization
- **Error Handling**: Detailed error responses without sensitive information exposure
- **Rate Limiting**: Built-in protection against abuse (via CORS and validation)
- **Signature Verification**: Cryptographic signature validation for sensitive operations

## Core API Endpoints

### Transaction Management

#### `addTransaction.ts` - POST `/api/v1/addTransaction`

- **Purpose**: Submit external transactions for multisig wallet processing
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - Transaction submission with CBOR and JSON formats
  - Automatic blockchain submission for single-signer wallets
  - Multisig transaction queuing for multi-signer wallets
  - Address validation and authorization
  - Callback URL support for external integrations
- **Request Body**:
  - `walletId`: Wallet identifier
  - `address`: Signer address
  - `txCbor`: Transaction in CBOR format
  - `txJson`: Transaction in JSON format
  - `description`: Optional transaction description
  - `callbackUrl`: Optional callback URL
- **Response**: Transaction object with ID, state, and metadata
- **Error Handling**: 400 (validation), 401 (auth), 403 (authorization), 500 (server)

#### `pendingTransactions.ts` - GET `/api/v1/pendingTransactions`

- **Purpose**: Retrieve all pending multisig transactions for a wallet
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - Wallet ownership validation and JWT address enforcement
  - Pending transaction listing with signature status metadata
  - Supports multisig coordination for outstanding approvals
- **Query Parameters**:
  - `walletId`: Wallet identifier
  - `address`: Requester address (must match JWT payload)
- **Response**: Array of pending transaction objects with signature state details
- **Error Handling**: 400 (validation), 401 (auth), 403 (authorization), 404 (not found), 405 (method), 500 (server)

#### `submitDatum.ts` - POST `/api/v1/submitDatum`

- **Purpose**: Submit signable payloads for multisig signature collection
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - Cryptographic signature verification
  - Signable payload creation and management
  - Multi-signature collection workflow
  - Remote origin tracking for external integrations
  - Callback URL support for completion notifications
- **Request Body**:
  - `walletId`: Wallet identifier
  - `address`: Signer address
  - `datum`: Signable payload data
  - `signature`: Cryptographic signature
  - `key`: Public key for signature verification
  - `description`: Optional description
  - `callbackUrl`: Optional callback URL
- **Response**: Signable object with ID, signatures, and state
- **Error Handling**: 400 (validation), 401 (auth/signature), 403 (authorization), 500 (server)

#### `signTransaction.ts` - POST `/api/v1/signTransaction`

- **Purpose**: Record a signer witness for a pending multisig transaction and optionally submit it to the network
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - Wallet ownership validation and enforcement of unique signer participation
  - Native signature and public key verification against the transaction hash
  - Witness aggregation with snapshot updates for CBOR and JSON representations
  - Automatic network submission when the multisig threshold is met, with failure capture
- **Request Body**:
  - `walletId`: Wallet identifier
  - `transactionId`: Transaction identifier
  - `address`: Signer address (must match JWT payload)
  - `signature`: Witness signature in hex format
  - `key`: Public key in hex format
  - `broadcast`: Optional boolean to control automatic submission (defaults to true)
- **Response**: Updated transaction object with witness metadata, submission state, and transaction hash
- **Error Handling**: 400 (validation), 401 (signature), 403 (authorization), 404 (not found), 409 (state conflict), 502 (broadcast failure), 500 (server)

### Wallet Management

#### `walletIds.ts` - GET `/api/v1/walletIds`

- **Purpose**: Retrieve all wallet IDs and names for a user address
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - User wallet enumeration
  - Address-based authorization
  - Wallet metadata retrieval
  - Empty result handling
- **Query Parameters**:
  - `address`: User address for wallet lookup
- **Response**: Array of wallet objects with ID and name
- **Error Handling**: 400 (validation), 401 (auth), 403 (authorization), 404 (not found), 500 (server)

#### `botMe.ts` - GET `/api/v1/botMe`

- **Purpose**: Return the authenticated bot's own info, including its owner's address (bot JWT only)
- **Authentication**: Required (bot JWT Bearer token)
- **Features**:
  - Bot can discover "my owner's address" (the human who claimed the bot) for flows like creating a 2-of-2 with the owner
- **Response**: `{ botId, paymentAddress, displayName, botName, ownerAddress }` (200)
- **Error Handling**: 401 (auth), 403 (not a bot token), 404 (bot not found), 500 (server)

#### `createWallet.ts` - POST `/api/v1/createWallet`

- **Purpose**: Create a new multisig wallet (bot-only; requires bot JWT and `multisig:create` scope)
- **Authentication**: Required (bot JWT Bearer token from POST `/api/v1/botAuth`)
- **Features**:
  - Builds native script from signer payment/stake/DRep addresses
  - Sets wallet owner to the bot’s payment address and grants the bot cosigner access
  - Supports `atLeast` / `all` / `any` script types and optional external stake credential
- **Request Body**:
  - `name`: string (required, 1–256 chars)
  - `description`: string (optional, truncated to 2000 chars)
  - `signersAddresses`: string[] (required, Cardano payment addresses)
  - `signersDescriptions`: string[] (optional; missing entries default to `""`)
  - `signersStakeKeys`: (string | null)[] (optional; used only when `stakeCredentialHash` is not provided)
  - `signersDRepKeys`: (string | null)[] (optional)
  - `numRequiredSigners`: number (optional, minimum 1, clamped to signer count, default 1; stored as `null` for `all`/`any`)
  - `scriptType`: `"atLeast"` | `"all"` | `"any"` (optional, default `"atLeast"`)
  - `paymentNativeScript`: object (optional; explicit payment script tree with `sig`/`all`/`any`/`atLeast`; sig key hashes must match `signersAddresses` payment key hashes)
  - `stakeCredentialHash`: string (optional, external stake)
  - `network`: 0 | 1 (optional, default 1 = mainnet)
- **Response**: `{ walletId, address, name }` (201)
- **Error Handling**: 400 (validation/script build), 401 (missing/invalid token or bot not found), 403 (not bot token or insufficient scope), 405 (method), 429 (rate limit), 500 (server)

#### `governanceActiveProposals.ts` - GET `/api/v1/governanceActiveProposals`

- **Purpose**: Return active governance proposals in a bot-friendly payload
- **Authentication**: Required (bot JWT Bearer token)
- **Scope**: `governance:read`
- **Features**:
  - Fetches proposals from Blockfrost and filters to active only (`enacted_epoch`, `dropped_epoch`, `expired_epoch`, `ratified_epoch` all null)
  - Tolerates metadata 404 responses (returns null-safe metadata fields instead of failing)
  - Optional `details=true` includes extra proposal detail fields
  - Maps upstream 429/418 rate limits to `503` with retry guidance
- **Query Parameters**:
  - `network`: `"0"` (preprod) or `"1"` (mainnet), default `"1"`
  - `count`: 1..100, default `100`
  - `page`: default `1`
  - `order`: `"asc"` or `"desc"`, default `"desc"`
  - `details`: `"true"` or `"false"`, default `"false"`
- **Response**: `{ proposals, page, count, order, network, details, sourceCount, activeCount }`
- **Notes**: Because filtering happens after fetch, `activeCount` may be lower than requested `count`.

#### `botBallotsUpsert.ts` - POST `/api/v1/botBallotsUpsert`

- **Purpose**: Create/update governance ballots with bot vote decisions and draft rationale comments
- **Authentication**: Required (bot JWT Bearer token)
- **Scope**: `ballot:write`
- **Wallet Access**: Requires bot `cosigner` role for `walletId`
- **Features**:
  - Deterministic ballot target resolution (`ballotId` preferred, `ballotName` fallback)
  - `409` on ambiguous `ballotName` matches
  - Enforces governance ballot only (`type = 1`)
  - Upserts proposals and choices while preserving omitted rationale comments on existing entries
  - Stores draft rationale text in `rationaleComments[]`; bots cannot set `anchorUrl`/`anchorHash`
  - Uses optimistic concurrency (`updatedAt` guard) to prevent lost updates
- **Request Body**:
  - `walletId`: string (required)
  - `ballotId`: string (optional, recommended when updating existing ballots)
  - `ballotName`: string (optional)
  - `proposals`: array of `{ proposalId, proposalTitle, choice, rationaleComment? }`
- **Response**: `{ ballot: { ... } }` with aligned `items`, `itemDescriptions`, `choices`, `anchorUrls`, `anchorHashes`, `rationaleComments`
- **Error Handling**: 400 (validation), 401 (auth), 403 (scope/access), 404 (unknown ballotId), 409 (ambiguity/concurrent write), 500 (server)

#### `nativeScript.ts` - GET `/api/v1/nativeScript`

- **Purpose**: Generate native scripts for multisig wallet operations
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - Multisig script generation for different roles
  - Payment, staking, and DRep script support
  - Wallet validation and construction
  - Role-based script filtering
- **Query Parameters**:
  - `walletId`: Wallet identifier
  - `address`: User address for authorization
- **Response**: Array of script objects with type and script data
- **Error Handling**: 400 (validation), 401 (auth), 403 (authorization), 404 (not found), 500 (server)

#### `lookupMultisigWallet.ts` - GET `/api/v1/lookupMultisigWallet`

- **Purpose**: Lookup multisig wallet metadata using public key hashes
- **Authentication**: Not required (public endpoint)
- **Features**:
  - Blockchain metadata querying
  - CIP-1854 metadata label support
  - Public key hash matching
  - Network-specific queries
- **Query Parameters**:
  - `pubKeyHashes`: Comma-separated public key hashes
  - `network`: Network identifier (optional, defaults to mainnet)
- **Response**: Array of matching metadata items
- **Error Handling**: 400 (validation), 500 (server)

### UTxO Management

#### `freeUtxos.ts` - GET `/api/v1/freeUtxos`

- **Purpose**: Retrieve unblocked UTxOs for a multisig wallet
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - UTxO fetching from blockchain
  - Pending transaction filtering
  - Double-spend prevention
  - Network-specific UTxO retrieval
  - Address validation and authorization
- **Query Parameters**:
  - `walletId`: Wallet identifier
  - `address`: User address for authorization
- **Response**: Array of free UTxO objects
- **Error Handling**: 400 (validation), 401 (auth), 403 (authorization), 404 (not found), 500 (server)

### Authentication Endpoints

#### `getNonce.ts` - GET `/api/v1/getNonce`

- **Purpose**: Request authentication nonce for address-based signing
- **Authentication**: Not required (public endpoint)
- **Features**:
  - Cryptographically secure nonce generation
  - User address validation
  - Nonce storage and management
  - Duplicate nonce prevention
- **Query Parameters**:
  - `address`: User address for nonce generation
- **Response**: Nonce object with value
- **Error Handling**: 400 (validation), 404 (user not found), 500 (server)

#### `authSigner.ts` - POST `/api/v1/authSigner`

- **Purpose**: Verify signed nonce and return JWT bearer token
- **Authentication**: Not required (public endpoint)
- **Features**:
  - Cryptographic signature verification
  - JWT token generation
  - Nonce cleanup after verification
  - Secure token expiration
- **Request Body**:
  - `address`: User address
  - `signature`: Signed nonce signature
  - `key`: Public key for verification
- **Response**: JWT token object
- **Error Handling**: 400 (validation), 401 (signature), 500 (server)

#### `botRegister.ts` - POST `/api/v1/botRegister`

- **Purpose**: Self-register a bot and issue a short-lived claim code for human approval
- **Authentication**: Not required (public endpoint)
- **Features**:
  - Creates a `PendingBot` record in `UNCLAIMED` state
  - Generates one-time claim code and hashed claim token
  - Validates requested scopes against allowed bot scopes
  - Rejects already-registered bot payment addresses
  - Strict rate limiting and 2 KB body size cap
- **Request Body**:
  - `name`: string (required, 1-100 chars)
  - `paymentAddress`: string (required)
  - `stakeAddress`: string (optional)
  - `requestedScopes`: string[] (required, non-empty, valid scope values)
  - Allowed scope values: `multisig:create`, `multisig:read`, `multisig:sign`, `governance:read`, `ballot:write`
- **Response**: `{ pendingBotId, claimCode, claimExpiresAt }` (201)
- **Error Handling**: 400 (validation), 405 (method), 409 (address conflict), 429 (rate limit), 500 (server)

#### `botClaim.ts` - POST `/api/v1/botClaim`

- **Purpose**: Claim a pending bot as a human user and mint its bot key credentials
- **Authentication**: Required (human JWT Bearer token; bot tokens are rejected)
- **Features**:
  - Verifies claim code using constant-time hash comparison
  - Enforces claim attempt lockout and expiry
  - Creates `BotKey` + `BotUser` and links ownership to claimer address
  - Accepts optional `approvedScopes` to narrow requested scopes
  - Stores one-time pickup secret on `PendingBot` for retrieval by the bot
- **Request Body**:
  - `pendingBotId`: string (required)
  - `claimCode`: string (required)
  - `approvedScopes`: string[] (optional; must be subset of requested scopes)
  - Allowed scope values: `multisig:create`, `multisig:read`, `multisig:sign`, `governance:read`, `ballot:write`
- **Response**: `{ botKeyId, botId, name, scopes }` (200)
- **Error Handling**: 400 (validation), 401 (auth), 404 (not found/expired), 405 (method), 409 (invalid claim/already claimed/locked out), 429 (rate limit), 500 (server)

#### `botPickupSecret.ts` - GET `/api/v1/botPickupSecret`

- **Purpose**: Allow a claimed bot to retrieve credentials exactly once
- **Authentication**: Not required (public endpoint; possession of `pendingBotId` is required)
- **Features**:
  - Returns `botKeyId` + one-time `secret` once claim is complete
  - Enforces state checks (`CLAIMED`, not already picked up)
  - Marks secret as consumed (`pickedUp=true`, clears stored secret)
  - Includes bot `paymentAddress` in response for convenience
- **Query Parameters**:
  - `pendingBotId`: string (required)
- **Response**: `{ botKeyId, secret, paymentAddress }` (200)
- **Error Handling**: 400 (validation), 404 (not found/not yet claimed), 405 (method), 410 (already picked up), 429 (rate limit), 500 (server)

#### `botAuth.ts` - POST `/api/v1/botAuth`

- **Purpose**: Authenticate a bot key and return a bot-scoped JWT bearer token
- **Authentication**: Not required (public endpoint; credentials in request body)
- **Onboarding Note**: `botKeyId` and `secret` are obtained from the claim flow (`POST /api/v1/botRegister` -> human `POST /api/v1/botClaim` -> `GET /api/v1/botPickupSecret`), not from manual bot creation.
- **Features**:
  - Bot key secret verification against stored hash
  - Minimum scope enforcement (`multisig:read`)
  - BotUser upsert with payment and optional stake address
  - Address uniqueness enforcement across bot keys (409 on conflict)
  - Strict rate limiting (15 requests per window) and 2 KB body size cap
- **Request Body**:
  - `botKeyId`: Bot key identifier (required)
  - `secret`: Bot key secret (required)
  - `paymentAddress`: Bot's Cardano payment address (required, min 20 chars)
  - `stakeAddress`: Bot's stake address (optional)
- **Response**: `{ token, botId }` — JWT payload contains `{ address, botId, type: "bot" }`
- **Error Handling**: 400 (validation), 401 (invalid key/secret), 403 (insufficient scope), 405 (method), 409 (address conflict), 429 (rate limit), 500 (server)

### Utility Endpoints

#### `og.ts` - GET `/api/v1/og`

- **Purpose**: Extract Open Graph metadata from URLs
- **Authentication**: Not required (public endpoint)
- **Features**:
  - HTML parsing and metadata extraction
  - Open Graph protocol support
  - Fallback to standard meta tags
  - Title, description, image, and site name extraction
- **Query Parameters**:
  - `url`: URL to extract metadata from
- **Response**: Metadata object with title, description, image, siteName, and url
- **Error Handling**: 400 (validation), 500 (server)

## API Architecture

### Request/Response Patterns

- **RESTful Design**: Standard HTTP methods and status codes
- **JSON Format**: All requests and responses use JSON
- **Error Consistency**: Standardized error response format
- **CORS Support**: Cross-origin requests enabled

### Authentication Flow

1. **Nonce Request**: Client requests nonce for address
2. **Signature Generation**: Client signs nonce with private key
3. **Token Exchange**: Client exchanges signature for JWT token
4. **API Access**: Client uses JWT token for authenticated requests

### Bot Onboarding Flow

1. **Bot Registers**: Bot calls `POST /api/v1/botRegister` with requested scopes
2. **Human Claims**: Owner calls `POST /api/v1/botClaim` with JWT + claim code
3. **Bot Picks Up Secret**: Bot calls `GET /api/v1/botPickupSecret` once
4. **Bot Authenticates**: Bot calls `POST /api/v1/botAuth` to receive bot JWT
5. **Bot API Access**: Bot uses JWT for bot endpoints (e.g. `botMe`, `createWallet`, governance APIs)

### Error Handling

- **HTTP Status Codes**: Proper status code usage
- **Error Messages**: Descriptive error messages
- **Validation Errors**: Detailed parameter validation
- **Security Errors**: Authentication and authorization failures
- **Server Errors**: Internal server error handling

### Database Integration

- **Prisma ORM**: Type-safe database operations
- **Transaction Management**: Database transaction handling
- **Data Validation**: Input validation and sanitization
- **Error Recovery**: Graceful error handling and recovery

## Security Considerations

### Input Validation

- **Parameter Validation**: All input parameters validated
- **Type Checking**: Strict type validation for all inputs
- **Address Validation**: Cardano address format validation
- **Signature Verification**: Cryptographic signature validation

### Authorization

- **Address Matching**: Token address must match request address
- **Wallet Access**: Users can only access their own wallets
- **Resource Protection**: Sensitive operations require authentication
- **Session Management**: Token expiration and renewal

### Data Protection

- **Sensitive Data**: No sensitive data in error messages
- **Logging**: Comprehensive logging without sensitive information
- **CORS**: Proper cross-origin resource sharing configuration
- **Rate Limiting**: Protection against abuse and DoS attacks

## Dependencies

### Core Dependencies

- **Next.js API Routes**: Server-side API implementation
- **Prisma**: Database ORM and query builder
- **jsonwebtoken**: JWT token generation and verification
- **@meshsdk/core**: Cardano blockchain interactions
- **@meshsdk/core-cst**: Cryptographic signature verification

### Utility Dependencies

- **crypto**: Node.js cryptographic functions
- **cors**: Cross-origin resource sharing
- **fetch**: HTTP client for external requests

## Environment Variables

### Required Variables

- `JWT_SECRET`: Secret key for JWT token generation
- `NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD`: Preprod network API key
- `NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET`: Mainnet network API key
- `BLOCKFROST_API_KEY_PREPROD`: Optional server-side override for preprod provider calls
- `BLOCKFROST_API_KEY_MAINNET`: Optional server-side override for mainnet provider calls

### Database Configuration

- Database connection via Prisma configuration
- Environment-specific database URLs
- Connection pooling and optimization

## Usage Examples

### Authentication Flow

```typescript
// 1. Request nonce
const nonceResponse = await fetch("/api/v1/getNonce?address=addr1...");
const { nonce } = await nonceResponse.json();

// 2. Sign nonce and get token
const signature = await wallet.signData(nonce, address);
const tokenResponse = await fetch("/api/v1/authSigner", {
  method: "POST",
  body: JSON.stringify({ address, signature, key: publicKey }),
});
const { token } = await tokenResponse.json();
```

### Transaction Submission

```typescript
const response = await fetch("/api/v1/addTransaction", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    walletId: "wallet-id",
    address: "addr1...",
    txCbor: "tx-cbor-data",
    txJson: "tx-json-data",
    description: "Transaction description",
  }),
});
```

### UTxO Retrieval

```typescript
const response = await fetch(
  "/api/v1/freeUtxos?walletId=wallet-id&address=addr1...",
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
);
const freeUtxos = await response.json();
```

This API v1 directory provides a comprehensive, secure, and well-documented REST API for multisig wallet operations, supporting the entire application ecosystem with robust authentication, transaction management, and blockchain integration.

## PR Route-Chain Smoke (Real-Chain CI)

- Workflow: `.github/workflows/pr-multisig-v1-smoke.yml`
- Bootstrap script: `scripts/ci/create-wallets.ts` (stable context producer)
- Route-chain runner: `scripts/ci/run-route-chain.ts`
- Scenario registry: `scripts/ci/scenarios/manifest.ts`

The CI flow is split into:

1. **Bootstrap**: create deterministic test wallets/context once.
2. **Route chain**: execute composable v1 route steps against that context.

Signing is always enabled in this route-chain flow, and signing steps run with broadcast enabled to validate real-chain submission behavior.

Current route-chain scenarios include:

- discovery + pending checks
- per-wallet pending validation
- route health checks (`freeUtxos`, signing readiness)
- real transfer flow (`addTransaction` -> `signTransaction` with broadcast)
- final-state assertions (`pendingTransactions` consistency checks)

To add coverage for a new v1 endpoint, add one step and register it in the scenario manifest without changing workflow orchestration.
Use `scripts/ci/scenarios/template-route-step.ts` as a starter scaffold.
