# Connected-wallet resource acceptance

Feature: [Connected Wallet Onboarding & Resource Access](../vault/features/Connected%20Wallet%20Onboarding%20%26%20Resource%20Access.md). Implementation: [six-phase plan](connected-wallet-onboarding-resource-access-plan.md).

## Reproduce locally

Use the existing `.env` application configuration and `.env.playwright` signer configuration. A saved bootstrap context must contain legacy, hierarchical, and SDK wallet entries. No secrets are copied into artifacts or printed by the runner.

```powershell
npm.cmd run build
node node_modules/next/dist/bin/next start --port 3100
# In another terminal:
npm.cmd run test:resources -- --local
npm.cmd run typecheck
node scripts/check-bundle-budget.mjs
npm.cmd run lint
```

`--local` uses the app's local session secret and defaults to `ci-artifacts/ci-wallet-context.json`. It refuses a non-localhost APP_URL. Each local browser case uses a distinct loopback x-forwarded-for address so independent sessions do not exhaust a shared test-client rate limit; application rate limiting and session checks remain enabled. Remote runs do not set this header. Override APP_URL, CI_CONTEXT_PATH, or PLAYWRIGHT_CHROMIUM_EXECUTABLE as needed. Without `--local`, supply the usual authenticated E2E environment; the runner does not read the application secret. Installed Chrome on Windows is used if no executable override is given.

## Coverage

| Area | Evidence |
| --- | --- |
| Signed-out resources, legacy URLs, queries, history, public content | public-resources and learn-help suites |
| Empty and selected wallet journeys on desktop and touch | resource-acceptance suite visits all 13 resource destinations, reloads, uses Back/Forward, verifies cookies and rejects signing/reauthentication |
| Persistent navigation and contextual setup links | connected-resources and onboarding suites |
| Dismiss/reopen, storage failure, account isolation | onboarding suite |
| Overview and bot controls, empty/populated | overview-profile-layout at 375, 412, 768, 820, 1024, 1280, 1440px, height 900px |
| Assets and Tasks, empty/populated | tasks-assets-layout at those widths plus 1920px, height 900px |
| Controls and overlays | ancestor clipping, full card width, non-overlap, expanded activity, long identifiers, open selectors/menus, pending/error controls |
| Task behavior | selection, paid-task toggle, intercepted menu and drag moves, edit dialog, intercepted payout preview, keyboard focus in the locally scrollable recipient table |
| Existing mobile screens | responsive-smoke at 375x667 and 412x915, including transaction list, form, builder, and wallet connect |

The session fixture installs a valid test cookie and an injected CIP-30 wallet; it does not perform a real wallet sign-in handshake. Wallet/task/chain reads are deterministic. Task moves and payout previews in the layout suite are fully intercepted; no database mutations, confirmations, signing, or broadcasts occur. Backend signer authorization and live chain workflows are outside this UI acceptance evidence.

## Visual artifacts

`ci-artifacts/resource-acceptance-report/index.html` contains the authenticated report. Public results are under `ci-artifacts/resource-tests`. Layout screenshots live in `ci-artifacts/resource-acceptance`.

`*-after.png` shows the implemented layout. `*-before-css-reconstruction.png` applies the documented original grid rules to the same fixture temporarily, then removes them. These are controlled CSS comparisons, not historical deployment screenshots. They isolate the original Overview spans, profile grant pressure, four-column tablet board, and narrow Assets card. Phone, tablet, and desktop comparisons are captured alongside geometry assertions.

## Results (2026-11-11)

- 77 browser checks pass in the combined runner: 12 public and 65 authenticated-fixture/navigation/layout checks. All seven required widths pass with empty and populated data; 1920px also verifies the four-column board.
- Six representative visual cases were rerun after waiting for font/paint readiness and disabling capture-time animations. Their inspected comparison artifacts are under ci-artifacts/resource-acceptance-visual; this avoids capturing transient compositing frames.
- 77 focused unit tests, TypeScript, the production webpack build, bundle budgets, and git diff --check pass. Existing WebAssembly dependency warnings remain in the build.
- Lint remains unverified with the original setup: `next lint` is incompatible with the installed Next version, and invoking ESLint directly encounters the existing configuration error. A temporary configuration migration reported 224 errors across 128 files, but that migration was reverted at the maintainer's request. Those diagnostics are not a baseline result from the original configuration.
- The full-run rate-limit failure was traced to independent cases sharing one localhost IP. The local-only resource fixture now isolates that rate-limit key per case; the successful combined run retains real session authorization and production rate limiting.

## Delivery gate

The roadmap item is not marked delivered while lint verification remains blocked. The original lint command and ESLint configuration have been restored at the maintainer's request. Any tooling migration needs a separate explanation and review; this feature does not change the lint policy. Resolve how to run the approved lint setup before closing the overall acceptance gate.
