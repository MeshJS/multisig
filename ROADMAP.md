# 12-Month Roadmap: Mesh Multi-Sig Wallet

**Timeline:** May 2026 - April 2027  
**Team:** Quirin + Andre, part-time (~25 hrs/week combined), feature-based ownership  
**Approach:** Each quarter has a theme. Within each quarter, Quirin and Andre pick features independently. Every quarter includes a stability/testing slice alongside feature work.

---

## Q1: Foundation & Onboarding (May - July 2026)

**Theme:** Make the platform reliable and easy to adopt.

| # | Feature | Owner | Est. Effort | Issues |
|---|---------|-------|-------------|--------|
| 1 | **CI smoke tests on real chain** - Complete the preprod CI system | Quirin or Andre | 2 weeks | #213 |
| 2 | **Fix transaction loading bug** - API-added transactions break the page | Quirin or Andre | 1 week | #211 |
| 3 | **Improved authentication** - Nonce-based auth, wallet connection fixes, registration flow | Quirin or Andre | 4 weeks | #135, #53 |
| 4 | **Summon migration** - Land the Summon API routes + wallet import PRs | Quirin or Andre | 3 weeks | PR #212, PR #208 |
| 5 | **Full address verification** | Quirin or Andre | 1 week | #196 |
| 6 | **Transaction pagination** | Quirin or Andre | 1 week | #30 |
| 7 | **Better 404 page** | Quirin or Andre | 0.5 weeks | #22 |

**Quarter goal:** A new user can discover, create, and manage a multi-sig wallet with a stable, tested platform. Summon users can migrate.

---

## Q2: Governance & Smart Contracts (Aug - Oct 2026)

**Theme:** Deepen on-chain capabilities.

| # | Feature | Owner | Est. Effort | Issues |
|---|---------|-------|-------------|--------|
| 1 | **Aiken crowdfund integration** - Land the long-running PR #164 | Quirin or Andre | 4 weeks | PR #164 |
| 2 | **Governance metadata fix** - Hash mismatch when fetching metadata | Quirin or Andre | 1 week | #122 |
| 3 | **Proxy voting polish** - Complete and document the proxy voting system | Quirin or Andre | 3 weeks | |
| 4 | **Wallet V2 - Registration & discovery** - On-chain wallet registration, searchable directory | Quirin or Andre | 4 weeks | #33 |
| 5 | **Pending transactions on homepage** | Quirin or Andre | 1 week | #125 |

**Quarter goal:** Users can participate in governance end-to-end, use smart contract features (crowdfund), and discover wallets on-chain.

---

## Q3: Ecosystem & Integration (Nov 2026 - Jan 2027)

**Theme:** Open the platform to third parties and power users.

| # | Feature | Owner | Est. Effort | Issues |
|---|---------|-------|-------------|--------|
| 1 | **Hardware wallet support** - Ledger/Trezor signing integration | Quirin or Andre | 5 weeks | #44 |
| 2 | **Bot platform v2** - Documented bot SDK, webhook system, example bots | Quirin or Andre | 4 weeks | |
| 3 | **dApp connector** - Allow external dApps to request multi-sig transactions | Quirin or Andre | 3 weeks | |
| 4 | **API documentation & developer portal** - Expand Swagger docs, add guides, publish SDK | Quirin or Andre | 2 weeks | |

**Quarter goal:** Developers can build on the platform. Hardware wallet users are supported. Bot ecosystem is documented and accessible.

---

## Q4: Growth & Polish (Feb - Apr 2027)

**Theme:** User experience, scale, and community.

| # | Feature | Owner | Est. Effort | Issues |
|---|---------|-------|-------------|--------|
| 1 | **Vesting feature** - Time-locked multi-sig vesting contracts | Quirin or Andre | 5 weeks | #81 |
| 2 | **User profiles & contacts** - Rich profiles, contact management, notification preferences | Quirin or Andre | 3 weeks | |
| 3 | **Discover page** - Browse public wallets, DAOs, and governance activity | Quirin or Andre | 3 weeks | #52 |
| 4 | **Performance & UX audit** - Load times, mobile responsiveness, accessibility | Quirin or Andre | 2 weeks | |
| 5 | **Invite flow** - Land PR #67, polish wallet sharing/onboarding | Quirin or Andre | 1 week | PR #67 |

**Quarter goal:** The platform is polished, discoverable, and supports advanced treasury features like vesting.

---

## Cross-cutting (ongoing every quarter)

- **Testing:** Add tests alongside every feature (target: key flows have integration tests)
- **Deployment:** Maintain Railway + Vercel deployments, keep CI green
- **Security:** Rate limiting, input validation, auth hardening with each release
- **Documentation:** Update API docs and README as features ship
- **Bug triage:** Reserve ~10% of time for incoming bug reports

---

## How to work together

**Cadence:**
- Weekly 30-min sync to pick up / hand off features
- Each contributor owns 1-2 features per quarter end-to-end
- PRs reviewed by the other contributor before merge

**Feature ownership principles:**
- Claim features at quarter start based on interest/expertise
- "Quirin or Andre" labels mean either can take it - decide at weekly sync
- If one finishes early, pull from next quarter or tackle bugs

**Milestones:**
- End of each quarter: tag a release, update CHANGELOG
- Mid-quarter check-in: are we on track? Adjust scope if needed

**GitHub milestones:** Created and issues assigned. View at [Milestones](../../milestones).
