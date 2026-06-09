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
  testMatch: ESM_TESTS.map((name) => `<rootDir>/src/__tests__/${name}.test.ts`),
};
