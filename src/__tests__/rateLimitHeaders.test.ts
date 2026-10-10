import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { createMockResponse } from "./apiTestUtils";

/**
 * The stress test showed clients getting 429s with no way to know how long to
 * back off. These tests pin the rate-limit feedback contract: X-RateLimit-*
 * on every guarded response and Retry-After on rejections — and that rejected
 * requests don't extend the window.
 */

let applyRateLimit: typeof import("../lib/security/requestGuards").applyRateLimit;

beforeAll(async () => {
  ({ applyRateLimit } = await import("../lib/security/requestGuards"));
});

function makeReq(ip: string) {
  return { headers: { "x-forwarded-for": ip }, socket: {} } as any;
}

function headerMap(res: ReturnType<typeof createMockResponse>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const call of (res.setHeader as jest.Mock).mock.calls as [string, string][]) {
    out[call[0]] = call[1];
  }
  return out;
}

describe("rate limit feedback headers", () => {
  it("emits X-RateLimit-* on allowed requests and Retry-After on 429", () => {
    const req = makeReq("10.9.9.1");
    const opts = { keySuffix: "test-headers", maxRequests: 2, windowMs: 60_000 };

    const res1 = createMockResponse();
    expect(applyRateLimit(req, res1, opts)).toBe(true);
    const h1 = headerMap(res1);
    expect(h1["X-RateLimit-Limit"]).toBe("2");
    expect(h1["X-RateLimit-Remaining"]).toBe("1");
    expect(Number(h1["X-RateLimit-Reset"])).toBeGreaterThan(Date.now() / 1000);

    const res2 = createMockResponse();
    expect(applyRateLimit(req, res2, opts)).toBe(true);
    expect(headerMap(res2)["X-RateLimit-Remaining"]).toBe("0");

    const res3 = createMockResponse();
    expect(applyRateLimit(req, res3, opts)).toBe(false);
    const h3 = headerMap(res3);
    expect(res3.status).toHaveBeenCalledWith(429);
    const retryAfter = Number(h3["Retry-After"]);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(60);
    const body = (res3.json as jest.Mock).mock.calls[0]?.[0] as { retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBe(retryAfter);
  });

  it("does not extend the window for rejected requests", () => {
    const req = makeReq("10.9.9.2");
    const opts = { keySuffix: "test-no-extend", maxRequests: 1, windowMs: 60_000 };

    expect(applyRateLimit(req, createMockResponse(), opts)).toBe(true);
    const rejected1 = createMockResponse();
    applyRateLimit(req, rejected1, opts);
    const reset1 = headerMap(rejected1)["X-RateLimit-Reset"];

    const rejected2 = createMockResponse();
    applyRateLimit(req, rejected2, opts);
    // Same window end on both rejections — hammering doesn't push it out.
    expect(headerMap(rejected2)["X-RateLimit-Reset"]).toBe(reset1);
  });
});
