# Playwright Test Plan

This is the browser E2E coverage tracker for `e2e/tests`. The Docker Playwright
runner in `docker-compose.playwright.yml` runs every spec in that folder by default.

## Live Now

### `e2e/tests/ring-transfer.spec.ts`

Status: live.

The current suite covers the real preprod ring-transfer path:

- CIP-0030 wallet injection
- signer wallet authentication
- transaction proposal through the UI
- pending transaction intermediate state
- second-signer approval
- threshold broadcast
- pending transaction cleanup
- `legacy`, `hierarchical`, and `sdk` wallet script types

Live assertions:

- Signer 0 proposes a transaction from `/wallets/{id}/transactions/new`.
- Pending transaction card is visible after creation.
- `/api/v1/pendingTransactions` shows the transaction is still pending.
- Only signer 0 is listed in `signedAddresses` after proposal.
- `rejectedAddresses` is empty after proposal.
- The proposer does not see a duplicate `Approve & Sign` action.
- Signer 1 sees the pending transaction and the `Approve & Sign` action.
- Before signer 1 signs, the pending API still shows only signer 0 has signed.
- Signer 1 signs, reaches the 2-of-3 threshold, and broadcasts on-chain.
- The test waits for `[data-testid="tx-broadcast-success"]`.
- The pending card is removed and the pending API no longer returns the transaction.

The ring runs these legs in parallel:

- `legacy -> hierarchical`
- `hierarchical -> sdk`
- `sdk -> legacy`

This means hierarchical wallets are still covered as both a recipient wallet and a
source/spending wallet, even though Summon import UI coverage is out of scope.

## Backlog

Route-chain and unit tests already cover many API and transaction-builder paths, so
new Playwright tests should focus on flows where the browser, wallet connector, page
guards, form state, and user-facing UI can regress.

## Important Wallet-Type Constraint

Hierarchical wallets are Summon platform wallets that users import. They should not be covered by "create wallet from UI" tests, and the Summon import path is intentionally out of scope because it is already done and is not expected to receive future updates.

Playwright coverage should treat wallet types as follows:

| Wallet type | UI creation coverage | Additional Playwright coverage | Notes |
|---|---:|---:|---|
| `legacy` | Yes | Transaction/signing flows | Native multisig wallet created by this app |
| `sdk` | Yes | Transaction/signing, staking, governance flows | App-created SDK multisig wallet |
| `hierarchical` | No | Existing ring-transfer coverage only | Summon platform wallet; import-only in this app |

## Phase 1: Highest-Value Browser Coverage

### 1. Create Wallet UI

Status: live in `e2e/tests/create-wallet-ui.spec.ts`.

Goal: prove users can create app-native multisig wallets from the browser.

Coverage:

- Create a `legacy` wallet with three signers and a 2-of-3 threshold.
- Create an `sdk` wallet with three signers and a 2-of-3 threshold.
- Validate signer rows, threshold controls, and review screen.
- Confirm native script summary renders.
- Save wallet and confirm it appears on `/wallets`.

Out of scope:

- Do not create `hierarchical` wallets through the UI. Those are Summon import wallets.

### 2. New Transaction Form Validation

Status: live in `e2e/tests/new-transaction-validation.spec.ts`.

Goal: prove transaction creation errors are caught before users submit broken transactions.

Coverage:

- Invalid recipient address.
- Empty recipient address.
- Zero amount.
- Negative amount.
- Amount greater than selected UTxO balance.
- Add and remove recipient rows.
- Selected UTxO count updates before submit.
- Create button disabled or guarded when required fields are invalid.

Optional coverage:

- CSV recipient import.
- "Send all" behavior.
- Multiple-recipient transaction proposal.

## Phase 2: Failure And Access-Control Coverage

### 3. Rejected Wallet Signing

Status: live in `e2e/tests/rejected-signing.spec.ts`.

Goal: prove wallet rejection is handled cleanly.

Coverage:

- Mock `signTx` rejection during transaction proposal.
- Confirm no pending transaction is created (no `createTransaction` request,
  empty pending API, no pending card).
- Mock `signTx` rejection during transaction approval.
- Confirm no signature is added (no `updateTransaction` request, pending API
  still shows only the proposer, `rejectedAddresses` stays empty).
- Confirm visible error feedback appears and the form/card recovers.

Notes:

- Both tests run against a throwaway 2-of-3 wallet created via tRPC so the
  intentionally-stranded pending transaction can never trip ring-transfer's
  clean-pending precondition on the bootstrap wallets. The throwaway wallet is
  unfunded; the UTxO fetch is mocked and nothing is broadcast.

### 4. Wallet Access Control

Status: live in `e2e/tests/wallet-access-control.spec.ts`.

Goal: prove page guards match wallet authorization.

Coverage:

- Authenticated signer can open wallets they belong to.
- Authenticated signer cannot open a wallet they do not belong to.
- Direct navigation to protected wallet pages redirects or shows access denied.
- Protected routes remain protected after browser reload.

Candidate pages:

- `/wallets/{walletId}`
- `/wallets/{walletId}/transactions`
- `/wallets/{walletId}/transactions/new`
- `/wallets/{walletId}/info`
- `/wallets/{walletId}/staking`
- `/wallets/{walletId}/governance`

Notes:

- The non-member is a real derived preprod address (all-zero-entropy test
  mnemonic) with a valid injected session cookie, so the test exercises the
  authenticated-but-unauthorized path: `wallet.getWallet` returns FORBIDDEN,
  no wallet content renders on any candidate page, and the REST
  `pendingTransactions` endpoint also denies the address.
- Unauthenticated direct navigation asserts the layout's public-landing
  fallback (Connect Wallet visible, no wallet content).

### 5. Responsive Smoke Tests

Status: live in `e2e/tests/responsive-smoke.spec.ts`.

Goal: catch browser layout regressions on common mobile sizes.

Coverage (at 375x667 and 412x915):

- Wallet list.
- Wallet detail.
- Transaction list.
- New transaction page (mobile card layout, reachable create button).
- Wallet connect entry point (connect button + wallet dropdown).

Assertions:

- Critical controls are visible.
- No horizontal document overflow.
- Primary action buttons are reachable.

Not covered on mobile:

- The auth modal and the signing flow modal/card. Both need either a live
  handshake or a pending transaction; their behavior is exercised at desktop
  size by ring-transfer and rejected-signing. Add mobile variants only if a
  mobile-specific layout bug shows up there.

## Phase 3: Product-Area Browser Coverage

### 6. Staking UI

Status: live in `e2e/tests/staking-ui.spec.ts`.

Goal: prove the SDK staking pages work in the browser.

Coverage:

- Staking page loads staking info from the (mocked) account state.
- No staking actions are offered until a pool ID is entered (register/delegate
  and deregister gating).
- Inactive stake exposes `RegisterAndDelegate`; active stake exposes
  `Delegate` + `Deregister`.
- Register+delegate certificate proposal creates a pending transaction
  (verified via `/api/v1/pendingTransactions`, then deleted).

Notes:

- Runs against a throwaway 2-of-3 wallet created with the CI signers' stake
  keys, so the app classifies it as `sdk` and the staking page can derive a
  stake address. UTxOs and `/accounts/{stake}` are mocked; propose-only, no
  broadcast (full certificate broadcast stays in route-chain).
- Requires `CI_STAKE_POOL_ID_HEX` (hex pool ID; a bech32 `pool1...` value is
  normalized in-test). Read from the bootstrap context when present, else from
  the env var forwarded by `docker-compose.playwright.yml`.

### 7. DRep And Governance UI

Status: live in `e2e/tests/governance-drep-ui.spec.ts`.

Goal: prove governance actions can be initiated from the browser.

Coverage:

- Governance page loads for an eligible (throwaway SDK) wallet with a derived
  DRep ID.
- DRep management actions are gated on registration state: Register enabled,
  Update and Retire disabled while the (mocked) DRep is unregistered.
- DRep register form validation (submit disabled until name, objectives,
  motivations, and qualifications are filled from `CI_DREP_ANCHOR_JSON`).
- DRep update form validation (same gating on the update page).
- Active proposals list loads (mocked Blockfrost `/governance/proposals` +
  metadata) and renders the proposal title.
- Ballot modal opens (via the `New` toggle), creates a ballot via
  `ballot.create`, and lists it (deleted afterwards via tRPC).

Notes:

- Retire is exercised as a gated action only: an actually-retirable DRep needs
  a real on-chain registration, which is route-chain territory.
- The DRep form values come from `CI_DREP_ANCHOR_JSON`; keep it as single-line
  CIP-119 JSON so Docker Compose can forward it to the Playwright runner.
- Submitting a DRep registration certificate from the browser is intentionally
  not covered. That path canonicalizes the CIP-119 anchor with jsonld
  (URDNA2015), which calls `crypto.subtle`; the Web Crypto API is only exposed
  in a secure context, and the Docker app is served over plain
  `http://webapp:3000`, so the build throws `crypto.subtle not found`. Staking
  certificate proposals do not use jsonld (hence staking-ui covers
  propose-to-pending), and DRep certificate building/broadcast is covered in
  route-chain (`scenario.drep-certificates`).

### 8. Proxy UI

Status: live in `e2e/tests/proxy-ui.spec.ts`.

Goal: prove proxy controls are usable from the browser.

Coverage:

- Proxy control panel loads on the wallet info page and expands.
- Empty state offers first-proxy setup; the setup modal opens with the step
  indicator, collateral notice, description field, and an enabled
  `Start Proxy Setup` action for a connected wallet.
- Existing proxy state is displayed: a proxy row seeded via
  `proxy.createProxy` renders with its description and the panel's proxy
  count reflects it (deleted afterwards via tRPC).

Notes:

- Setup proposal creation is intentionally not driven from the browser: the
  auth-token mint is a Plutus transaction needing real collateral and funded
  inputs, and the full lifecycle already has broad route-chain coverage
  (`scenario.proxy-full-lifecycle`).

### 9. Bot Management UI

Status: live in `e2e/tests/bot-management-ui.spec.ts`.

Goal: prove users can manage bot credentials through the UI.

Coverage:

- Register a pending bot over REST (`/api/v1/botRegister`) and claim it in
  the UI with the one-time claim code (enter code → review → success).
- Requested scopes are shown at review time; unrequested scopes cannot be
  approved.
- Claimed bot appears in the user bot list with name, key ID, scopes, and the
  bot payment address.
- Edit scopes through the dialog and confirm the badge list updates.
- Revoke the bot (native confirm accepted) and confirm it disappears.

Notes:

- The app's bot model is claim-based; the bot's API secret is delivered via
  `botPickupSecret` to the bot itself and never rendered in the UI, so the
  original "generated secret is shown once" item maps to the one-time claim
  code flow.

### 10. Notification Center

Status: live in `e2e/tests/notification-settings-ui.spec.ts`.

Goal: prove signature notifications help users find pending work.

Coverage:

- Email Notifications card loads for a wallet signer on the wallet info page.
- Saving an email persists it and flips the badge from `No email` to
  `Not verified`.
- `Send verification email` unlocks once an email is saved and reports
  queued/prepared depending on whether delivery is enabled in the
  environment.
- Preference toggles (transaction signatures) persist across a full reload.

Notes:

- Signature notifications in this app are email-based (per-signer settings +
  server-side outbox/worker); there is no in-app notification inbox, so the
  original "click notification → land on transaction" item has no browser
  surface. The email pipeline itself (outbox rows, worker, verify link) is
  server-side coverage outside this suite.

## Suggested Implementation Order

1. Create wallet UI for `legacy` and `sdk`.
2. New transaction form validation.
3. Rejected wallet signing.
4. Wallet access control.
5. Responsive smoke tests.
6. Staking UI.
7. DRep and governance UI.
8. Proxy UI.
9. Bot management UI.
10. Notification center.

Optional diagnostic coverage:

- Add a small wallet connect/auth-only spec if wallet auth becomes flaky or hard to diagnose through ring-transfer failures. Ring transfer already exercises wallet injection and signer auth, so this is not required for baseline coverage.

## Test Design Notes

- Prefer browser tests for user-visible behavior, wallet connector behavior, page guards, and form state.
- Prefer route-chain tests for real-chain API coverage, full certificate broadcast flows, and expensive proxy lifecycle checks.
- Keep real-chain Playwright tests narrow. Use mocked or intercepted browser responses for validation-heavy UI tests when the chain itself is not the subject.
- Reuse the existing wallet fixture and bootstrap context where possible.
- Avoid adding new funded-wallet requirements unless the test truly needs real preprod UTxOs.
- Do not add new Summon/hierarchical import tests unless that flow starts receiving product changes again.
