# Bot Proxy API Plan

## Goal

Add v1 REST endpoints that let bots create proxy-related multisig transactions through the same pending transaction flow used by `botDRepCertificate.ts` and `botStakeCertificate.ts`.

The bot should be able to propose proxy setup, proxy spending, and proxy governance transactions. It should not bypass the wallet's multisig threshold. Built transactions should be stored as pending multisig transactions and then signed with the existing `POST /api/v1/signTransaction` flow.

## Existing Pieces

- Proxy UI and transaction builders live in `src/components/multisig/proxy`.
- The core offchain class is `MeshProxyContract` in `src/components/multisig/proxy/offchain.ts`.
- Proxy metadata is stored in the `Proxy` table with `proxyAddress`, `authTokenId`, and serialized `paramUtxo`.
- Bot-authenticated server-built transactions already exist in:
  - `src/pages/api/v1/botDRepCertificate.ts`
  - `src/pages/api/v1/botStakeCertificate.ts`
- Pending multisig transactions should be persisted with `createPendingMultisigTransaction()`.

## Key Constraint

Proxy setup and proxy spending are Plutus transactions. The browser implementation currently gets collateral through wallet APIs. Server routes cannot do that directly, so the API must accept a `collateralRef` and resolve it from chain, or share a helper that can resolve and validate collateral UTxOs server-side.

The auth token remains the control mechanism. For normal multisig-controlled proxies, auth tokens stay at the multisig wallet address. Bot-created transactions still need multisig approval before they can move proxy funds or act as the proxy DRep.

## Proposed Endpoints

### `POST /api/v1/proxySetup`

Create a pending multisig transaction that mints the proxy auth tokens and initializes a proxy address.

Request body:

- `walletId`: string, required
- `address`: string, required; must match JWT signer or bot payment address
- `utxoRefs`: `{ txHash: string; outputIndex: number }[]`, required; multisig wallet inputs
- `collateralRef`: `{ txHash: string; outputIndex: number }`, required
- `description`: string, optional

Behavior:

- Authenticate JWT and enforce bot rate limits.
- Require bot `multisig:sign` scope and cosigner wallet access for bot JWTs.
- Resolve wallet script address with `resolveWalletScriptAddress()`.
- Resolve and validate `utxoRefs` at the expected wallet spend address.
- Resolve and validate `collateralRef`.
- Reuse or extract the proxy setup logic from `MeshProxyContract.setupProxy()`.
- Create a pending multisig transaction.
- Persist the proxy metadata after the transaction is confirmed, or store it in a pending/proposed state until confirmation can be observed.

Response:

- Pending `Transaction` row, plus derived `proxyAddress`, `authTokenId`, and `paramUtxo`.

Open decision:

- Whether to create the `Proxy` database row immediately as inactive/pending, or only after the setup transaction is submitted and confirmed.

### `GET /api/v1/proxies`

List active proxies for a wallet.

Query parameters:

- `walletId`: string, required
- `address`: string, required

Behavior:

- Authenticate JWT.
- Enforce read access for users and bots.
- Return active `Proxy` records for the wallet.

Response:

- Array of `{ id, walletId, proxyAddress, authTokenId, paramUtxo, description, isActive, createdAt, updatedAt }`.

### `POST /api/v1/proxySpend`

Create a pending multisig transaction that spends assets from a proxy address.

Request body:

- `walletId`: string, required
- `address`: string, required
- `proxyId`: string, required
- `outputs`: `{ address: string; unit: string; amount: string }[]`, required
- `utxoRefs`: `{ txHash: string; outputIndex: number }[]`, required; multisig inputs including an auth token UTxO
- `proxyUtxoRefs`: `{ txHash: string; outputIndex: number }[]`, optional; if omitted, server can auto-select from proxy UTxOs
- `collateralRef`: `{ txHash: string; outputIndex: number }`, required
- `description`: string, optional

Behavior:

- Authenticate and authorize as a mutating wallet action.
- Load and authorize the selected proxy.
- Resolve multisig UTxOs and confirm at least one contains the proxy auth token.
- Resolve proxy UTxOs from `proxyUtxoRefs` or auto-select enough UTxOs from the proxy address.
- Build a transaction that spends proxy script inputs, consumes one auth-token UTxO, returns the auth token to the multisig wallet, emits requested outputs, and sends change back to the proxy.
- Persist the result as a pending multisig transaction.

Response:

- Pending `Transaction` row.

### `POST /api/v1/proxyDRepCertificate`

Create a pending multisig transaction to register, update, or deregister the proxy script DRep.

Request body:

- `walletId`: string, required
- `address`: string, required
- `proxyId`: string, required
- `action`: `"register"` | `"update"` | `"deregister"`, required
- `utxoRefs`: `{ txHash: string; outputIndex: number }[]`, required
- `collateralRef`: `{ txHash: string; outputIndex: number }`, required
- `anchorUrl`: string, required for `register` and `update`
- `anchorJson`: object, required for `register` and `update`; server computes the anchor hash
- `description`: string, optional

Behavior:

- Mirror the existing `botDRepCertificate.ts` pattern.
- Derive the DRep id from the proxy script hash.
- Use the proxy certificate script instead of the wallet's normal DRep script.
- Require an auth-token UTxO from the multisig wallet.
- Persist the result as a pending multisig transaction.

### `POST /api/v1/proxyVote`

Create a pending multisig transaction that votes as the proxy DRep.

Request body:

- `walletId`: string, required
- `address`: string, required
- `proxyId`: string, required
- `votes`: `{ proposalId: string; voteKind: "Yes" | "No" | "Abstain"; metadata?: unknown }[]`, required
- `utxoRefs`: `{ txHash: string; outputIndex: number }[]`, required
- `collateralRef`: `{ txHash: string; outputIndex: number }`, required
- `description`: string, optional

Behavior:

- Authorize the bot/user as a mutating wallet actor.
- Load proxy metadata and reconstruct the proxy contract.
- Parse each proposal id with `parseProposalId()`.
- Build votes using the proxy DRep id.
- Require and return one auth token.
- Persist the result as a pending multisig transaction.

## Shared Implementation Work

1. Extract server-safe proxy transaction helpers from `MeshProxyContract`.
   - Avoid browser wallet calls inside API routes.
   - Accept resolved wallet UTxOs, wallet address, collateral UTxO, and network explicitly.

2. Add a reusable `resolveCollateralRefFromChain()` helper.
   - It should resolve one UTxO by reference.
   - It should validate the expected address when applicable.
   - It should require enough lovelace for Plutus collateral, likely at least `5 ADA`.

3. Add a proxy authorization helper.
   - Reuse wallet access rules from v1 endpoints.
   - Ensure a proxy belongs to the requested wallet and is active.

4. Decide proxy row lifecycle for setup.
   - Immediate inactive/pending row is convenient for returning metadata.
   - Confirmed-only row avoids stale proxies when setup transactions are abandoned.

5. Update OpenAPI docs in `src/utils/swagger.ts`.
   - Include bot scope requirements.
   - Document `collateralRef`.
   - Document that responses are pending multisig transactions.

6. Update `src/pages/api/v1/README.md`.
   - Add the new proxy endpoints.
   - Add bot usage examples.

## Security Requirements

- Bot JWTs must require `multisig:sign` for all mutating proxy endpoints.
- Bot must have cosigner access to the wallet. Observer bots can read proxies but cannot build proxy transactions.
- Never accept raw UTxO JSON from the caller. Accept refs and resolve from chain.
- Validate every wallet UTxO is at the expected wallet script address.
- Validate proxy spend inputs are at the selected proxy address.
- Validate an auth-token UTxO exists in the multisig wallet inputs for spend, DRep, and vote actions.
- Do not let the bot submit transactions directly unless the existing pending transaction flow would submit immediately for that wallet type.

## Test Plan

- Unit-test request validation for each endpoint.
- Test bot scope enforcement: missing scope, observer access, cosigner access.
- Test UTxO resolution failures: unknown ref, wrong address, missing collateral, insufficient collateral.
- Test proxy setup derives stable `authTokenId` and `proxyAddress` from the chosen `paramUtxo`.
- Test proxy spend rejects requests without an auth-token UTxO.
- Test DRep and vote builders derive the proxy DRep id, not the wallet DRep id.
- Add route-chain CI steps after the first endpoint lands, following `scripts/ci/scenarios/steps/template-route-step.ts`.

## Suggested Phasing

1. Add shared server helpers and `GET /api/v1/proxies`.
2. Add `POST /api/v1/proxySetup`.
3. Add `POST /api/v1/proxySpend`.
4. Add `POST /api/v1/proxyDRepCertificate`.
5. Add `POST /api/v1/proxyVote`.
6. Add Swagger docs, README examples, and route-chain CI coverage.
