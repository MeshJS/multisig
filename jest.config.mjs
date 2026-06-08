/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts', '.tsx'],
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: [
    '**/__tests__/**/*.(test|spec).+(ts|tsx|js)',
    '**/*.(test|spec).+(ts|tsx|js)'
  ],
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      useESM: true,
      tsconfig: '<rootDir>/tsconfig.json',
    }],
  },
  moduleNameMapper: {
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
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/pages/**',
    '!src/components/**/*.tsx',
    '!src/**/*.stories.{ts,tsx}',
    '!src/__tests__/**',
  ],
  coverageProvider: 'v8',
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    'src/utils/stakingCertificates.ts': { lines: 90 },
    'src/lib/tx-builders/buildDRepCertTx.ts': { lines: 90 },
  },
  setupFiles: ['<rootDir>/src/__tests__/setupEnv.cjs'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  testTimeout: 10000,
  verbose: true,
};
