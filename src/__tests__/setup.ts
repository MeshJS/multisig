// Test setup file for Jest
import { jest, beforeEach, afterEach } from '@jest/globals';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Uncomment to ignore console.log in tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Global test timeout
jest.setTimeout(10000);

// Determinism: freeze the wall clock (`Date.now` / `new Date()`) so tests are
// byte-identical across runs. Timer APIs (setTimeout/setInterval/etc) stay
// real — many tests in this suite hit tRPC's timing middleware and other
// real-async paths that hang under faked timers. Tests that specifically
// exercise timer behavior can opt in via `jest.useFakeTimers()` in `beforeAll`.
beforeEach(() => {
  jest.useFakeTimers({
    now: new Date('2026-01-01T00:00:00Z'),
    doNotFake: [
      'nextTick',
      'setImmediate',
      'clearImmediate',
      'queueMicrotask',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'hrtime',
      'performance',
    ],
  });
});

afterEach(() => {
  jest.useRealTimers();
});
