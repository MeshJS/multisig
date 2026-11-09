# Connected-wallet onboarding, resource access & responsive layouts

Status: Phase 1 implemented; authenticated E2E verification remains pending. Phases 2–6 are not implemented.

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
- Authenticated coverage is added in `e2e/tests/connected-resources.spec.ts`, but was not run because this session has no configured CI bootstrap context/signers. Run it with the existing E2E configuration before declaring signed-in exit criteria verified.
- ESLint is blocked by the existing flat-config/compat circular-structure error. Development-server checks encountered dependency compilation errors (Turbopack alias resolution and webpack React Refresh); production browser checks pass.
- The wallet runtime lifetime and authorization handlers are unchanged. The roadmap feature is not marked delivered.

## Phase 2 — Persistent Learn & Help navigation

Dependencies: Phase 1; the Getting Started destination ships with Phase 3 before release.

- [ ] Create shared resource metadata for the destinations in the route table, with consistent labels and grouping. Keep existing Governance navigation available.
- [ ] Replace or expand Resources into Learn & Help in the desktop sidebar, public shell, and mobile navigation. Include a visible About entry and a distinct My wallets destination.
- [ ] Ensure Learn & Help remains reachable on wallet detail pages, the empty wallet dashboard, and profile pages without opening a footer first.
- [ ] Make the complete mobile resource list scrollable within the menu when needed; verify the final items are reachable on short screens.
- [ ] Preserve active-link indication, accessible names, keyboard navigation, Escape dismissal, focus return, and menu closure after selecting a destination.
- [ ] Reuse canonical targets in the footer and preserve the existing prefetch policy for routes that load the wallet runtime.

Exit criteria: every resource in the route table has a working visible path on desktop and mobile for signed-out users, signed-in users without multisig wallets, and signed-in users with a selected wallet. Do not release a link to an unfinished Getting Started page.

## Phase 3 — Contextual, dismissible, reopenable onboarding

Dependencies: Phase 1; integrate with Phase 2 navigation.

- [ ] Add `/getting-started` with a short sequence: create or import a wallet; invite signers; review a first transaction. Present bots/AI automation and Documents as optional next steps.
- [ ] Reuse guide content in a compact dashboard onboarding panel. Make the panel dismissible without blocking wallet actions; keep Getting Started available from Learn & Help after dismissal.
- [ ] Store dismissal as a versioned, per-user browser preference, accessed after hydration and tolerant of unavailable storage. This proposal does not promise cross-device synchronization. Reset panel state on account changes so one user's dismissal does not hide another user's introduction.
- [ ] Keep the public guide readable while signed out; gate action links through existing wallet/auth flows. Do not mark steps complete from a link click alone or require a real transaction to finish the guide.
- [ ] Add contextual links in `homepage/wallets/EmptyWalletsState.tsx`, bot creation in `pages/user/BotManagementCard.tsx`, `pages/user/McpConnectionsCard.tsx`, and `pages/wallet/documents/`.
- [ ] Link Documents to relevant document setup instructions and `/verify`; use stable guide sections where no separate setup route exists.
- [ ] Make reopening deterministic: after dismissing, navigating away, and reloading, the guide still opens from Learn & Help. Provide an explicit way to show the compact panel again.

Exit criteria: a new user can find each core step, dismiss the panel, and reopen guidance; all four contextual entry points lead to useful instructions; existing users are not forced through a modal or setup wizard.

## Phase 4 — Overview and profile bot grant layouts

Dependencies: none for CSS changes; Phase 3 links should be included when validating profile layouts.

- [ ] Normalize `wallet/info/index.tsx` to an intentional full-width stack. Remove or contain conflicting child spans so no implicit second column is created.
- [ ] Audit conditional Overview cards, including migration, upgrade, proxy, backup, and notification cards. Where a child is shared elsewhere, change its layout API or wrapper without breaking other callers.
- [ ] Keep AI client activity and Contacts full-width and consistently aligned with surrounding cards. Test expanded activity details, existing contacts, long identifiers, loading, and empty states.
- [ ] Let bot management span the profile's available width. Stack wallet selector, role selector, and grant action when the card is narrow; use container-aware CSS or an equivalent intrinsic layout rather than viewport breakpoints alone.
- [ ] Remove fixed-width pressure where necessary and allow long wallet names to wrap or truncate with an accessible full label. Check existing grant rows, revoke controls, role descriptions, errors, and open selector menus.
- [ ] Preserve grant/revoke handlers, role semantics, disabled/loading states, and permission checks.

Exit criteria: Overview has no unintended columns; AI activity and Contacts remain readable; bot grant controls fit their card and remain usable at every required width, including 768px and 820px with the sidebar visible.

## Phase 5 — Task board density and Assets width

Dependencies: none; use the same containment conventions established in Phase 4.

- [ ] Replace the task board's unconditional `md:grid-cols-4` with a layout driven by available board width. Preferred approach: one, two, then four columns only when each has sufficient usable width, established with populated task cards.
- [ ] If preserving four adjacent workflow columns requires horizontal scrolling instead, implement a deliberate board-local scroll region with a usable minimum column width and keyboard/touch access. Record the chosen behavior and its test exception; never rely on clipped page overflow.
- [ ] Check long task titles, status columns, empty columns, selection checkboxes, action menus, payable task controls, payout summaries, and dialogs. Preserve board ordering and drag/drop behavior where supported; menus must remain an accessible way to perform existing actions.
- [ ] Replace the Assets page's multi-column wrapper with a full-width card layout. Wrap action groups and handle long asset labels/quantities within the card.
- [ ] Verify loading and empty states use the same width rules, so populated content does not introduce a layout jump or overflow.

Exit criteria: Tasks stays readable and operable at tablet widths with the sidebar present; Assets occupies the available content width and every action remains inside its card.

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

- [ ] Extend `e2e/tests/responsive-smoke.spec.ts` or add focused navigation/onboarding/layout specs using the existing authentication fixture and deterministic UI data. Provide an explicit no-wallet account state rather than depending on bootstrap data accidentally being empty.
- [ ] Keep tests off-chain: fixtures or mocked reads should populate the UI without signing or broadcasting transactions. Keep any test data isolated from real user data.
- [ ] Check document overflow **and** bounds within cards and `#main-content`. Scroll controls into view before measuring and detect clipping by intermediate ancestors, not just the viewport edge.
- [ ] Assert meaningful non-overlap between grant controls, task controls, and adjacent cards. Open menus/selectors and check they are reachable and unobscured; account for portalled overlays rather than incorrectly requiring them to fit inside the originating card.
- [ ] For any deliberate local scrolling, assert that its container stays within the content area and that offscreen controls can be brought into view and used.
- [ ] Capture representative before/after screenshots at phone, tablet, and desktop sizes; visually inspect them alongside boundary assertions.
- [ ] Run `npm run typecheck`, relevant unit tests, and focused Playwright specs via `npm run test:e2e -- <spec paths>` with the repository's required E2E environment prepared. Run the existing responsive smoke suite as regression coverage.
- [ ] Run the repository's applicable lint and build checks; verify lightweight public routes against `scripts/check-bundle-budget.mjs` using its documented invocation. If `npm run lint` is incompatible with the installed Next version, report that tooling issue and use the configured ESLint invocation rather than claiming a pass.
- [ ] Update linked documentation where routes changed, attach validation evidence to implementation PRs, and mark the roadmap/feature complete only after all acceptance gates pass.

Exit criteria: all feature-note acceptance criteria have passing evidence; any environment-blocked checks are explicitly recorded and resolved before marking delivery complete.

## Suggested delivery sequence

1. PR 1: Phase 1 routes, full MCP guide, compatibility handling, and focused route tests.
2. PR 2: Phases 2–3 together, so Learn & Help ships with a working Getting Started guide and contextual entry points.
3. PR 3: Phase 4 Overview and profile fixes with their populated responsive checks.
4. PR 4: Phase 5 Tasks and Assets fixes with their responsive checks.
5. PR 5, if needed: remaining Phase 6 matrix coverage and delivery documentation. Acceptance testing is required even if no separate PR is necessary.

Each PR should remain independently reviewable. Layout work can be developed independently of routing, but final acceptance must use the combined navigation shell because its sidebar changes available content width. If a phase regresses behavior, revert the affected change while retaining working resource destinations where possible.
