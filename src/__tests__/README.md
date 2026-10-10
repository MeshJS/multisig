# Unit & Integration Tests

Jest tests for the multisig app live flat in this directory (plus `trpc/` and
`tx-builders/` subfolders). Playwright end-to-end specs live separately in
`e2e/` at the repo root.

## Three jest projects

The suite is mid-migration between two jest module systems, and the database
integration tests run separately again — so there are three configs, all built
from the shared base in `jest.shared.mjs`:

| Project | Config | What runs | How |
|---|---|---|---|
| CJS (default) | `jest.config.mjs` | Every test here except the ESM list and `trpc/` | plain `jest` |
| ESM | `jest.esm.config.mjs` | The files named in `ESM_TESTS` in `jest.shared.mjs` | `node --experimental-vm-modules …` |
| tRPC integration | `jest.trpc.config.mjs` | `trpc/*.test.ts` | needs a real Postgres (`DATABASE_URL`); every suite is gated with `HAVE_DB ? describe : describe.skip` |

A file is ESM-mode when it needs `jest.unstable_mockModule()` / `import.meta` /
ESM-only deps; CJS-mode when it uses hoisted `jest.mock()`. The two are mutually
exclusive per file — if you write a new test that needs ESM mocking, add its
basename to `ESM_TESTS` in `jest.shared.mjs`.

## Running

```bash
npm test              # scripts/run-tests.mjs → CJS project then ESM project
npm run test:cjs      # CJS project only (plain jest; accepts jest CLI args)
npm run test:esm      # ESM project only
npm run test:trpc     # trpc/ integration tests (skipped without DATABASE_URL)
npm run test:coverage # unit run with coverage
npm run test:ci       # CI mode (--ci --coverage --runInBand)
npm run test:bot      # bot API unit subset + botApi.integration.test.ts
npm run test:e2e      # Playwright (e2e/playwright.config.ts)
```

Note: `npm test -- <pattern>` passes the pattern to both projects; for quick
iteration on one file `npx jest <name>` (CJS files) is usually enough.

Lint is broken repo-wide — verify changes with `npm test` + `npm run typecheck`
+ `npm run build`, not `npm run lint`.

## Environment & mocks

- `setupEnv.cjs` (jest `setupFiles`) seeds dummy env vars before any module
  loads; `setup.ts` (`setupFilesAfterEnv`) holds global setup. The tRPC project
  additionally restores real timers via `trpc/realTimers.ts`.
- `@/env` is mapped by `moduleNameMapper` to `__mocks__/env.cjs` — a `Proxy`
  over `process.env`, so every key stays in sync with the real `src/env.js`
  automatically and tests can override values with `process.env.X = ...`.
  **Do not hand-roll `jest.mock("@/env", ...)` with a fixed key list** — it
  silently drops env keys the code under test reads.
- `testUtils.ts` provides shared fixtures: mock key hashes, real preprod test
  addresses, and `MultisigKey` builders.
- `trpc/fixtures.ts` seeds/cleans DB rows for the integration suite; if a
  router under test writes to a new table, extend `cleanupFixtures` too.

## Integration suites

- `trpc/` — router-level tests against a real Postgres. Run in their own CI
  workflow (`trpc-integration-tests.yml`), excluded from the unit run.
- `botApi.integration.test.ts` — bot HTTP API integration; `describe.skip`
  unless its integration env var is set.

## Adding tests

1. New CJS test: drop a `*.test.ts` file here — no config change needed.
2. Needs ESM-only mocking? Add the basename to `ESM_TESTS` in
   `jest.shared.mjs` so it moves to the ESM project.
3. Router + DB behavior? Put it in `trpc/` and follow the
   `seedWallet`/`cleanupFixtures` pattern.
4. Cover both success and failure paths; check coverage moved with
   `npm run test:coverage`. Note `collectCoverageFrom` excludes
   `src/pages/**`, `src/components/**/*.tsx`, `src/server/**`, and
   `src/lib/security/**` — code there is only covered when a test imports it
   directly, and it won't appear in the report.
