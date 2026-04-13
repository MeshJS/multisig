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
| Establish triage cadence for issues and PRs | Quirin + Andre | |
| Review repository health (CI/CD, dependencies, backlog) | Quirin | |
| **CI smoke tests on real chain** - Complete the preprod CI system | Andre | #213 |
| **Fix transaction loading bug** - API-added transactions break the page | Quirin | #211 |
| **Review and handle open external PRs** - Summon API routes and capability-based metadata from kanyuku | Quirin + Andre | PR #212, PR #208 |
| Address any critical bugs or blockers | Quirin + Andre | |

---

## Month 2 — June 2026

**Focus:** Core auth and migration work.

| Task | Owner | Issues |
|------|-------|--------|
| Maintain issue and PR responsiveness | Quirin + Andre | |
| **Improved authentication** - Nonce-based auth, wallet connection fixes, registration flow | Andre | #135, #53 |
| **Summon migration** - Land the Summon API routes + wallet import PRs | Quirin | PR #212, PR #208 |
| Resolve high-priority issues as they arise | Quirin + Andre | |
| Ensure documentation reflects current state | Quirin + Andre | |

---

## Month 3 — July 2026

**Focus:** Close out Q1, collateral service, minor fixes.

| Task | Owner | Issues |
|------|-------|--------|
| **Collateral service** - Users pay 22 ADA split into 4 UTxOs in a server-controlled wallet, released as collateral for proxy usage | Andre | #221 |
| **Full address verification** | Andre | #196 |
| **Transaction pagination** | Quirin | #30 |
| **Better 404 page** | Quirin | #22 |
| Address minor fixes or usability gaps | Quirin + Andre | |
| Provide brief progress/report update | Quirin + Andre | |

---

## Month 4 — August 2026

**Focus:** Begin governance and smart contract work.

| Task | Owner | Issues |
|------|-------|--------|
| Maintain repository stability and responsiveness | Quirin + Andre | |
| **Aiken crowdfund integration** - Begin landing the long-running PR | Quirin | PR #164 |
| **Governance metadata fix** - Hash mismatch when fetching metadata | Andre | #122 |
| Review backlog (labels, duplicates, stale) | Quirin + Andre | |
| Apply dependency or security updates | Quirin | |

---

## Month 5 — September 2026

**Focus:** Proxy voting and wallet registration.

| Task | Owner | Issues |
|------|-------|--------|
| Continue issue/PR management | Quirin + Andre | |
| **Aiken crowdfund integration** - Complete and merge | Quirin | PR #164 |
| **Proxy voting polish** - Complete and document the proxy voting system | Andre | |
| **Pending transactions on homepage** | Quirin | #125 |
| Address recurring or persistent issues | Quirin + Andre | |
| Maintain documentation accuracy | Quirin + Andre | |

---

## Month 6 — October 2026

**Focus:** Wallet V2, FROST research kickoff, midpoint report.

| Task | Owner | Issues |
|------|-------|--------|
| **Wallet V2 - Registration & discovery** - On-chain wallet registration, searchable directory | Quirin | #33 |
| **FROST research** - Begin investigating threshold Schnorr signatures for Cardano | Quirin | #220 |
| Address accumulated technical debt (as needed) | Andre | |
| Maintain triage cadence and repo activity | Quirin + Andre | |
| Provide midpoint status/report update | Quirin + Andre | |

---

## Month 7 — November 2026

**Focus:** Hardware wallets and bot platform.

| Task | Owner | Issues |
|------|-------|--------|
| **Hardware wallet support** - Begin Ledger/Trezor signing integration | Quirin | #44 |
| **Bot platform v2** - Documented bot SDK, webhook system, example bots | Andre | |
| Continued backlog management | Quirin + Andre | |
| Improve workflow/tooling inefficiencies | Quirin + Andre | |
| Support contributor interactions | Quirin + Andre | |

---

## Month 8 — December 2026

**Focus:** dApp connector and developer portal.

| Task | Owner | Issues |
|------|-------|--------|
| **Hardware wallet support** - Complete and merge | Quirin | #44 |
| **dApp connector** - Allow external dApps to request multi-sig transactions | Andre | |
| Maintain issue and PR throughput | Quirin + Andre | |
| Address documentation/onboarding friction | Quirin + Andre | |
| Ensure CI/CD and automation remain functional | Quirin | |

---

## Month 9 — January 2027

**Focus:** Developer portal, FROST wrap-up, progress report.

| Task | Owner | Issues |
|------|-------|--------|
| **API documentation & developer portal** - Expand Swagger docs, add guides, publish SDK | Quirin | |
| **FROST research** - Deliver findings, PoC if feasible, go/no-go recommendation | Quirin | #220 |
| Continued backlog management | Quirin + Andre | |
| Address minor fixes or usability gaps | Andre | |
| Provide brief progress/report update | Quirin + Andre | |

---

## Month 10 — February 2027

**Focus:** Vesting and discover page.

| Task | Owner | Issues |
|------|-------|--------|
| **Vesting feature** - Begin time-locked multi-sig vesting contracts | Quirin | #81 |
| **Discover page** - Browse public wallets, DAOs, and governance activity | Andre | #52 |
| Maintain repository health and responsiveness | Quirin + Andre | |
| Apply dependency or security updates | Quirin | |
| Continue contributor support and reviews | Quirin + Andre | |

---

## Month 11 — March 2027

**Focus:** User profiles, UX audit, polish.

| Task | Owner | Issues |
|------|-------|--------|
| **Vesting feature** - Complete and merge | Quirin | #81 |
| **User profiles & contacts** - Rich profiles, contact management, notification preferences | Quirin | |
| **Performance & UX audit** - Load times, mobile responsiveness, accessibility | Andre | |
| **Invite flow** - Land PR #67, polish wallet sharing/onboarding | Andre | PR #67 |
| Continue standard maintenance activities | Quirin + Andre | |
| Address any outstanding or aging issues | Quirin + Andre | |
| Maintain documentation and repo clarity | Quirin + Andre | |

---

## Month 12 — April 2027

**Focus:** Final report and sustainability review.

| Task | Owner | Issues |
|------|-------|--------|
| Deliver final summary report (activity, outcomes, gaps) | Quirin + Andre | |
| Review repository status and sustainability | Quirin + Andre | |
| Recommend next steps or ongoing needs | Quirin + Andre | |
| Address any remaining minor fixes | Quirin + Andre | |

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

**Milestones:**
- End of each quarter: tag a release, update CHANGELOG
- Mid-quarter check-in: are we on track? Adjust scope if needed

**GitHub milestones:** Created and issues assigned. View at [Milestones](../../milestones).
