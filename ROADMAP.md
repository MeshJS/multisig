# 12-Month Roadmap: Mesh Multi-Sig Wallet

**Timeline:** April 2026 – March 2027  
**Approach:** Month-by-month cadence combining baseline maintenance with feature delivery. No hard requirements for feature delivery or releases — tasks scale up/down based on project activity.

---

## MRP task mapping

The authoritative mapping between MRP reward tasks and the months below. **Month N of this roadmap = MRP Month N = the calendar month in the same row.** Use this table whenever an MRP task and a roadmap section appear to disagree.

| MRP task | Calendar month | Roadmap section | On-chain task hash |
|---|---|---|---|
| MRP Month 1 | April 2026 | [Month 1](#month-1--april-2026) | — |
| MRP Month 2 | May 2026 | [Month 2](#month-2--may-2026) | `02e1e7c8…65256f` |
| MRP Month 3 | June 2026 | [Month 3](#month-3--june-2026) | `a833f41c…91cef8` |
| MRP Month 4 | July 2026 | [Month 4](#month-4--july-2026) | `27034bf3…dd219a` |
| MRP Month 5 | August 2026 | [Month 5](#month-5--august-2026) | — |
| MRP Month 6 | September 2026 | [Month 6](#month-6--september-2026) | — |
| MRP Month 7 | October 2026 | [Month 7](#month-7--october-2026) | — |
| MRP Month 8 | November 2026 | [Month 8](#month-8--november-2026) | — |
| MRP Month 9 | December 2026 | [Month 9](#month-9--december-2026) | — |
| MRP Month 10 | January 2027 | [Month 10](#month-10--january-2027) | — |
| MRP Month 11 | February 2027 | [Month 11](#month-11--february-2027) | — |
| MRP Month 12 | March 2027 | [Month 12](#month-12--march-2027) | — |

> **Why this table exists.** The month headings were renumbered on 2026-08-03 (`984aa46`) to match actual delivery: the original numbering started at "Month 1 — May 2026" while Month 1's own proof-of-completion table documented April work. MRP task cards created before that date therefore carry bullet text describing the **following** month — e.g. the card headed *MRP Month 2* lists the June workstreams. The table above is what governs; a card's bullet text does not.

### Underlying PRs per MRP month

Each MRP month resolves to a concrete, reproducible set of merged pull requests. The "all merged PRs" link runs the exact GitHub search; the counts are Quirin's authored merges in that window.

| MRP month | Merged PRs (Quirin) | The actual PRs |
|---|---|---|
| **M1 — April 2026** | [10](https://github.com/MeshJS/multisig/pulls?q=is%3Apr+is%3Amerged+author%3AQSchlegel+merged%3A2026-04-01..2026-04-30) | [#215](https://github.com/MeshJS/multisig/pull/215) drep prerender fix · [#216](https://github.com/MeshJS/multisig/pull/216) missing User table on startup · [#217](https://github.com/MeshJS/multisig/pull/217) VKey witness filter + CI smoke system · [#218](https://github.com/MeshJS/multisig/pull/218) preprod environment · [#219](https://github.com/MeshJS/multisig/pull/219)/[#222](https://github.com/MeshJS/multisig/pull/222)/[#224](https://github.com/MeshJS/multisig/pull/224)/[#226](https://github.com/MeshJS/multisig/pull/226) 12-month roadmap + contributing guide · [#227](https://github.com/MeshJS/multisig/pull/227) invalid-CBOR guard in `addTransaction` · [#228](https://github.com/MeshJS/multisig/pull/228) M1 proof of completion |
| **M2 — May 2026** | [3](https://github.com/MeshJS/multisig/pulls?q=is%3Apr+is%3Amerged+author%3AQSchlegel+merged%3A2026-05-01..2026-05-31) | [#257](https://github.com/MeshJS/multisig/pull/257) pin Mesh SDK + reject witnesses that don't verify against the tx body · [#259](https://github.com/MeshJS/multisig/pull/259) Import Wallet wizard · [#260](https://github.com/MeshJS/multisig/pull/260) `main`→`preprod` merge clearing #229 + CodeQL fixes |
| **M3 — June 2026** | [51](https://github.com/MeshJS/multisig/pulls?q=is%3Apr+is%3Amerged+author%3AQSchlegel+merged%3A2026-06-01..2026-06-30) | Governance [#271](https://github.com/MeshJS/multisig/pull/271)–[#272](https://github.com/MeshJS/multisig/pull/272), [#279](https://github.com/MeshJS/multisig/pull/279), [#286](https://github.com/MeshJS/multisig/pull/286), [#296](https://github.com/MeshJS/multisig/pull/296)–[#297](https://github.com/MeshJS/multisig/pull/297), [#300](https://github.com/MeshJS/multisig/pull/300), [#302](https://github.com/MeshJS/multisig/pull/302), [#315](https://github.com/MeshJS/multisig/pull/315) · Signing & auth [#273](https://github.com/MeshJS/multisig/pull/273)–[#277](https://github.com/MeshJS/multisig/pull/277), [#281](https://github.com/MeshJS/multisig/pull/281)–[#282](https://github.com/MeshJS/multisig/pull/282), [#324](https://github.com/MeshJS/multisig/pull/324) · Mesh 2.0 groundwork [#229](https://github.com/MeshJS/multisig/pull/229), [#269](https://github.com/MeshJS/multisig/pull/269), [#278](https://github.com/MeshJS/multisig/pull/278) · Mobile & UX [#287](https://github.com/MeshJS/multisig/pull/287)–[#295](https://github.com/MeshJS/multisig/pull/295) · Landing/theme/SEO [#298](https://github.com/MeshJS/multisig/pull/298)–[#299](https://github.com/MeshJS/multisig/pull/299), [#308](https://github.com/MeshJS/multisig/pull/308)–[#318](https://github.com/MeshJS/multisig/pull/318), [#328](https://github.com/MeshJS/multisig/pull/328) · Infra & security [#284](https://github.com/MeshJS/multisig/pull/284), [#301](https://github.com/MeshJS/multisig/pull/301), [#319](https://github.com/MeshJS/multisig/pull/319) · Docs & releases [#280](https://github.com/MeshJS/multisig/pull/280), [#283](https://github.com/MeshJS/multisig/pull/283), [#285](https://github.com/MeshJS/multisig/pull/285), [#303](https://github.com/MeshJS/multisig/pull/303), [#309](https://github.com/MeshJS/multisig/pull/309), [#320](https://github.com/MeshJS/multisig/pull/320)–[#321](https://github.com/MeshJS/multisig/pull/321) |
| **M4 — July 2026** | [16](https://github.com/MeshJS/multisig/pulls?q=is%3Apr+is%3Amerged+author%3AQSchlegel+merged%3A2026-07-01..2026-07-31) | Bot platform & API [#341](https://github.com/MeshJS/multisig/pull/341)–[#345](https://github.com/MeshJS/multisig/pull/345) · Agent/crawler surface [#346](https://github.com/MeshJS/multisig/pull/346) · DRep vote-history explorer [#337](https://github.com/MeshJS/multisig/pull/337)–[#339](https://github.com/MeshJS/multisig/pull/339) · Roadmap & delivery audit [#347](https://github.com/MeshJS/multisig/pull/347), [#350](https://github.com/MeshJS/multisig/pull/350)–[#352](https://github.com/MeshJS/multisig/pull/352) · Production hardening [#332](https://github.com/MeshJS/multisig/pull/332)–[#334](https://github.com/MeshJS/multisig/pull/334) |

Reproduce any row:

```bash
gh pr list --repo MeshJS/multisig --state merged --limit 100 \
  --search "merged:2026-06-01..2026-06-30 author:QSchlegel" --json number,title,mergedAt
```

---

## Baseline (applies every month)

- Issues and PRs do not stall
- Repository remains stable and usable
- Documentation does not fall out of date

---

## Delivered to date (April – July 2026)

What the product can actually do today, as verified in the codebase on 2026-07-26. The per-month **Progress** tables below track plan-vs-actual; this section is the cumulative capability inventory, and it is the input that reshaped M4–M6.

Coverage starts at **April**, the programme's first month — April's output is infrastructure rather than user-facing features (the preprod environment, the real-chain smoke system, transaction-integrity guards), so it shows up inside the sections below rather than as a headline capability of its own.

> **Caveat — delivered ≠ live.** Everything below is merged on `preprod`. `main` is 75 commits behind and the production database is four migrations behind, so a good share of this is not yet reachable on the production deployment. Closing that gap is the first item in August.

### Governance

- **In-app voting for multisig DReps** — Ekklesia/Hydra budget voting, DRep-registration detection, segmented ballot UX, proposal cards with DB-cached tallies ([#272](https://github.com/MeshJS/multisig/pull/272), [#279](https://github.com/MeshJS/multisig/pull/279), [#296](https://github.com/MeshJS/multisig/pull/296), [#297](https://github.com/MeshJS/multisig/pull/297), [#302](https://github.com/MeshJS/multisig/pull/302)). Closed the metadata hash-mismatch ([#122](https://github.com/MeshJS/multisig/issues/122)) five months early.
- **Public DRep vote-history explorer** — `/governance/drep` and `/governance/drep/[id]`, no wallet required. Full vote history with search + vote filter, CIP-100/CIP-136 rationales resolved from the anchor via IPFS, and a 9-column CSV export that resolves every rationale before writing. Served through a Koios proxy (`/api/governance/drepVotes`) because Blockfrost omits the proposal + rationale anchor ([#337](https://github.com/MeshJS/multisig/pull/337)–[#339](https://github.com/MeshJS/multisig/pull/339)).
- **Rationale drafting, IPFS reliability, ballot CSV import/export** ([#300](https://github.com/MeshJS/multisig/pull/300)), with ReDoS hardening in `extractCidPath` ([#315](https://github.com/MeshJS/multisig/pull/315)).

### Bot platform — arrived ~4 months ahead of its M7 slot

- **Human-in-the-loop onboarding**: `botRegister` → `botClaim` (owner approves a 30-min claim code with their own JWT) → `botPickupSecret` (one-time) → `botAuth`, plus self-service `botRotateSecret` and `botMe`.
- **Double opt-in authorization**: five scopes (`multisig:create|read|sign`, `governance:read`, `ballot:write`) on the key **and** a per-wallet grant (`WalletBotAccess`, `cosigner`/`observer`). Secrets stored as `JWT_SECRET`-peppered HMAC-SHA256; one bot is bound to one payment address at first auth. A bot can never move funds alone — the wallet's M-of-N threshold still gates submission.
- **27 `/api/v1/*` handlers accept bot JWTs**, including wallet creation, UTxO/pending-tx reads, `addTransaction`, `signTransaction` with auto-submit on threshold, server-built stake and DRep certificates, and the full Plutus proxy suite.
- **Ballot drafting by bots** (`botBallotsUpsert`, `botBallots`) — observer access is sufficient to draft ([#341](https://github.com/MeshJS/multisig/pull/341)–[#345](https://github.com/MeshJS/multisig/pull/345)).
- **Rate limiting + body-size caps** in `src/lib/security/requestGuards.ts`: 60/min default, 15/min strict on register/pickup/auth, 5/min on rotate, 40/min per bot id.
- **Management UI + audit**: `BotManagementCard` on `/user` and the wallets dashboard, a `bot` tRPC router for scopes/grants/revocation, and an append-only `AuditLog`.

### Developer & agent surface — the M8 "API documentation and developer portal" item, already standing

`/api-docs` (Swagger UI with a wallet-signature bearer-token generator), `/api/swagger` (1841-line OpenAPI 3.0 spec), `/llms.txt` (agent orientation incl. a self-contained bot quickstart), `/api/skill` (downloadable agent skill), `src/pages/api/v1/README.md` as the authoritative endpoint reference, and a reference client in `scripts/bot-ref/` ([#328](https://github.com/MeshJS/multisig/pull/328), [#346](https://github.com/MeshJS/multisig/pull/346)).

### Notifications

Resend-backed email channel with a real outbox: `NotificationDelivery` carries an idempotency key, attempt counter, `nextAttemptAt` backoff and nine statuses (including four distinct skip reasons), drained by `drainNotificationOutbox` via a token-authenticated `POST /api/notifications/drain`. Event types are `email.verify`, `signature.required`, `signature.reminder`. Per-wallet × per-signer settings UI on the wallet Info page, plus hashed-token email verification ([#322](https://github.com/MeshJS/multisig/pull/322), [#326](https://github.com/MeshJS/multisig/pull/326)). **Gap:** no scheduled workflow drains the outbox — `daily-balance-snapshots.yml` is the only cron in the repo.

### Testing & CI

- **Playwright E2E**: 11 spec files, ~54 tests, in `e2e/tests/` — wallet creation (legacy + SDK), ring transfers on real preprod, staking, proxy, DRep/ballot UI, bot management, notification settings, wallet access control, signing rejection, responsive smoke. Runs in Docker via `pr-playwright-browser.yml`, serialized against the v1 smoke job through a shared `ci-preprod-wallets` concurrency group ([#323](https://github.com/MeshJS/multisig/pull/323), [#335](https://github.com/MeshJS/multisig/pull/335), [#336](https://github.com/MeshJS/multisig/pull/336)).
- **Preprod environment + real-chain smoke CI** — built in April: the `preprod` branch and environment ([#218](https://github.com/MeshJS/multisig/pull/218)) and the CI smoke-test system that exercises the route chain against real preprod ([#217](https://github.com/MeshJS/multisig/pull/217)), which skips gracefully when `SMOKE_*` secrets are absent. [#213](https://github.com/MeshJS/multisig/issues/213) closed once the first real run was linked. Everything since — the Playwright suite above included — runs on this foundation.
- deploy-migrations on Node 22 + manual dispatch ([#319](https://github.com/MeshJS/multisig/pull/319)); RLS follow-up migration authored ([#332](https://github.com/MeshJS/multisig/pull/332)); worktree gitlink fix ([#333](https://github.com/MeshJS/multisig/pull/333)).

### Platform

**Transaction & signing integrity** — the through-line from April onward: extraneous VKey witnesses filtered out of submitted transactions ([#217](https://github.com/MeshJS/multisig/pull/217)); an invalid-CBOR guard on `POST /api/v1/addTransaction` plus a degraded "unreadable transaction" card with Reject & Delete, so an API-poisoned row can no longer lock a wallet's UTxOs ([#227](https://github.com/MeshJS/multisig/pull/227), [#211](https://github.com/MeshJS/multisig/issues/211)); Mesh SDK pinned to exact versions after a lockfile patch drift changed Conway CBOR encoding and made multisig DRep votes fail on chain, with a client-side guard that now rejects witnesses which don't verify against the body they're attached to ([#257](https://github.com/MeshJS/multisig/pull/257)).

**Wallet lifecycle** — Import Wallet wizard covering four sources (another multisig instance, Summon, native-script CBOR, JSON backup) with `importWallet`/`exportWallet` procedures, cross-instance endpoints reusing the CIP-8 `checkSignature` path, a downloadable JSON backup and a `lockedSigners` gate so imported wallets can't silently diverge from their origin ([#259](https://github.com/MeshJS/multisig/pull/259)); on-chain wallet registration and discovery ([#340](https://github.com/MeshJS/multisig/pull/340)).

**Everything else** — Mesh 2.0 groundwork (Prisma 7.8 + Next 16, tx-builder hardfork upgrade, wallet ops consolidated behind one bridge with an ESLint guardrail); signing & auth reliability (bech32 normalization, `signData` arg order, core-cst witness/body-hash merge, stuck-"Loading…" recovery, cross-instance import, non-opaque wallet-session status codes); mobile foundations, skeleton/empty states, error toasts, pagination; landing + SEO + glass theme overhaul.

### Landed ahead of schedule

| Capability | Planned | Actually delivered | Effect on the plan |
|------------|---------|--------------------|--------------------|
| Governance metadata fix (#122) | M7 (Nov) | June | Closed |
| Wallet V2 — registration & discovery (#33) | M3 (Jul) | July ([#340](https://github.com/MeshJS/multisig/pull/340)) | On time; feeds the Discover page (#52), which moves up from M10 |
| Bot platform (SDK/reference client, scoped auth, ballot API) | M7 (Nov) | July | M7 reduces to **webhooks only** — no webhook code exists yet |
| API documentation & developer portal | M8 (Dec) | June–July | Done; M8 slot freed |
| Pending transactions on user's homepage (#125) | M7 (Nov) | Shipped — surfaced on the wallets dashboard | Issue still open; verify and close |
| Playwright E2E suite | Not scheduled | June–July | Becomes the safety net Document Sign-Off ships against |

---

## Month 1 — April 2026

**Focus:** Establish foundations and fix critical blockers.

| Task | Owner | Issues |
|------|-------|--------|
| Define review process for issues and PRs | Quirin + Andre | |
| Improve repository infrastructure — add preprod environment and more comprehensive smoke CI | Quirin + Andre | |
| **CI smoke tests on real chain** - Complete the preprod CI system | Andre | #213 |
| **Fix transaction loading bug** - API-added transactions break the page | Quirin | #211 |
| **Review and handle open external PRs** - Summon API routes and capability-based metadata from kanyuku | Quirin + Andre | PR #212, PR #208 |
| Fix legacy wallet compatibility bug | Quirin + Andre | |

### Proof of completion

Status of M1 tasks. Last updated 2026-04-23.

| Task | Status | Evidence |
|------|--------|----------|
| Define review process for issues and PRs | Drafted | [`CONTRIBUTING.md`](CONTRIBUTING.md) covers issue template, branch/commit conventions, PR + review process, merge rules. Pending: team sign-off |
| Improve repository infrastructure — preprod + smoke CI | Done | `preprod` branch active; [PR #218](https://github.com/MeshJS/multisig/pull/218) merged; [`.github/workflows/ci-smoke-preprod.yml`](.github/workflows/ci-smoke-preprod.yml) landed |
| CI smoke tests on real chain (#213) | Landed, awaiting secrets | [PR #217](https://github.com/MeshJS/multisig/pull/217) merged (CI smoke system + VKey witness fix); `dc49af2` skips gracefully when secrets missing. All runs since have hit the skip path (~8s) because `SMOKE_*` repo secrets are not yet configured; [Issue #213](https://github.com/MeshJS/multisig/issues/213) stays open until the first real route-chain run is linked |
| Fix transaction loading bug (#211) | In review | [PR #227](https://github.com/MeshJS/multisig/pull/227) open: validates CBOR + JSON on `POST /api/v1/addTransaction` and renders a degraded "Unreadable transaction" card with Reject & Delete so already-poisoned wallets can free their UTxOs |
| Review and handle open external PRs (PR #212, PR #208) | Reviewed, awaiting author | Change requests left on [PR #212](https://github.com/MeshJS/multisig/pull/212) (rebase to `preprod`, drop non-null assertion in `useWalletBalances`, Summon `canVote` TODO) and [PR #208](https://github.com/MeshJS/multisig/pull/208) (superset of #212, recommended to close) |
| Fix legacy wallet compatibility bug | Done | [PR #210](https://github.com/MeshJS/multisig/pull/210) (legacy drep retirement) and [PR #225](https://github.com/MeshJS/multisig/pull/225) (drep deregistration fix, commit `4ae3d10`) merged; [Issue #223](https://github.com/MeshJS/multisig/issues/223) closed |

---

## Month 2 — May 2026

**Focus:** Mesh 2.0 migration groundwork, signing/auth reliability, in-app governance voting, and platform UX + CI hardening.

**Quirin**

| Task | Issues |
|------|--------|
| Mesh 2.0 migration groundwork — Prisma 7 + Next 16 base, tx-builder hardfork-ready, consolidate wallet ops onto a single bridge (runtime stays on Mesh 1.9 until cutover) | #268, #269 |
| Signing & auth reliability — bech32 normalization, Mesh-1.9 `signData` arg order, core-cst witness/body-hash merge, stuck-"Loading…" recovery, cross-instance import | |
| In-app governance voting — Ekklesia/Hydra budget voting for multisig DReps, DRep-registration detection, ballot UX, proposal cards + DB-cached tallies | #122 |
| IPFS reliability + rationale drafting/caching + ballot CSV | |
| Platform UX foundations — mobile viewport/touch/dialogs/inputs, skeleton/empty states, error toasts, landing + SEO + theme overhaul | |

**Andre**

| Task | Issues |
|------|--------|
| CI improvements — real-chain smoke system, Added transaction-builder unit tests and tRPC integration tests, Added authorization and persistence tests for transaction and proxy tRPC procedures. | #255 |
| Email notification service — signature-required emails via Resend, notification center + outbox/worker, per-wallet settings, email verification | #327 |

### Progress

Mid-month snapshot. Last updated 2026-06-17.

| Task | Status | Evidence |
|------|--------|----------|
| Mesh 2.0 migration groundwork | In progress | Prisma 7.8 + Next 16 on `preprod`; tx-builder hardfork upgrade ([#268](https://github.com/MeshJS/multisig/pull/268)) and Prisma 7 + mesh-2.0 staging merge ([#269](https://github.com/MeshJS/multisig/pull/269)); wallet ops consolidated on the Mesh 1.9 bridge with an ESLint guardrail ([#278](https://github.com/MeshJS/multisig/pull/278)) as cutover groundwork. Runtime still on `@meshsdk/core@^1.9`; full 2.0 cutover carries into July |
| Signing & auth reliability | Done | bech32 normalization ([#273](https://github.com/MeshJS/multisig/pull/273)), Mesh-1.9 `signData` arg order ([#277](https://github.com/MeshJS/multisig/pull/277)), stuck-"Loading…" recovery ([#281](https://github.com/MeshJS/multisig/pull/281)/[#282](https://github.com/MeshJS/multisig/pull/282)), core-cst witness/body-hash merge ([#286](https://github.com/MeshJS/multisig/pull/286)), cross-instance mobile import ([#274](https://github.com/MeshJS/multisig/pull/274)) |
| In-app governance voting | Done | Ekklesia/Hydra budget voting ([#272](https://github.com/MeshJS/multisig/pull/272)), DRep-registration detection ([#279](https://github.com/MeshJS/multisig/pull/279)), segmented ballot UX + type chips ([#296](https://github.com/MeshJS/multisig/pull/296)/[#297](https://github.com/MeshJS/multisig/pull/297)), proposal cards + DB-cached tallies ([#302](https://github.com/MeshJS/multisig/pull/302)). Closes the metadata hash-mismatch ([#122](https://github.com/MeshJS/multisig/issues/122)) ahead of its planned month |
| IPFS + rationale + ballot CSV | Done | Reliable IPFS proxy, rationale caching, ballot CSV ([#300](https://github.com/MeshJS/multisig/pull/300)); ReDoS hardening in `extractCidPath` ([#315](https://github.com/MeshJS/multisig/pull/315)) |
| Platform UX foundations | Done | Mobile foundations ([#287](https://github.com/MeshJS/multisig/pull/287)–[#291](https://github.com/MeshJS/multisig/pull/291)), skeleton/empty states ([#289](https://github.com/MeshJS/multisig/pull/289)), error toasts ([#292](https://github.com/MeshJS/multisig/pull/292)), pagination/labels/assets ([#293](https://github.com/MeshJS/multisig/pull/293)–[#295](https://github.com/MeshJS/multisig/pull/295)), landing + SEO + theme ([#298](https://github.com/MeshJS/multisig/pull/298)/[#299](https://github.com/MeshJS/multisig/pull/299)/[#308](https://github.com/MeshJS/multisig/pull/308)–[#318](https://github.com/MeshJS/multisig/pull/318)) |
| CI improvements | Done | Real-chain smoke system closed ([#213](https://github.com/MeshJS/multisig/issues/213)); deploy-migrations moved to Node 22 + manual dispatch ([#319](https://github.com/MeshJS/multisig/pull/319)); pg pool cap ([#284](https://github.com/MeshJS/multisig/pull/284)); npm override for brace-expansion ReDoS ([#301](https://github.com/MeshJS/multisig/pull/301)) |
| Email notification service | In progress | Built on `feature/email-notification-center` (Resend email channel, notification center + outbox/worker, tRPC router, per-wallet settings UI, email verification, tests, plan doc); ([#322](https://github.com/MeshJS/multisig/pull/322)) |

**Carryover into July:** complete the Mesh 2.0 runtime cutover; land the Node-22 deploy-migrations fix on `main` and apply the pending `ProposalTally` migration to production (governance tallies error until it exists); review the Supabase RLS advisory on the seven `rls_enabled: false` tables.

---

## Month 3 — June 2026

**Focus:** Mesh 2.0 cutover, on-chain wallet discovery (Wallet V2), and FROST research kickoff.

**Quirin**

| Task | Issues |
|------|--------|
| Mesh 2.0 runtime cutover — move `@meshsdk/core`/`core-cst` off the 1.9 bridge to 2.0, byte-preserving signing so co-signers still sign identical bytes; drop the 1.9 ESLint guardrail once complete (carryover from June) | |
| FROST research kickoff — survey Cardano-compatible FROST libraries + protocol readiness, draft the native-script vs threshold-Schnorr trade-off note, scope a PoC | #220 |
| Production hardening follow-through — land the Node-22 deploy-migrations fix on `main`, apply the pending `ProposalTally` migration, review the Supabase RLS advisory | #319 |

**Andre**

| Task | Issues |
|------|--------|
| Wallet V2 — on-chain registration and discovery — design the on-chain registration record + discovery index, define the data model, prototype lookup by signer/policy | #33 #349 |
| CI/maintenance baseline — keep smoke + unit/tRPC suites green on Node 22, dependency/security updates | |

### Progress

End-of-month snapshot. Last updated 2026-07-26.

| Task | Status | Evidence |
|------|--------|----------|
| Mesh 2.0 runtime cutover | **Blocked upstream** | Re-checked 2026-07-26: npm latest for `@meshsdk/core`/`core-cst`/`core-csl` is still **1.9.1** — no 2.x has been published. Only `@meshsdk/react` has a 2.0 (2.0.0-beta.2), already in use. Readiness on our side is verified: all wallet ops funnel through the `useMeshWallet`/`useActiveWallet` bridge ([#278](https://github.com/MeshJS/multisig/pull/278)) and byte-preserving witness merge is implemented + regression-tested (`src/__tests__/mergeSignerWitnesses.test.ts`). When core 2.0 ships, the cutover is a single-layer change: bump `@meshsdk/*`, re-source the bridge wallet, fix the 2.0 deltas (`signData` arg order, `signTx(tx, partialSign)`, `getUtxos(): string[]`, removed `getDRep`/`getAssets`/`getLovelace`), drop the ESLint guardrail. **Demoted from a monthly task to a standing watch item** — it cannot be scheduled against an unpublished dependency |
| Production hardening follow-through | **Not done — regressed into a release gap** | The production database has applied **no migration since 2026-05-10** (`20260510170000_make_user_nostrkey_optional` is the newest row in `_prisma_migrations`). Four migrations are outstanding: `add_proposal_tally`, `add_notification_center`, `enable_rls_followup_tables`, `pending_bot_optional_address`. The Node-22 fix did land, but `deploy-migrations.yml` only fires on pushes to `main` that touch `prisma/migrations/**`, so the fix never re-triggered the failed June 17 run. Compounding it, `main` itself carries migrations only through `add_proposal_tally` — **`preprod` is 75 commits ahead of `main`**, so all of July's work is unreleased. Consequences in production today: governance tallies error (no `ProposalTally`), the notification center has no tables, address-less bot registration cannot work, and [#332](https://github.com/MeshJS/multisig/pull/332)'s RLS fix is merged but **not applied** |
| Supabase RLS advisory | **Open security exposure** | Verified against the production project 2026-07-26: 7 tables still have `rls_enabled: false` — `Contact`, `BotKey`, `BotUser`, `WalletBotAccess`, `PendingBot`, `BotClaimToken`, `AuditLog` — and are reachable by the `anon`/`authenticated` PostgREST roles. The remediation is already written (`20260706100000_enable_rls_followup_tables`); it is purely undeployed. Supabase additionally reports the Postgres version (`supabase-postgres-17.4.1.064`) has outstanding security patches, which is a dashboard-side upgrade |
| FROST research kickoff (#220) | Not started | Carried to August. Needs to start there to leave runway before the October go/no-go |
| CI/maintenance baseline | Watch item — unchanged | `pr-multisig-v1-smoke.yml` still `exit 1`s in its "Validate required CI secrets" step when secrets are absent, and dependabot-triggered runs never receive repo Actions secrets. Every dependabot PR is therefore red for systemic reasons, not because of the version bump — 7 are open, the oldest since 2026-06-15. The sibling `ci-smoke-preprod.yml` already has the skip-when-unconfigured guard to copy |
| Wallet V2 (#33) | Delivered | On-chain wallet registration + discovery shipped in [#340](https://github.com/MeshJS/multisig/pull/340) |
| Unplanned July delivery | Delivered | Bot platform, DRep vote-history explorer, Playwright E2E, and agent/API documentation all landed this month — see [Delivered to date](#delivered-to-date-april--july-2026) |

---

## Month 4 — July 2026

**Focus:** Close the production release gap, then start Document Sign-Off (see [Flagship feature](#flagship-feature--document-sign-off)).

Revised 2026-07-26. July's actual output ([Delivered to date](#delivered-to-date-april--july-2026)) freed the M7/M8 documentation and bot slots, and surfaced a release gap that outranks all feature work.

**Quirin**

| Task | Issues |
|------|--------|
| **Ship July to production** *(do this first)* — release `preprod` → `main` (75 commits), then dispatch "Deploy Database Migrations" and confirm all four outstanding migrations apply. Closes the RLS exposure on 7 tables, un-breaks governance tallies, and makes the notification center and address-less bot registration reachable in production | #332 |
| Migration-deploy reliability — make the release path self-verifying rather than path-filter dependent: run `prisma migrate status` as a post-deploy gate and alert on drift, so "merged" and "applied" cannot silently diverge again | #319 |
| Document Sign-Off MVP (build) — finalize PRD-001 (still `status: Draft`) first, then the 5-model Prisma schema, tRPC routes, CIP-8 signature enforcement, version-hash binding | |
| FROST research kickoff — survey Cardano-compatible FROST libraries + protocol readiness, draft the native-script vs threshold-Schnorr trade-off note, scope a PoC *(carryover from M3; must start here to leave runway for the October go/no-go)* | #220 |

**Andre**

| Task | Issues |
|------|--------|
| Transaction visualization MVP (build) — Token-flow viz component, new tx building page that uses new component | |
| Unblock dependabot CI — port the skip-when-unconfigured guard from `ci-smoke-preprod.yml` into `pr-multisig-v1-smoke.yml`, then clear the 7 open dependency PRs (oldest open since 2026-06-15) | |
| Notification center follow-ups — gov-proposal improvements, Playwright coverage in CI, and a scheduled drain for the outbox (no cron currently runs `drainNotificationOutbox`) | #327 |

---

## Month 5 — August 2026

**Focus:** Document Sign-Off MVP — ship (8–10 wk effort completes); discovery consolidation.

**Quirin**

| Task | Issues |
|------|--------|
| Document Sign-Off MVP (ship) — proof export (JSON + PDF), verify route. Ready = a pilot team runs all six user stories end-to-end without developer help (PRD-001's own bar)| |
| Test depth — extend the Playwright suite to cover the Sign-Off flows, plus transaction-builder & tRPC integration tests | #255 |

**Andre**

| Task | Issues |
|------|--------|
| Transaction visualization MVP (ship) — extend the tx visualizer to work with bot and display/build all tx types multisig is capable of doing | |
| Discover page — fold into the delivered Wallet V2 registration/discovery rather than building it standalone; add lookup by signer/policy *(moved up from M10)* | #52, #33 |
| Notification digests & deadline reminders — ballot-deadline and threshold-reached emails on the existing outbox (product work, infrastructure already exists) | |
| Monthly report | |

---

## Month 6 — September 2026

**Focus:** Document Sign-Off provenance, FROST findings, and MCP transaction review.

**Quirin**

| Task | Issues |
|------|--------|
| Document Sign-Off v1 — Provenance (history, diff & rollback, richer audit export) | |
| FROST research — deliver findings, PoC, go/no-go | #220 |

**Andre**

| Task | Issues |
|------|--------|
| MCP unsigned transaction creation — create unsigned multisig transactions through MCP and prepare them for signer review | |
| Transaction review PNG & in-chat review — generate a clear PNG summary containing the key transaction details and display it in the user's chat for human review; MCP must not sign or broadcast on the user's behalf | |

---

## Month 7 — October 2026

**Focus:** Governance polish, dApp connector, and advanced transaction building.

Revised 2026-07-26: the governance metadata fix closed in June, and the bot platform and developer portal shipped in July, so this month absorbs the work those slots were holding.

**Quirin**

| Task | Issues |
|------|--------|
| dApp connector — external dApps request multi-sig transactions | |
| Improved authentication — pairs naturally with the connector, since external dApp access and auth are the same problem surface | #135 |

**Andre**

| Task | Issues |
|------|--------|
| Output datum controls — let users attach and edit validated inline datum values on individual transaction outputs under Advanced, preserve each output-to-datum association through draft editing, and encode the datums in the generated unsigned transaction | |
| Plutus script-spend and redeemer controls — let users configure Plutus-controlled inputs with their script, datum source, and validated redeemer under Advanced; use an ADA-only collateral UTxO supplied by the connected signer, require that collateral owner's signature, show the amount at risk, and evaluate and preserve the script data in the generated unsigned transaction. Automatic collateral creation, reservation, and collateral-return management remain in #221 | |

---

## Month 8 — November 2026

**Focus:** Proxy voting, testing, backlog.

**Quirin**

| Task | Issues |
|------|--------|
| Proxy voting polish and documentation | |
| Collateral service for proxy usage — the last backlog item with no roadmap slot | #221 |

**Andre**

| Task | Issues |
|------|--------|
| Backlog cleanup, dependency/security updates | |
| Monthly report | |

---

## Month 9 — December 2026

**Focus:** Document Sign-Off checkpoints, vesting, growth.

**Quirin**

| Task | Issues |
|------|--------|
| Document Sign-Off v2 — Checkpoints (opt-in on-chain anchoring in Cardano metadata) | |
| Vesting — time-locked multi-sig contracts | #81 |

**Andre**

| Task | Issues |
|------|--------|
| User profiles and contacts — the `Contact` model and profile-image storage already exist; this is the UI and the social layer on top, not a from-scratch build | |

---

## Month 10 — January 2027

**Focus:** Invite flow.

**Quirin**

| Task | Issues |
|------|--------|
| Invite flow | PR #67 |

**Andre**

| Task | Issues |
|------|--------|
| Open slot — the Discover page moved up to M5 to ride the delivered Wallet V2 discovery work. Reserve for spillover or pull forward from M11 | |

---

## Month 11 — February 2027

**Focus:** Polish, wrap-up, and forward-looking research.

**Quirin**

| Task | Issues |
|------|--------|
| Performance and UX audit | |
| Final summary report — activity, outcomes, gaps, next steps | |

**Andre**

| Task | Issues |
|------|--------|
| Document Sign-Off v3 — Collaboration & standards (CRDT/QES bridge — scoped as research) | |
| Monthly report | |

---

## Month 12 — March 2027

**Focus:** Buffer / catch-up — absorb slippage from earlier months, finalize reporting, plan next cycle.

No fixed feature commitments; reserved for spillover, stabilization, and next-roadmap planning.

---

## Flagship feature — Document Sign-Off

A wallet-native, off-chain document approval layer: bind approval to an exact version hash, inherit the wallet's signer set + threshold, and collect CIP-8 sign-off (approve/reject) per signer. No new chain, no new token, no change to the transaction model — delivered as a Documents section inside the wallet.

| Phase | Scope | Months |
|-------|-------|--------|
| MVP — Sign-off | Documents section, six-state lifecycle, version-hash binding, signer review, exportable JSON+PDF proof. Off-chain. | M4–M5 |
| v1 — Provenance | Revision history first-class, diff & rollback, richer audit export (off-chain). | M6 |
| v2 — Checkpoints | Optional on-chain anchoring of a version's hash + parent in Cardano tx metadata. | M9 |
| v3 — Collaboration & standards | Real-time co-authoring (CRDT), metadata standard (CIP candidate), eIDAS/EUDI QES bridge. | M11 (research) |

**Data model:** five entities (`Document`, `DocumentVersion`, `DocumentReview`, `DocumentSignerSnapshot`, `DocumentEvent`) + optional `Checkpoint`, all reusing wallet signer identity and threshold. Approval belongs to a version, never a mutable container; a new version starts a fresh round at zero approvals.

---

## Research Track

| Topic | Description | Months | Owner |
|-------|-------------|--------|-------|
| **FROST & PQC multi-sig wallets** | Research FROST (Flexible Round-Optimized Schnorr Threshold) signatures for Cardano. Evaluate feasibility of replacing or complementing native script multi-sig with threshold Schnorr signatures — smaller on-chain footprint, better privacy (single signature on-chain), and flexible threshold schemes. Investigate Cardano-compatible FROST libraries, protocol readiness, and migration path from current native scripts. Also evaluate **Lemour post-quantum (PQC) multi-sig** — lattice-based threshold signatures for long-term quantum resistance — as a forward-looking alternative/complement to FROST. | M3 (kickoff) – M6 (findings) | Quirin |

**Research deliverables:**
- Written summary of FROST vs native script trade-offs
- Assessment of Lemour PQC multi-sig — maturity, libraries, and quantum-resistance trade-offs vs FROST
- Proof-of-concept if libraries are available
- Go/no-go recommendation for integration into the platform

---

## Flexibility

- No requirements for feature delivery or releases
- Tasks can scale up/down based on project activity
- Monthly tasks can be identical where appropriate
- Features shift forward if blockers arise — maintenance baseline always holds

---

## How to work together

**Cadence:**
- Weekly 30-min sync to pick up / hand off features
- Each contributor owns 1-2 features per month end-to-end
- PRs reviewed by the other contributor before merge

**Reports:**
- Monthly progress report
- Final summary report in month 12

**GitHub milestones:** Created and issues assigned. View at [Milestones](../../milestones).

---

## Task ownership

Aggregated view of the 12-month roadmap split by contributor. Each task has a single owner; the other contributor reviews the PR.

### Quirin

- [M1] Define review process for issues and PRs
- [M1] Fix transaction loading bug (#211)
- [M1] Handle external PR — Summon API routes (PR #212)
- [M1] Fix legacy wallet compatibility bug
- [M2] Mesh 2.0 migration groundwork — Prisma 7 + Next 16 base, tx-builder hardfork-ready, wallet-bridge consolidation (#268, #269)
- [M2] Signing & auth reliability — bech32 normalization, signData arg order, core-cst witness/body-hash, stuck-loading recovery
- [M2] In-app governance voting — Ekklesia/Hydra budget voting, DRep-registration detection, ballot UX, DB-cached tallies (#122)
- [M2] IPFS reliability + rationale caching + ballot CSV
- [M2] Platform UX foundations — mobile, skeleton/empty states, error toasts, landing + SEO + theme
- [M3] Mesh 2.0 runtime cutover — ⏸ blocked upstream (no `@meshsdk/core` 2.x on npm); now a standing watch item, not a scheduled task
- [M3] Production hardening follow-through (#319) — ⚠️ not done; escalated into the M4 release-gap task
- [M4] **Ship July to production** — release `preprod` → `main`, dispatch migrations, close the RLS exposure (#332)
- [M4] Migration-deploy reliability — post-deploy `prisma migrate status` gate + drift alert (#319)
- [M4] FROST research kickoff (#220) — carryover from M3
- [M4–5] Document Sign-Off MVP — finalize PRD-001, data model, routes, CIP-8 enforcement, proof export
- [M5] Test depth — Playwright coverage for Sign-Off, tx-builder & tRPC integration tests (#255)
- [M6] Document Sign-Off v1 — Provenance (history, diff & rollback, audit export)
- [M6] FROST research — deliver findings, PoC, go/no-go (#220)
- [M7] Governance metadata fix (#122) — ✅ closed early in June
- [M7] dApp connector — external dApps request multi-sig transactions
- [M7] Improved authentication (#135)
- [M8] Proxy voting polish and documentation
- [M8] Collateral service for proxy usage (#221)
- [M9] Document Sign-Off v2 — Checkpoints (opt-in on-chain anchoring)
- [M9] Vesting — time-locked multi-sig contracts (#81)
- [M10] Invite flow (PR #67)
- [M11] Performance and UX audit
- [M11] Final summary report

### Andre

- [M1] Improve repository infrastructure — preprod environment and comprehensive smoke CI
- [M1] CI smoke tests on real chain (#213)
- [M1] Handle external PR — capability-based metadata (PR #208)
- [M2] CI improvements — real-chain smoke system, deploy-migrations on Node 22, dependency/security hardening (#213)
- [M2] Email notification service — signature-required emails via Resend, notification center + outbox/worker, per-wallet settings, email verification
- [M3] Wallet V2 — on-chain registration and discovery (#33) — ✅ delivered in July (#340)
- [M3] CI/maintenance baseline — keep suites green on Node 22, dependency/security updates
- [M4] Unblock dependabot CI — skip-when-unconfigured guard in `pr-multisig-v1-smoke.yml`, then clear the 7 open dependency PRs
- [M4] Notification center follow-ups — gov-proposal improvements, Playwright coverage, scheduled outbox drain (#327)
- [M4–5] Document Sign-Off MVP — Documents UI, six-state lifecycle, signer review, diffs
- [M5] Discover page + lookup by signer/policy (#52, #33) — moved up from M10
- [M5] Notification digests & deadline reminders
- [M6] MCP unsigned transaction creation — create unsigned multisig transactions through MCP and prepare them for signer review
- [M6] Transaction review PNG & in-chat review — generate and display a visual transaction summary in chat without signing or broadcasting
- [M7] Output datum controls — attach and edit validated inline datum values on individual transaction outputs under Advanced, preserve each output-to-datum association through draft editing, and encode the datums in the generated unsigned transaction
- [M7] Plutus script-spend and redeemer controls — configure Plutus-controlled inputs with their script, datum source, and validated redeemer under Advanced; use an ADA-only collateral UTxO supplied by the connected signer, require that collateral owner's signature, show the amount at risk, and evaluate and preserve the script data in the generated unsigned transaction. Automatic collateral creation, reservation, and collateral-return management remain in #221
- [M8] Backlog cleanup, dependency/security updates
- [M9] User profiles and contacts
- [M11] Document Sign-Off v3 — Collaboration & standards (research)
