import { shared } from './jest.shared.mjs';

/**
 * tRPC integration tests — run via `test:trpc` against a real Postgres (their
 * own CI workflow). They are excluded from the default unit run, so this config
 * opts them back in and restores real timers (realTimers.ts) on top of the
 * global fake-timer setup.
 *
 * @type {import('jest').Config}
 */
export default {
  ...shared,
  testMatch: ['<rootDir>/src/__tests__/trpc/**/*.(test|spec).+(ts|tsx)'],
  setupFilesAfterEnv: [
    ...shared.setupFilesAfterEnv,
    '<rootDir>/src/__tests__/trpc/realTimers.ts',
  ],
};
