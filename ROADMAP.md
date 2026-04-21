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

Status of M1 tasks. Last updated 2026-04-21.

| Task | Status | Evidence |
|------|--------|----------|
| Define review process for issues and PRs | Drafted | [`CONTRIBUTING.md`](CONTRIBUTING.md) covers issue template, branch/commit conventions, PR + review process, merge rules. Pending: team sign-off |
| Improve repository infrastructure — preprod + smoke CI | Done | `preprod` branch active; [PR #218](https://github.com/MeshJS/multisig/pull/218) merged; [`.github/workflows/ci-smoke-preprod.yml`](.github/workflows/ci-smoke-preprod.yml) landed |
| CI smoke tests on real chain (#213) | Landed, issue open | [PR #217](https://github.com/MeshJS/multisig/pull/217) merged (CI smoke system + VKey witness fix); follow-up `dc49af2` skips gracefully when secrets missing. [Issue #213](https://github.com/MeshJS/multisig/issues/213) still open — close once a green run on a recent PR is linked |
| Fix transaction loading bug (#211) | Not started | [Issue #211](https://github.com/MeshJS/multisig/issues/211) open, no linked PR |
| Review and handle open external PRs (PR #212, PR #208) | In progress | [PR #212](https://github.com/MeshJS/multisig/pull/212) and [PR #208](https://github.com/MeshJS/multisig/pull/208) both still open |
| Fix legacy wallet compatibility bug | Partial | [PR #210](https://github.com/MeshJS/multisig/pull/210) merged (legacy drep retirement). New [Issue #223](https://github.com/MeshJS/multisig/issues/223) "Legacy Wallet drep deregistration bug" still open |

---

## Months 2–3 — June–July 2026

**Direction:** Authentication, Summon migration, collateral service, minor fixes.

- Improved authentication — nonce-based auth, wallet connection fixes, registration flow (#135, #53)
- Summon migration — land API routes and wallet import (PR #212, PR #208)
- Collateral service — 22 ADA → 4 UTxOs for proxy collateral (#221)
- Full address verification (#196)
- Transaction pagination (#30)
- Better 404 page (#22)
- Monthly report

---

## Months 4–6 — August–October 2026

**Direction:** Governance, smart contracts, and on-chain wallet discovery.

- Aiken crowdfund integration (PR #164)
- Governance metadata fix (#122)
- Proxy voting polish and documentation
- Wallet V2 — on-chain registration and discovery (#33)
- Pending transactions on homepage (#125)
- FROST research kickoff (#220)
- Backlog cleanup, dependency/security updates
- Monthly reports

---

## Months 7–9 — November 2026–January 2027

**Direction:** Ecosystem integrations and developer experience.

- Hardware wallet support — Ledger/Trezor (#44)
- Bot platform v2 — SDK, webhooks, example bots
- dApp connector — external dApps request multi-sig transactions
- API documentation and developer portal
- FROST research — deliver findings, PoC, go/no-go (#220)
- Monthly reports

---

## Months 10–12 — February–April 2027

**Direction:** Growth features, polish, and wrap-up.

- Vesting — time-locked multi-sig contracts (#81)
- User profiles and contacts
- Discover page — browse wallets, DAOs, governance (#52)
- Performance and UX audit
- Invite flow (PR #67)
- Final summary report — activity, outcomes, gaps, next steps
- Monthly reports

---

## Research Track

| Topic | Description | Months | Owner |
|-------|-------------|--------|-------|
| **FROST multi-sig wallets** | Research FROST (Flexible Round-Optimized Schnorr Threshold) signatures for Cardano. Evaluate feasibility of replacing or complementing native script multi-sig with threshold Schnorr signatures — smaller on-chain footprint, better privacy (single signature on-chain), and flexible threshold schemes. Investigate Cardano-compatible FROST libraries, protocol readiness, and migration path from current native scripts. | 6-9 | Quirin |

**Research deliverables:**
- Written summary of FROST vs native script trade-offs
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
- [M2–3] Improved authentication — nonce-based auth, wallet connection fixes, registration flow (#135, #53)
- [M2–3] Full address verification (#196)
- [M2–3] Transaction pagination (#30)
- [M4–6] Aiken crowdfund integration (PR #164)
- [M4–6] Governance metadata fix (#122)
- [M4–6] Proxy voting polish and documentation
- [M4–6] FROST research kickoff (#220)
- [M7–9] dApp connector — external dApps request multi-sig transactions
- [M7–9] FROST research — deliver findings, PoC, go/no-go (#220)
- [M10–12] Vesting — time-locked multi-sig contracts (#81)
- [M10–12] Performance and UX audit
- [M10–12] Invite flow (PR #67)
- [M10–12] Final summary report

### Andre

- [M1] Improve repository infrastructure — preprod environment and comprehensive smoke CI
- [M1] CI smoke tests on real chain (#213)
- [M1] Handle external PR — capability-based metadata (PR #208)
- [M2–3] Summon migration — land API routes and wallet import (PR #212, PR #208)
- [M2–3] Collateral service — 22 ADA → 4 UTxOs for proxy collateral (#221)
- [M2–3] Better 404 page (#22)
- [M4–6] Wallet V2 — on-chain registration and discovery (#33)
- [M4–6] Pending transactions on homepage (#125)
- [M4–6] Backlog cleanup, dependency/security updates
- [M7–9] Hardware wallet support — Ledger/Trezor (#44)
- [M7–9] Bot platform v2 — SDK, webhooks, example bots
- [M7–9] API documentation and developer portal
- [M10–12] User profiles and contacts
- [M10–12] Discover page — browse wallets, DAOs, governance (#52)
