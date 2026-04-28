# Proxy Bot API Test Plan

## Goal

Test the v1 proxy bot API end to end without letting CI permanently degrade a shared test wallet. The API should prove that bots can propose proxy setup, proxy spending, proxy DRep certificates, and proxy voting through the existing multisig pending transaction flow, while preserving wallet threshold rules.

Because these endpoints create real Cardano transactions, the test strategy should separate safe smoke coverage from opt-in lifecycle coverage.

## Current CI Coverage

The current route-chain smoke test only covers `GET /api/v1/proxies`.

It runs once per bootstrap wallet type and:

- Authenticates as the default CI bot.
- Calls `GET /api/v1/proxies?walletId=<walletId>&address=<botPaymentAddress>`.
- Requires HTTP `200`.
- Requires the response body to be an array.
- Records `walletId` and `proxyCount`.

This verifies the read endpoint is reachable and bot read authorization works. It does not create proxies, spend proxy funds, build DRep transactions, vote, or clean up auth tokens.

## Test Modes

### 1. Smoke Mode

Smoke mode should run by default in PR CI. It must be cheap, deterministic, and avoid new on-chain state.

Recommended smoke checks:

- `GET /api/v1/proxies` returns an array for every bootstrap wallet.
- `GET /api/v1/proxies` rejects missing token.
- `GET /api/v1/proxies` rejects address mismatch.
- Mutating proxy routes reject observer bots.
- Mutating proxy routes reject bots without `multisig:sign`.
- Mutating proxy routes reject malformed request bodies before touching chain providers.

Smoke mode should not submit proxy setup, spend, certificate, vote, or burn transactions.

### 2. Lifecycle Mode

Lifecycle mode should be opt-in, likely behind an environment flag such as `CI_PROXY_LIFECYCLE=true`. It may spend preprod ADA and should only run when the test wallet is funded and cleanup is enabled.

Recommended lifecycle sequence:

1. Discover wallet state.
   - Authenticate bot.
   - Call `walletIds`, `freeUtxos`, and `proxies`.
   - Record initial proxy count and spendable wallet UTxOs.

2. Build proxy setup.
   - Choose wallet UTxOs with at least one UTxO holding 20 ADA.
   - Choose a collateral UTxO with at least 5 ADA.
   - Call `POST /api/v1/proxySetup`.
   - Include `initialProxyLovelace` when lifecycle CI will test `proxySpend`, so setup creates the proxy with enough ADA for the planned spend and fees.
   - Assert response includes `transaction` and `setup`.
   - Assert `setup.proxyAddress`, `setup.authTokenId`, and `setup.paramUtxo` are present.

3. Sign and submit setup.
   - If setup returned a pending `Transaction` row, sign through `POST /api/v1/signTransaction` with enough CI signer bots to meet threshold.
   - If setup was immediately submitted for a single-signer or `type === "any"` wallet, record the returned tx hash.
   - Wait for confirmation before finalization.

4. Finalize setup.
   - Call `POST /api/v1/proxySetupFinalize` with `walletId`, `address`, `txHash`, and setup metadata.
   - Assert it returns a `Proxy` row.
   - Call `GET /api/v1/proxies`.
   - Assert the created proxy is listed and active.

5. Fund or verify proxy funds.
   - The setup transaction currently creates a minimal proxy output.
   - For lifecycle CI, prefer creating or immediately following setup with enough ADA at the proxy address to cover the planned spend plus fees.
   - `proxySetup` should accept an optional `initialProxyLovelace` amount, so setup can create the proxy with enough ADA for the spend test in one confirmed transaction.
   - If `initialProxyLovelace` is omitted, the setup route should keep the current minimal proxy output behavior.
   - Until `initialProxyLovelace` is implemented, send test ADA from the multisig wallet to the proxy address after setup finalization and wait for confirmation before calling `proxySpend`.

6. Build proxy spend.
   - Use `freeUtxos` to select multisig wallet inputs that include an auth-token UTxO.
   - Select or auto-select proxy UTxOs.
   - Call `POST /api/v1/proxySpend`.
   - Sign and submit through the normal pending flow.
   - Assert the requested output lands at the target address.
   - Assert at least one auth token returns to the multisig wallet.

7. Register proxy DRep.
   - Call `POST /api/v1/proxyDRepCertificate` with action `register`.
   - Provide `anchorUrl` and `anchorJson`; assert server computes the anchor hash.
   - Sign and submit through the normal pending flow.
   - Optionally call `update`.

8. Check active governance proposals.
   - Call `GET /api/v1/governanceActiveProposals`.
   - If at least one active proposal is available, select a proposal id in `<txHash>#<certIndex>` format and continue to the vote step.
   - If there are no active proposals, skip `proxyVote` and go directly to proxy DRep deregistration.

9. Build proxy vote when an active proposal exists.
   - Call `POST /api/v1/proxyVote`.
   - Sign and submit through the normal pending flow.
   - Assert tx submission succeeds before attempting to deregister the proxy DRep.
   - If vote building or submission fails, stop lifecycle cleanup at the safest possible point and report the failed state instead of deregistering blindly.

10. Deregister proxy DRep.
   - If proxy DRep registration succeeded, call `POST /api/v1/proxyDRepCertificate` with action `deregister`.
   - If a vote was attempted, only deregister after the vote transaction succeeded.
   - If no active proposals existed, deregister immediately after the register/update checks.
   - Sign and submit through the normal pending flow.

11. Cleanup.
   - Move any remaining proxy funds back to the multisig wallet.
   - Burn auth tokens if burn support is implemented in the server API or CI helper.
   - Mark the proxy inactive or delete the row after on-chain cleanup is confirmed.

## Auth Token Cleanup

The auth-token minting policy appears to support burning at the validator level. The Aiken tests include successful burn cases with an `RBurn` redeemer.

That means burning is likely possible, but the current v1 proxy bot API does not expose a burn endpoint or cleanup builder.

Important limitations:

- A Cardano wallet cannot return to exactly the same state after a lifecycle test, because fees are paid and UTxO shapes change.
- Burning auth tokens can remove the proxy control tokens, but it cannot refund fees.
- If the proxy DRep was registered, the test must deregister it or leave governance state behind.
- If a setup transaction succeeds but cleanup fails, CI can leave active proxy rows and auth tokens behind.

Recommended cleanup approach:

1. Add an explicit cleanup builder before enabling lifecycle CI by default.
2. The cleanup builder should consume all remaining auth-token UTxOs from the multisig wallet.
3. It should mint `-N` auth tokens with the burn redeemer.
4. It should return non-token change to the multisig wallet.
5. After burn confirmation, mark the `Proxy` row inactive or delete it.

Recommended endpoint shape:

```http
POST /api/v1/proxyCleanup
```

Request body:

- `walletId`: string, required
- `address`: string, required
- `proxyId`: string, required
- `utxoRefs`: `{ txHash: string; outputIndex: number }[]`, required; multisig wallet inputs containing all auth tokens to burn
- `collateralRef`: `{ txHash: string; outputIndex: number }`, required if the burn policy requires Plutus collateral
- `deactivateProxy`: boolean, optional, default `true`
- `description`: string, optional

Behavior:

- Require `multisig:sign` and cosigner access for bots.
- Load and validate active proxy metadata.
- Resolve all UTxOs from chain.
- Verify selected wallet inputs contain the auth tokens.
- Build a burn transaction using the auth-token policy and burn redeemer.
- Persist through the normal pending multisig transaction flow.
- Deactivate or delete the `Proxy` row only after burn confirmation.

## Required Setup Enhancement

Before enabling lifecycle CI for proxy spending, update `POST /api/v1/proxySetup` to support an optional `initialProxyLovelace` request field.

Request addition:

- `initialProxyLovelace`: string, optional; positive integer lovelace amount to place at the proxy address during setup

Behavior:

- If omitted, keep the current setup output amount at the proxy address.
- If provided, validate it is a positive integer string.
- Enforce a minimum value high enough to satisfy the proxy output min-ADA requirement.
- In lifecycle CI, choose a value that covers the planned `proxySpend` output plus fee buffer.
- The setup builder should use `initialProxyLovelace` for the proxy address output instead of the hard-coded minimal amount.
- The response does not need a new field if `setup.proxyAddress`, `setup.authTokenId`, and `setup.paramUtxo` remain unchanged, but Swagger and README examples should document the request field.

Recommended lifecycle CI default:

- Set `initialProxyLovelace` to at least the planned spend amount plus a conservative fee buffer.
- Prefer a value such as `5000000` or higher on preprod unless the concrete spend test requires more.

## Negative Test Matrix

These tests can mostly run in unit tests or smoke mode.

| Area | Case | Expected |
|------|------|----------|
| Auth | Missing token | `401` |
| Auth | Invalid token | `401` |
| Auth | Body/query `address` differs from JWT address | `403` |
| Bot scope | Bot lacks `multisig:sign` on mutating route | `403` |
| Bot role | Observer bot calls mutating route | `403` |
| Bot role | Observer bot calls `GET /proxies` | `200` |
| Wallet | Unknown `walletId` | `404` |
| Proxy | Unknown `proxyId` | `404` |
| Proxy | Proxy belongs to another wallet | `404` or `403` |
| Proxy metadata | Stored proxy metadata does not match derived script data | `409` |
| UTxOs | Empty `utxoRefs` | `400` |
| UTxOs | Wallet UTxO ref resolves to wrong address | `400` |
| UTxOs | Missing auth-token UTxO | `400` |
| Collateral | Missing `collateralRef` | `400` |
| Collateral | Collateral below 5 ADA | `400` |
| Spend | Invalid output amount | `400` |
| Spend | Proxy UTxOs cannot cover outputs | `400` |
| DRep | Missing anchor for register/update | `400` |
| Vote | Invalid `proposalId` format | `400` |
| Vote | Invalid `voteKind` | `400` |

## Unit Test Coverage

Recommended unit tests:

- `proxyUtxos` helper tests for collateral, auth-token detection, and proxy UTxO selection.
- `proxyAccess` tests for human signer, bot observer, bot cosigner, and mismatch cases.
- `proxySetupFinalization` tests with mocked provider responses:
  - creates row when auth token is present at wallet and proxy address has UTxO
  - rejects missing auth token
  - rejects empty proxy address UTxOs
  - returns existing row idempotently
- Route handler tests for each endpoint:
  - required fields
  - auth mismatch
  - bot scope enforcement
  - UTxO resolver failures
  - happy path with mocked tx builder and `createPendingMultisigTransaction`

## Route-Chain CI Coverage

Recommended route-chain phases:

### Phase 1: Default Smoke

Add by default:

- `GET /api/v1/proxies` list check.
- Negative auth checks for proxy read route.
- Negative validation checks for mutating routes that fail before chain calls.

### Phase 2: Opt-In Setup and Finalize

Enable with `CI_PROXY_LIFECYCLE=true`:

- `proxySetup`
- `signTransaction`
- wait for confirmation
- `proxySetupFinalize`
- `proxies` confirms active row

### Phase 3: Opt-In Spend, Governance, Cleanup

Enable only when cleanup is implemented:

- call `proxySetup` with `initialProxyLovelace` high enough for the planned spend
- `proxySpend`
- `proxyDRepCertificate register`
- `governanceActiveProposals`
- `proxyVote` only when at least one active proposal exists
- `proxyDRepCertificate deregister`
- `proxyCleanup` burn auth tokens
- `proxies` confirms inactive/deleted row

## Recommendation

Keep the current `GET /api/v1/proxies` route-chain check as default CI coverage.

Next, add unit tests for the new route handlers and setup finalization helper. After that, implement a cleanup/burn helper or endpoint before turning on full real-chain lifecycle CI. Full lifecycle tests should remain opt-in until cleanup has proven reliable across repeated CI runs.
