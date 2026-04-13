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
