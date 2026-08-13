/**
 * Shared jest settings for both module modes.
 *
 * This suite is mid-migration between two jest module systems:
 *   - CJS files use `jest.mock()` (CommonJS hoisting) and run under plain jest.
 *   - ESM files use `jest.unstable_mockModule()` / `import.meta` / ESM-only deps
 *     and run under `--experimental-vm-modules`.
 * The two modes are mutually exclusive per file, so they run as separate jest
 * invocations (see jest.config.mjs for CJS and jest.esm.config.mjs for ESM),
 * both built from this shared base.
 *
 * ## Never pass `{ virtual: true }` to `jest.mock()` for a module that exists
 *
 * `transform` below matches TypeScript only, so **no transformer applies to
 * `.js` files** — including ESM-only packages in node_modules that
 * `transformIgnorePatterns` permits. `superjson` v2 is the live example:
 * `"type": "module"`, a single ESM export, no CommonJS build. Loading it in the
 * CJS project throws "Cannot use import statement outside a module", every
 * time, with no cache or ordering involved.
 *
 * CJS tests therefore depend on their mocks actually applying, so that the real
 * module (and its unloadable dependencies) is never reached. `virtual: true` is
 * for modules with *no file on disk*; used on a real one it registers the mock
 * under the bare specifier instead of the resolved path, and whether a given
 * importer gets the mock then varies with resolution order — which shifts with
 * test count and load. That was the cause of a ~1-in-8 intermittent failure in
 * walletIds.bot.test.ts, whose `@/server/api/root` mock would occasionally miss
 * and pull the real tRPC root, and superjson with it.
 *
 * `src/__tests__/jestMockHygiene.test.ts` fails the build if the pattern
 * returns.
 */
export const ESM_TESTS = [
  'apiSecurity',
  'botBallotsUpsert',
  'governanceActiveProposals',
  'mcpConnections',
  'og',
  'pendingTransactions',
  'reviewSignersCardKey',
  'signing',
  'signTransaction',
];

// trpc/* are database integration tests; they run in their own workflow
// (trpc-integration-tests.yml) against a real Postgres, not in the unit run.
export const INTEGRATION_GLOB = '<rootDir>/src/__tests__/trpc/';

export const shared = {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    // Stub `@/env` (ESM-only @t3-oss validator) before the general @/ alias.
    '^@/env$': '<rootDir>/src/__tests__/__mocks__/env.cjs',
    '^@/(.*)$': '<rootDir>/src/$1',
    // libsodium-wrappers-sumo ships an .mjs that does `import "./libsodium-sumo.mjs"`,
    // but that file lives in the separate `libsodium-sumo` package. Node resolves it
    // via package.json exports; Jest's ESM resolver does not. Redirect.
    '^\\./libsodium-sumo\\.mjs$': '<rootDir>/node_modules/libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs',
    '\\.(css|less|scss|sass)$': '<rootDir>/src/__tests__/__mocks__/styleMock.cjs',
  },
  transformIgnorePatterns: [
    '/node_modules/(?!(superjson|copy-anything|is-what|@trpc|@meshsdk|@noble|@sidan-lab|nanoid|jose|uuid)/)',
  ],
  setupFiles: ['<rootDir>/src/__tests__/setupEnv.cjs'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 10000,
  verbose: true,
};
