# 12-Month Roadmap: Mesh Multi-Sig Wallet

**Timeline:** May 2026 - April 2027  
**Team:** Quirin + Andre, part-time (~25 hrs/week combined), feature-based ownership  
**Approach:** Month-by-month cadence combining baseline maintenance with feature delivery. No hard requirements for feature delivery or releases — tasks scale up/down based on project activity.

---

## Baseline (applies every month)

- Issues and PRs do not stall
- Repository remains stable and usable
- Documentation does not fall out of date

---

## Month 1 — May 2026

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

## Month 2 — June 2026

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
| CI improvements — real-chain smoke system, deploy-migrations on Node 22, dependency/security hardening | #213 |

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

**Carryover into July:** complete the Mesh 2.0 runtime cutover; land the Node-22 deploy-migrations fix on `main` and apply the pending `ProposalTally` migration to production (governance tallies error until it exists); review the Supabase RLS advisory on the seven `rls_enabled: false` tables.

---

## Month 3 — July 2026

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
| Wallet V2 — on-chain registration and discovery — design the on-chain registration record + discovery index, define the data model, prototype lookup by signer/policy | #33 |
| CI/maintenance baseline — keep smoke + unit/tRPC suites green on Node 22, dependency/security updates | |

---

## Month 4 — August 2026

**Focus:** Document Sign-Off MVP — build (see [Flagship feature](#flagship-feature--document-sign-off)).

**Quirin**

| Task | Issues |
|------|--------|
| Document Sign-Off MVP (build) — 5-table data model, four routes, CIP-8 signature enforcement, version-hash binding | |

**Andre**

| Task | Issues |
|------|--------|
| Document Sign-Off MVP (build) — Documents section UI, six-state lifecycle, signer review screen | |

---

## Month 5 — September 2026

**Focus:** Document Sign-Off MVP — ship (8–10 wk effort completes).

**Quirin**

| Task | Issues |
|------|--------|
| Document Sign-Off MVP (ship) — proof export (JSON + PDF), verify route | |

**Andre**

| Task | Issues |
|------|--------|
| Document Sign-Off MVP (ship) — diffs where feasible, status grouping, polish | |
| Monthly report | |

---

## Month 6 — October 2026

**Focus:** Document Sign-Off provenance, FROST findings, hardware wallets.

**Quirin**

| Task | Issues |
|------|--------|
| Document Sign-Off v1 — Provenance (history, diff & rollback, richer audit export) | |
| FROST research — deliver findings, PoC, go/no-go | #220 |

**Andre**

| Task | Issues |
|------|--------|
| Hardware wallet support — Ledger/Trezor | #44 |

---

## Month 7 — November 2026

**Focus:** Governance polish, dApp connector, bot platform.

**Quirin**

| Task | Issues |
|------|--------|
| Governance metadata fix | #122 |
| dApp connector — external dApps request multi-sig transactions | |

**Andre**

| Task | Issues |
|------|--------|
| Pending transactions on homepage | #125 |
| Bot platform v2 — SDK, webhooks, example bots | |

---

## Month 8 — December 2026

**Focus:** Proxy voting, testing, developer experience.

**Quirin**

| Task | Issues |
|------|--------|
| Proxy voting polish and documentation | |
| Transaction builder & tRPC integration tests | #255 |

**Andre**

| Task | Issues |
|------|--------|
| API documentation and developer portal | |
| Backlog cleanup, dependency/security updates | |
| Monthly report | |

---

## Month 9 — January 2027

**Focus:** Document Sign-Off checkpoints, vesting, growth.

**Quirin**

| Task | Issues |
|------|--------|
| Document Sign-Off v2 — Checkpoints (opt-in on-chain anchoring in Cardano metadata) | |
| Vesting — time-locked multi-sig contracts | #81 |

**Andre**

| Task | Issues |
|------|--------|
| User profiles and contacts | |

---

## Month 10 — February 2027

**Focus:** Invite flow and discovery.

**Quirin**

| Task | Issues |
|------|--------|
| Invite flow | PR #67 |

**Andre**

| Task | Issues |
|------|--------|
| Discover page — browse wallets, DAOs, governance | #52 |

---

## Month 11 — March 2027

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

## Month 12 — April 2027

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
- [M3] Mesh 2.0 runtime cutover (carryover from M2)
- [M3] FROST research kickoff (#220)
- [M3] Production hardening follow-through — Node-22 migration CI on `main`, apply `ProposalTally`, RLS review (#319)
- [M4–5] Document Sign-Off MVP — data model, routes, CIP-8 enforcement, proof export
- [M6] Document Sign-Off v1 — Provenance (history, diff & rollback, audit export)
- [M6] FROST research — deliver findings, PoC, go/no-go (#220)
- [M7] Governance metadata fix (#122) — ✅ closed early in June
- [M7] dApp connector — external dApps request multi-sig transactions
- [M8] Proxy voting polish and documentation
- [M8] Transaction builder & tRPC integration tests (#255)
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
- [M3] Wallet V2 — on-chain registration and discovery (#33)
- [M3] CI/maintenance baseline — keep suites green on Node 22, dependency/security updates
- [M4–5] Document Sign-Off MVP — Documents UI, six-state lifecycle, signer review, diffs
- [M6] Hardware wallet support — Ledger/Trezor (#44)
- [M7] Pending transactions on homepage (#125)
- [M7] Bot platform v2 — SDK, webhooks, example bots
- [M8] API documentation and developer portal
- [M8] Backlog cleanup, dependency/security updates
- [M9] User profiles and contacts
- [M10] Discover page — browse wallets, DAOs, governance (#52)
- [M11] Document Sign-Off v3 — Collaboration & standards (research)
