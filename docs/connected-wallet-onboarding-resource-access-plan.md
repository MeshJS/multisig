# Connected-wallet onboarding, resource access & responsive layouts

Status: Phases 1-5 implemented. Phase 6 acceptance tooling and checks implemented; final delivery remains blocked by lint tooling verification. Authenticated UI coverage uses deterministic wallet reads.

Source: [feature note](../vault/features/Connected%20Wallet%20Onboarding%20%26%20Resource%20Access.md) and the November 2026 entry in [ROADMAP.md](../ROADMAP.md). Owner in the feature note: Andre. Plan prepared 2026-11-09.

## Outcome and scope

Make learning resources accessible before and after wallet sign-in, provide dismissible and reopenable onboarding, and fix the four documented layout problems across phone, tablet, and desktop sizes. Preserve wallet connections during navigation and existing authorization on actions.

This is a navigation, documentation, onboarding, and layout change. No database migration, new API permission, signing behavior, or transaction workflow redesign is planned. Implementation PRs should cite the feature note; it currently has no PRD identifier to cite.

## Current implementation evidence

| Area | Current implementation | Implementation implication |
| --- | --- | --- |
| Landing/dashboard | `src/pages/index.tsx` switches between `PageHomepage` and `PageWallets`; `/wallets` already exists | Add a stable landing destination and use the existing wallet-list route |
| Navigation | Desktop resources are in `overall-layout/menus/wallets.tsx`; mobile resources are in `ui/mobile-navigation.tsx`; footer has additional links | Share resource definitions across both navigation surfaces and update footer targets |
| Public rendering | `src/data/public-routes.ts`, `src/lib/wallet-runtime.ts`, and `src/pages/_app.tsx` distinguish public access from lightweight rendering | Register new guidance routes appropriately without remounting the active wallet runtime |
| MCP guide | Full guide is inside `src/components/pages/homepage/index.tsx`, under `#connect-mcp` | Extract reusable documentation content and retain fragment compatibility |
| Overview | `wallet/info/index.tsx` declares one column while several children declare `col-span-2` | Fix the parent/child layout contract, including conditional cards |
| Assets | `wallet/assets/index.tsx` allocates two/three columns to one card | Use the available content width and wrap actions |
| Bot grants | `src/pages/user/index.tsx` uses two columns; `BotManagementCard.tsx` uses a fixed 140px role column | Give bot management sufficient width and adapt controls to card width |
| Tasks | `wallet/tasks/board.tsx` enables four columns at `md` | Choose columns using available board width, accounting for the sidebar |
| Verification | `e2e/tests/responsive-smoke.spec.ts` covers 375px and 412px; most checks only measure document overflow | Add populated fixtures, tablet widths, and element-boundary checks |

Component paths abbreviated above are relative to `src/components/` unless otherwise specified.

## Proposed route and navigation contract

Use these defaults during implementation; any changes must retain all resource destinations and legacy-link behavior.

| Visible destination | Canonical URL | Notes |
| --- | --- | --- |
| About / landing | `/about` | Same landing content whether signed in or signed out |
| My wallets | `/wallets` | Distinct from the landing page; retain current action authorization |
| Getting Started | `/getting-started` | Public, reopenable guide and source for contextual onboarding |
| Features | `/features` | Existing route |
| MCP setup | `/docs/mcp` | Full standalone guide |
| Developers & Bots | `/about#developers-and-bots` | Stable developer overview, linking to bot and API guides |
| Bot Setup | `/bot-setup` | Existing route |
| API Docs | `/api-docs` | Existing route |
| DApps integration | `/dapps` | Global resource entry; retain selected-wallet DApps navigation |
| Document verification | `/verify` | Public verification; distinguish from private Documents |
| Blog | `/blog` | Existing route |
| Roadmap | `/roadmap` | Existing route |
| Feature graph | `/roadmap/graph` | Existing route |
| Sign-off demo | `/vault` | Existing public demo; distinguish from private document storage |

Keep `/` behavior for ordinary visits to minimize disruption: landing when signed out, dashboard when signed in. Map `/#connect-mcp` to `/docs/mcp` and `/#developers-and-bots` to `/about#developers-and-bots` in either state. Also retain `/about#connect-mcp` as a working entry to MCP setup. URL fragments are unavailable to server redirects, so compatibility requires client-side fragment handling or an equivalent rendered anchor strategy. Handle initial loads and later hash navigation, including browser Back/Forward, without redirect loops or lost query parameters.

## Phase 1 — Stable public destinations and legacy links

Dependencies: none.

- [x] Add `/about` using the existing landing component without depending on the signed-in dashboard switch.
- [x] Extract the full MCP guide into a reusable documentation component and add `/docs/mcp`. Keep a concise landing entry that points to the full guide.
- [x] Implement the fragment compatibility contract above. Scroll to the intended section inside the actual app scroll container after content is ready.
- [x] Add new routes to public-route configuration; classify them as lightweight only when they render without wallet context or Cardano imports. Add appropriate route metadata in `src/lib/seo.ts` and check relevant sitemap handling.
- [x] Update landing, API Docs, Connected AI clients, footer, and other discovered MCP/developer links to canonical destinations. Search the repository for both old fragments to distinguish intentional compatibility coverage from stale links.
- [x] Reconcile MCP copy against `src/pages/api/mcp/README.md`, `src/pages/api/oauth/README.md`, and the implemented tool surface. The related vault MCP note predates unsigned transaction drafts; do not repeat its older capability summary as the current contract. Retain the no-signing/no-broadcasting boundary.
- [x] Preserve `_app.tsx` runtime lifetime and client-side navigation so visiting guidance does not disconnect the wallet or trigger another signature request.

Exit criteria: `/about` and the complete MCP guide render in both connection states; legacy fragment links reach their intended content on direct load and client navigation; returning to a selected wallet preserves the connection.

### Phase 1 validation (2026-11-09)

- TypeScript passes; 71 focused tests pass across resource links, wallet runtime policy, MCP tool metadata, and SEO fallback.
- Production webpack build and bundle budgets pass. Both new routes are below their 350 KB gzipped first-load limit. The build reports existing dependency WebAssembly warnings.
- Six public browser checks pass at 375px and 1280px against the production build: legacy fragment migration, query preservation, section positioning, ordinary root visits, native hash changes, reloads, and Back/Forward navigation.
- Public checks run without chain fixtures: `node node_modules/@playwright/test/cli.js test --config=e2e/public-resources.config.ts`. Point `APP_URL` at a running production build; set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` if using a locally installed browser.
- Authenticated coverage was added in `e2e/tests/connected-resources.spec.ts`. It was initially pending environment setup and subsequently passed during Phase 2 validation (see below).
- ESLint is blocked by the existing flat-config/compat circular-structure error. Development-server checks encountered dependency compilation errors (Turbopack alias resolution and webpack React Refresh); production browser checks pass.
- The wallet runtime lifetime and authorization handlers are unchanged. The roadmap feature is not marked delivered.

## Phase 2 — Persistent Learn & Help navigation

Dependencies: Phase 1. The public Getting Started guide was brought forward from Phase 3 so every menu destination works immediately.

- [x] Create shared resource metadata for the destinations in the route table, with consistent labels and grouping. Keep existing Governance navigation available.
- [x] Replace or expand Resources into Learn & Help in the desktop sidebar, public shell, and mobile navigation. Include a visible About entry and a distinct My wallets destination.
- [x] Ensure Learn & Help remains reachable on wallet detail pages, the empty wallet dashboard, and profile pages without opening a footer first.
- [x] Make the complete mobile resource list scrollable within the menu when needed; verify the final items are reachable on short screens.
- [x] Preserve active-link indication, accessible names, keyboard navigation, Escape dismissal, focus return, and menu closure after selecting a destination.
- [x] Reuse canonical targets in the footer and preserve the existing prefetch policy for routes that load the wallet runtime.

Exit criteria: every resource in the route table has a working visible path on desktop and mobile for signed-out users, signed-in users without multisig wallets, and signed-in users with a selected wallet. Do not release a link to an unfinished Getting Started page.

### Phase 2 implementation and validation (2026-11-10)

- `src/data/learn-help.ts` owns labels, canonical URLs, grouping, and active-resource matching. Desktop and mobile share the sidebar menu; the sidebar-free landing page has a keyboard-accessible desktop dropdown. Mobile navigation now remains available on the landing page too.
- My wallets points to `/wallets`; Governance remains available. The footer reuses the resource catalogue. Heavy wallet routes retain disabled prefetching.
- Mobile content now has a bounded, scrollable flex area. Opening the wallet selector no longer dismisses the drawer; selecting a link or finishing navigation closes it.
- `/getting-started` is a public, lightweight page with create/import, signer invitation, transaction review, and optional automation/document guidance. It is registered for SEO, the sitemap, and bundle budgets. The dismissible dashboard panel and contextual prompts remain Phase 3 work.
- TypeScript, the production webpack build, bundle budgets, 21 focused unit tests, and 18 production browser checks pass. Public browser coverage includes desktop navigation, all destination responses, active states, short-screen scrolling at 375px and 412px, keyboard navigation/dismissal/focus return, menu closure, and Phase 1 legacy-link regressions.
- Seven authenticated browser tests pass: empty wallet lists, selected wallets, and profiles at 375px and 1280px, plus returning to a selected wallet through browser history with the same session and no new authorization request. These exercise the real authentication fixture and app providers with deterministic wallet-read responses; they do not test database signer authorization or transaction writes.
- The saved bootstrap context was located at `ci-artifacts/ci-wallet-context.json`. Its wallet IDs are stale in the local database, so the navigation fixture supplies wallet records and asserts their actual heading rather than a generic Signers label. The run uses `.env.playwright`, overrides `CI_CONTEXT_PATH` to that file, points `APP_URL` to the local production server, and matches `CI_JWT_SECRET` to the local app's session secret. No secrets or environment files were changed.
- ESLint still stops in the repository configuration with a circular-structure error before checking files.

## Phase 3 — Contextual, dismissible, reopenable onboarding

Dependencies: Phase 1; integrate with Phase 2 navigation.

- [x] Add `/getting-started` with a short sequence: create or import a wallet; invite signers; review a first transaction. Present bots/AI automation and Documents as optional next steps. (Brought forward into Phase 2.)
- [x] Reuse guide content in a compact dashboard onboarding panel. Make the panel dismissible without blocking wallet actions; keep Getting Started available from Learn & Help after dismissal.
- [x] Store dismissal as a versioned, per-user browser preference, accessed after hydration and tolerant of unavailable storage. This proposal does not promise cross-device synchronization. Reset panel state on account changes so one user's dismissal does not hide another user's introduction.
- [x] Keep the public guide readable while signed out; gate action links through existing wallet/auth flows. Do not mark steps complete from a link click alone or require a real transaction to finish the guide.
- [x] Add contextual links in `homepage/wallets/EmptyWalletsState.tsx`, bot creation in `pages/user/BotManagementCard.tsx`, `pages/user/McpConnectionsCard.tsx`, and `pages/wallet/documents/`.
- [x] Link Documents to relevant document setup instructions and `/verify`; use stable guide sections where no separate setup route exists.
- [x] Make reopening deterministic: after dismissing, navigating away, and reloading, the guide still opens from Learn & Help. Provide an explicit way to show the compact panel again.

Exit criteria: a new user can find each core step, dismiss the panel, and reopen guidance; all four contextual entry points lead to useful instructions; existing users are not forced through a modal or setup wizard.

### Phase 3 implementation and validation (2026-11-10)

- The full Getting Started guide and compact dashboard panel share content from `src/data/getting-started.ts`. The panel appears on authorized wallet dashboards, can be dismissed without blocking actions, and keeps a visible Show control. No steps are marked complete by clicking links.
- Dismissal is saved under a versioned, wallet-identity-specific browser key. Storage is read after hydration; account changes cannot reuse another identity's visible state. If storage is unavailable, dismissal/reopening still works for the current page lifetime.
- Getting Started remains available through Learn & Help. Its Show guide on My wallets button restores the panel and returns to the dashboard. Guide section links scroll within the app content container, including after runtime restoration.
- Added contextual links in the empty wallet dashboard, bot management and its claim dialog, and Documents. The existing Connected AI clients MCP guide link is retained and tested. Documents links both to its setup section and to public proof verification.
- TypeScript, the production webpack build, bundle budgets, 24 focused unit tests, and 24 browser checks pass. The browser suites cover phone/desktop dismissal, reload persistence, reopening from Learn & Help, identity isolation, blocked storage, contextual links, signed-out guidance, and Phase 1-2 regressions.
- Authenticated tests reuse the deterministic wallet-read fixture in `e2e/helpers/navigationWallet.ts` with the real app providers and session fixture. Run `onboarding.spec.ts` and `connected-resources.spec.ts` using the authenticated setup recorded under Phase 2; public checks use `e2e/public-resources.config.ts`. These checks do not sign or broadcast transactions.
- ESLint remains blocked by the existing circular-structure error in repository configuration; the production build reports existing WebAssembly dependency warnings. No backend authorization, database schema, or transaction handlers changed.

## Phase 4 — Overview and profile bot grant layouts

Dependencies: none for CSS changes; Phase 3 links should be included when validating profile layouts.

- [x] Normalize `wallet/info/index.tsx` to an intentional full-width stack. Remove or contain conflicting child spans so no implicit second column is created.
- [x] Audit conditional Overview cards, including migration, upgrade, proxy, backup, and notification cards. Where a child is shared elsewhere, change its layout API or wrapper without breaking other callers.
- [x] Keep AI client activity and Contacts full-width and consistently aligned with surrounding cards. Test expanded activity details, existing contacts, long identifiers, loading, and empty states.
- [x] Let bot management span the profile's available width. Stack wallet selector, role selector, and grant action when the card is narrow; use container-aware CSS or an equivalent intrinsic layout rather than viewport breakpoints alone.
- [x] Remove fixed-width pressure where necessary and allow long wallet names to wrap or truncate with an accessible full label. Check existing grant rows, revoke controls, role descriptions, errors, and open selector menus.
- [x] Preserve grant/revoke handlers, role semantics, disabled/loading states, and permission checks.

Exit criteria: Overview has no unintended columns; AI activity and Contacts remain readable; bot grant controls fit their card and remain usable at every required width, including 768px and 820px with the sidebar visible.

### Phase 4 implementation and validation (2026-11-10)

- Overview now uses a full-width flex stack. Existing grid spans on shared cards have no effect in this parent, so migration (including its nested progress/step wrapper), transfer, registration, staking/governance upgrades, proxy, notification, backup, and archive cards cannot create implicit columns. Shared components retain their existing layout contracts elsewhere; conditional rendering and action handlers are unchanged.
- AI activity details wrap long tool identifiers and badges, and the expansion button exposes its state. Contacts wrap long names/descriptions and their header actions; edit/delete buttons have accessible names.
- Bot management spans both profile columns. Grant controls use intrinsic flex bases and wrapping based on available card width, without a fixed role column or viewport breakpoint. Existing grant rows and bot headers wrap; wallet choices wrap inside a trigger-width menu and the truncated trigger exposes the full name. Grant/revoke handlers, eligibility rules, and pending/disabled behavior are unchanged.
- TypeScript, production webpack build, bundle budgets, four existing bot unit tests, and 19 focused browser checks pass: 14 empty/populated Overview/profile cases at 375, 412, 768, 820, 1024, 1280, and 1440px (900px height), two loading/eligibility/error cases, and three profile navigation/contextual-guide regressions.
- Browser assertions verify full-width stacked card bounds, intermediate clipping ancestors, grant-control non-overlap, long identifiers, expanded activity, contacts, existing grants, portalled wallet/role menus, and eligible/ineligible cosigner options. Pending/error UI uses a fully intercepted grant mutation; no actual grant, revoke, signing, or broadcast is performed. These tests use deterministic UI reads and do not validate backend authorization or on-chain migration/upgrade workflows.
- Representative phone, tablet, and desktop screenshots were captured under the ignored ci-artifacts/phase4-tests directory and visually inspected. The local fixture can show a proxy initialization error because it does not supply a live proxy contract; proxy workflow testing remains outside these layout checks.
- Run e2e/tests/overview-profile-layout.spec.ts with the authenticated environment described under Phase 2. ESLint still fails before checking files with the existing circular configuration error; the build retains existing dependency WebAssembly warnings. The feature remains undelivered until Phases 5-6 are complete.

## Phase 5 — Task board density and Assets width

Dependencies: none; use the same containment conventions established in Phase 4.

- [x] Replace the task board's unconditional `md:grid-cols-4` with a layout driven by available board width. Preferred approach: one, two, then four columns only when each has sufficient usable width, established with populated task cards.
- [x] Not needed: the board uses a wrapping grid. If preserving four adjacent workflow columns requires horizontal scrolling instead, implement a deliberate board-local scroll region with a usable minimum column width and keyboard/touch access. Record the chosen behavior and its test exception; never rely on clipped page overflow.
- [x] Check long task titles, status columns, empty columns, selection checkboxes, action menus, payable task controls, payout summaries, and dialogs. Preserve board ordering and drag/drop behavior where supported; menus must remain an accessible way to perform existing actions.
- [x] Replace the Assets page's multi-column wrapper with a full-width card layout. Wrap action groups and handle long asset labels/quantities within the card.
- [x] Verify loading and empty states use the same width rules, so populated content does not introduce a layout jump or overflow.

Exit criteria: Tasks stays readable and operable at tablet widths with the sidebar present; Assets occupies the available content width and every action remains inside its card.

### Phase 5 implementation and validation (2026-11-11)

- The task board uses CSS container queries: one column below 34rem of board width, two from 34rem, and four from 68rem. These thresholds leave at least 16rem per column after gaps and account for the sidebar and card padding. No board-level horizontal scrolling is introduced; column order and existing drag/drop and menu handlers are preserved.
- Task titles, descriptions, totals, payout badges, and selection-header controls fit their containers. Payout selection and review wrap long asset amounts and recipient labels. Explicit single-column dialog grids prevent long values from creating oversized implicit tracks; the existing recipient table retains its deliberate local scrolling.
- Assets uses one full-width card within the standard max-width wallet content area. Actions, quantities, and tickers wrap, while truncated asset names retain their full title. Empty and pending-balance states use the same card width.
- TypeScript, the production webpack build, bundle budgets, and 24 task-board/recipient/payout-state unit tests pass. The build retains existing WebAssembly dependency warnings. ESLint still stops before checking files because of the existing circular configuration error.
- All 19 focused browser checks pass: empty and populated Tasks/Assets at 375, 412, 768, 820, 1024, 1280, 1440, and 1920px (900px height), plus drag/drop at 1280x1000 and loading-state checks at 820x900. The extra wide viewport exercises four columns; tablet layouts retain a readable single column with the sidebar visible.
- Coverage includes long labels and amounts, empty columns, payable selection, paid-task controls, control non-overlap, intermediate clipping ancestors, asset actions, open task menus, menu moves, edit dialogs, payout selection and review summaries, and stable Assets width while balances load. The tests use real session/providers with deterministic wallet, task, and chain reads; moves and payout previews are intercepted. No database task changes, payout confirmations, signatures, or broadcasts are performed.
- Representative phone/tablet/desktop screenshots are saved under the ignored ci-artifacts/phase5-final-tests directory and visually inspected. Run e2e/tests/tasks-assets-layout.spec.ts with the authenticated environment described under Phase 2. Phase 6 and the overall roadmap acceptance gate remain open.

## Phase 6 — Acceptance verification and delivery

Dependencies: Phases 1–5. Add regression coverage alongside each phase rather than postponing all testing to this phase.

### Navigation matrix

Run all three states on desktop and mobile navigation:

| State | Required checks |
| --- | --- |
| Signed out | About, Getting Started, MCP guide, and every Learn & Help resource work without authentication; protected actions retain their existing gates |
| Signed in, no multisig wallets | Landing remains reachable, contextual onboarding appears, guidance navigation preserves connection, dismissal/reopening works |
| Signed in, selected multisig wallet | Learn & Help remains reachable, return to the selected wallet works, connection and identity remain intact |

In each applicable state, exercise direct URLs, ordinary clicks, legacy fragments, browser Back/Forward, and refresh. Confirm no unexpected reconnect or signature prompt. Include desktop keyboard and mobile touch interaction.

### Responsive matrix

Test Overview, Assets, profile bot grants, and Tasks at **375, 412, 768, 820, 1024, 1280, and 1440px**, each with **empty and populated states**. Record viewport heights as well as widths so short-screen menu reachability is reproducible.

Populated fixtures must include expanded AI activity, existing contacts, long wallet/asset/task labels, existing bot grants, open wallet/role selectors, task selection, payable task controls, and open action menus. Prioritize Overview, bot grants, and Tasks, followed by Assets.

- [x] Extend `e2e/tests/responsive-smoke.spec.ts` or add focused navigation/onboarding/layout specs using the existing authentication fixture and deterministic UI data. Provide an explicit no-wallet account state rather than depending on bootstrap data accidentally being empty.
- [x] Keep tests off-chain: fixtures or mocked reads should populate the UI without signing or broadcasting transactions. Keep any test data isolated from real user data.
- [x] Check document overflow **and** bounds within cards and `#main-content`. Scroll controls into view before measuring and detect clipping by intermediate ancestors, not just the viewport edge.
- [x] Assert meaningful non-overlap between grant controls, task controls, and adjacent cards. Open menus/selectors and check they are reachable and unobscured; account for portalled overlays rather than incorrectly requiring them to fit inside the originating card.
- [x] For any deliberate local scrolling, assert that its container stays within the content area and that offscreen controls can be brought into view and used.
- [x] Capture representative before/after screenshots at phone, tablet, and desktop sizes; visually inspect them alongside boundary assertions.
- [x] Run `npm run typecheck`, relevant unit tests, and focused Playwright specs via `npm run test:e2e -- <spec paths>` with the repository's required E2E environment prepared. Run the existing responsive smoke suite as regression coverage.
- [x] Run the repository's applicable lint and build checks; verify lightweight public routes against `scripts/check-bundle-budget.mjs` using its documented invocation. If `npm run lint` is incompatible with the installed Next version, report that tooling issue and use the configured ESLint invocation rather than claiming a pass.
- [ ] Final delivery gate: documentation and reproducible evidence are linked below, but the roadmap/feature must remain open until lint can be verified with the approved setup. No PR was created or published in this task.

Exit criteria: all feature-note acceptance criteria have passing evidence; any environment-blocked checks are explicitly recorded and resolved before marking delivery complete.

### Phase 6 acceptance work (2026-11-11)

- Added a complete desktop/touch resource-journey matrix for signed-out, empty-wallet, and selected-wallet users. It follows every resource entry, checks Back/Forward and refresh, verifies a legacy fragment migration and return to the starting screen, preserves the session cookie, and fails on signing or reauthentication calls.
- Updated the existing responsive smoke suite to use deterministic wallet reads instead of stale bootstrap database IDs. Its wallet-detail check asserts the actual fixture wallet heading to avoid passing against unrelated landing content.
- Added keyboard focus/bounds checks for the task editor's deliberately scrollable recipient table. Layout screenshots now include controlled pre-fix CSS reconstructions and implemented layouts; reconstruction filenames explicitly distinguish these from historical deployment screenshots.
- Added npm run test:resources -- --local and a [reproduction/evidence guide](connected-wallet-resource-acceptance.md). The runner executes both the public and authenticated resource/layout suites without on-chain writes.
- The temporary lint configuration migration was reverted at the maintainer's request. The original `next lint` command and ESLint configuration are preserved. Lint remains blocked by the existing tooling incompatibility. The 224 diagnostics observed under the temporary configuration are historical findings, not a baseline result under the restored configuration. Any migration requires separate explanation and review.
- Corrected the onboarding callback declaration to be safely destructured and changed the AI-activity profile link to client navigation. TypeScript, the production build, bundle budgets, and 77 focused unit tests pass. The build retains existing dependency WebAssembly warnings.
- The combined runner passes all 77 browser checks (12 public, 65 authenticated-fixture checks); six representative screenshot cases also pass after capture stabilization. The local fixture isolates client IPs per case to avoid unrelated tests exhausting the same production rate-limit bucket. Final artifact locations are recorded in the evidence guide. The feature remains in progress because the plan explicitly requires resolving blocked checks before delivery; verification with the approved lint setup is outstanding.

## Suggested delivery sequence

1. PR 1: Phase 1 routes, full MCP guide, compatibility handling, and focused route tests.
2. PR 2: Phases 2–3 together, so Learn & Help ships with a working Getting Started guide and contextual entry points.
3. PR 3: Phase 4 Overview and profile fixes with their populated responsive checks.
4. PR 4: Phase 5 Tasks and Assets fixes with their responsive checks.
5. PR 5, if needed: remaining Phase 6 matrix coverage and delivery documentation. Acceptance testing is required even if no separate PR is necessary.

Each PR should remain independently reviewable. Layout work can be developed independently of routing, but final acceptance must use the combined navigation shell because its sidebar changes available content width. If a phase regresses behavior, revert the affected change while retaining working resource destinations where possible.
