import { shared, ESM_TESTS } from './jest.shared.mjs';

/**
 * ESM project — runs under `node --experimental-vm-modules`.
 * Covers only the files that use `jest.unstable_mockModule()` / `import.meta` /
 * ESM-only deps, which cannot run under the CJS project.
 *
 * @type {import('jest').Config}
 */
export default {
  ...shared,
  // Separate from the CJS project's cache — see the note in jest.config.mjs.
  cacheDirectory: '<rootDir>/node_modules/.cache/jest-esm',
  testMatch: ESM_TESTS.map((name) => `<rootDir>/src/__tests__/${name}.test.ts`),
};
