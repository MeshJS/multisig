import { shared, ESM_TESTS, INTEGRATION_GLOB } from './jest.shared.mjs';

/**
 * CJS project — runs under plain `jest` (no --experimental-vm-modules).
 * Covers every test except the ESM-mode files (run via jest.esm.config.mjs) and
 * the trpc/* database integration tests (run in their own workflow).
 *
 * @type {import('jest').Config}
 */
export default {
  ...shared,
  testMatch: [
    '**/__tests__/**/*.(test|spec).+(ts|tsx|js)',
    '**/*.(test|spec).+(ts|tsx|js)',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    INTEGRATION_GLOB,
    // Exclude the ESM-mode files (run separately). Anchored to /src/__tests__/
    // so e.g. `pendingTransactions` does not also match trpc/pendingTransactions.
    ...ESM_TESTS.map((name) => `<rootDir>/src/__tests__/${name}\\.test\\.ts$`),
  ],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/pages/**',
    '!src/components/**/*.tsx',
    '!src/**/*.stories.{ts,tsx}',
    '!src/__tests__/**',
    // Some modules have import-time side effects (db.ts eagerly builds the
    // Prisma client + pg adapter; the rate-limit module keeps a process-global
    // store). jest force-loads collectCoverageFrom files that no test imported,
    // and under v8 coverage that load pollutes global state and breaks tests
    // which mock these modules (e.g. freeUtxos). Exclude them from collection —
    // they are still covered when a test imports them directly.
    '!src/server/**',
    '!src/lib/security/**',
  ],
  coverageProvider: 'v8',
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
};
