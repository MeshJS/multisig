import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest } from "next";
import { createMockResponse, makeApiRequest } from "./apiTestUtils";

/**
 * The scheduler-only notification endpoints. The GitHub workflows call them
 * with the drain secret as a bearer; these specs pin down that only that exact
 * secret gets in, that guessing is rate limited, and that the 503 the
 * workflows treat as "not configured, skip" still comes back unchanged.
 */

const SECRET = "drain-secret-0123456789abcdef";

const mockEnv: { NOTIFICATION_DRAIN_SECRET?: string } = {
  NOTIFICATION_DRAIN_SECRET: SECRET,
};
jest.mock("@/env", () => ({ __esModule: true, env: mockEnv }));

jest.mock("@/server/db", () => ({ __esModule: true, db: {} }));

const drainNotificationOutbox = jest.fn<(...args: unknown[]) => Promise<unknown[]>>();
jest.mock("@/lib/notifications/worker", () => ({
  __esModule: true,
  drainNotificationOutbox,
}));

const enqueueBallotDeadlineReminders = jest.fn<(...args: unknown[]) => Promise<{ remindersEnqueued: number }>>();
jest.mock("@/lib/notifications/ballotDeadlines", () => ({
  __esModule: true,
  enqueueBallotDeadlineReminders,
}));

const notificationsEmailEnabled = jest.fn<() => boolean>();
jest.mock("@/lib/notifications/center", () => ({
  __esModule: true,
  notificationsEmailEnabled,
}));

import { bearerMatchesSecret } from "@/lib/notifications/schedulerAuth";
import drain from "@/pages/api/notifications/drain";
import ballotDeadlines from "@/pages/api/notifications/ballot-deadlines";

let ipCounter = 0;
/** A fresh client IP per request unless one is given, so limits don't leak between specs. */
function request(overrides: Partial<NextApiRequest> & { ip?: string } = {}): NextApiRequest {
  const { ip, headers, ...rest } = overrides;
  return makeApiRequest({
    method: "POST",
    query: {},
    headers: {
      "x-forwarded-for": ip ?? `198.51.100.${++ipCounter % 250}`,
      ...headers,
    },
    ...rest,
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

beforeEach(() => {
  mockEnv.NOTIFICATION_DRAIN_SECRET = SECRET;
  drainNotificationOutbox.mockReset().mockResolvedValue([{}, {}]);
  enqueueBallotDeadlineReminders.mockReset().mockResolvedValue({ remindersEnqueued: 0 });
  notificationsEmailEnabled.mockReset().mockReturnValue(true);
});

describe("bearerMatchesSecret", () => {
  it("accepts exactly the secret as a Bearer token", () => {
    expect(bearerMatchesSecret(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong token, including a prefix or extension of the secret", () => {
    expect(bearerMatchesSecret("Bearer nope", SECRET)).toBe(false);
    expect(bearerMatchesSecret(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
    expect(bearerMatchesSecret(`Bearer ${SECRET}x`, SECRET)).toBe(false);
  });

  it("rejects a missing, empty, non-Bearer or repeated header without throwing", () => {
    expect(bearerMatchesSecret(undefined, SECRET)).toBe(false);
    expect(bearerMatchesSecret("Bearer ", SECRET)).toBe(false);
    expect(bearerMatchesSecret(SECRET, SECRET)).toBe(false);
    expect(bearerMatchesSecret(`Basic ${SECRET}`, SECRET)).toBe(false);
    expect(bearerMatchesSecret([`Bearer ${SECRET}`], SECRET)).toBe(false);
  });

  it("never matches when no secret is configured", () => {
    expect(bearerMatchesSecret("Bearer anything", "")).toBe(false);
  });
});

describe.each([
  ["/api/notifications/drain", drain],
  ["/api/notifications/ballot-deadlines", ballotDeadlines],
] as const)("%s", (route, handler) => {
  it("runs with the drain secret", async () => {
    const res = createMockResponse();
    await handler(request({ headers: bearer(SECRET) }), res);
    expect(res.statusCode).toBe(200);
  });

  it("401s a wrong secret and does no work", async () => {
    const res = createMockResponse();
    await handler(request({ headers: bearer("wrong") }), res);
    expect(res.statusCode).toBe(401);
    expect(drainNotificationOutbox).not.toHaveBeenCalled();
    expect(enqueueBallotDeadlineReminders).not.toHaveBeenCalled();
  });

  it("405s anything but POST", async () => {
    const res = createMockResponse();
    await handler(request({ method: "GET", headers: bearer(SECRET) }), res);
    expect(res.statusCode).toBe(405);
  });

  it("503s when the deployment has no secret, which the workflow treats as skip", async () => {
    mockEnv.NOTIFICATION_DRAIN_SECRET = undefined;
    const res = createMockResponse();
    await handler(request({ headers: bearer("") }), res);
    expect(res.statusCode).toBe(503);
  });

  it("stops guessing from one IP after 15 attempts a minute", async () => {
    const ip = route.endsWith("drain") ? "203.0.113.50" : "203.0.113.51";
    const statuses: number[] = [];
    for (let i = 0; i < 16; i++) {
      const res = createMockResponse();
      await handler(request({ ip, headers: bearer(`guess-${i}`) }), res);
      statuses.push(res.statusCode ?? 0);
    }
    expect(statuses.slice(0, 15).every((s) => s === 401)).toBe(true);
    expect(statuses[15]).toBe(429);

    // Guesses from the same IP must not lock out the real workflow, nor hide
    // the 503 an unconfigured deployment reports.
    const ok = createMockResponse();
    await handler(request({ ip, headers: bearer(SECRET) }), ok);
    expect(ok.statusCode).toBe(200);

    mockEnv.NOTIFICATION_DRAIN_SECRET = undefined;
    const unconfigured = createMockResponse();
    await handler(request({ ip, headers: bearer("x") }), unconfigured);
    expect(unconfigured.statusCode).toBe(503);
  });

  it("does not count successful calls against the limit", async () => {
    const ip = route.endsWith("drain") ? "203.0.113.60" : "203.0.113.61";
    for (let i = 0; i < 20; i++) {
      const res = createMockResponse();
      await handler(request({ ip, headers: bearer(SECRET) }), res);
      expect(res.statusCode).toBe(200);
    }
  });
});

describe("/api/notifications/drain failures", () => {
  it("answers a failed drain with a JSON 500 instead of throwing", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    drainNotificationOutbox.mockRejectedValueOnce(new Error("db down"));
    const res = createMockResponse();
    await drain(request({ headers: bearer(SECRET) }), res);
    expect(res.statusCode).toBe(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Notification outbox drain failed" });
    spy.mockRestore();
  });
});
