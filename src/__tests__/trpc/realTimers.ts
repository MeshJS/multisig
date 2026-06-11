import { beforeEach } from "@jest/globals";

// The global setup (src/__tests__/setup.ts) freezes the clock with fake timers
// for unit-test determinism. The trpc tests are integration tests that hit a
// real Postgres and rely on real elapsed time (e.g. spacing inserts so
// createdAt ordering is deterministic), so restore real timers for them. This
// runs after setup.ts's beforeEach, overriding it.
beforeEach(() => {
  jest.useRealTimers();
});
