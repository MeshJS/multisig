import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest } from "next";
import { createMockResponse, makeApiRequest } from "./apiTestUtils";

/**
 * POST /api/v1/stats/run-snapshots-batch is a public URL that only the
 * daily-balance-snapshots workflow should be able to run. These specs pin down
 * that exactly `Bearer $SNAPSHOT_AUTH_TOKEN` gets in, that guessing is rate
 * limited without ever locking out the workflow, and that the 405/500/400
 * answers the orchestrator already sees are unchanged.
 */

const TOKEN = "snapshot-token-0123456789abcdef";

jest.mock("@/lib/cors", () => ({
  __esModule: true,
  addCorsCacheBustingHeaders: jest.fn(),
  cors: jest.fn(async () => undefined),
}));

const walletCount = jest.fn<() => Promise<number>>();
const walletFindMany = jest.fn<() => Promise<unknown[]>>();
const snapshotCreate = jest.fn();
jest.mock("@/server/db", () => ({
  __esModule: true,
  db: {
    wallet: { count: walletCount, findMany: walletFindMany },
    balanceSnapshot: { create: snapshotCreate },
  },
}));

// The chain helpers pull in the Mesh WASM; no spec here gets past an empty batch.
jest.mock("@/utils/common", () => ({ __esModule: true, buildWallet: jest.fn() }));
jest.mock("@/utils/get-provider", () => ({ __esModule: true, getProvider: jest.fn() }));
jest.mock("@/utils/getBalance", () => ({ __esModule: true, getBalance: jest.fn() }));
jest.mock("@/utils/multisigSDK", () => ({ __esModule: true, addressToNetwork: jest.fn() }));

import handler from "@/pages/api/v1/stats/run-snapshots-batch";

let ipCounter = 0;
/** A fresh client IP per request unless one is given, so limits don't leak between specs. */
function request(
  overrides: Partial<NextApiRequest> & { ip?: string } = {},
): NextApiRequest {
  const { ip, headers, ...rest } = overrides;
  return makeApiRequest({
    method: "POST",
    query: { batchId: "run-1", batchNumber: "1", batchSize: "5" },
    headers: {
      "x-forwarded-for": ip ?? `198.51.100.${++ipCounter % 250}`,
      ...headers,
    },
    ...rest,
  });
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const originalToken = process.env.SNAPSHOT_AUTH_TOKEN;

beforeEach(() => {
  process.env.SNAPSHOT_AUTH_TOKEN = TOKEN;
  walletCount.mockReset().mockResolvedValue(0);
  walletFindMany.mockReset().mockResolvedValue([]);
  jest.spyOn(console, "log").mockImplementation(() => undefined);
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  if (originalToken === undefined) delete process.env.SNAPSHOT_AUTH_TOKEN;
  else process.env.SNAPSHOT_AUTH_TOKEN = originalToken;
});

describe("POST /api/v1/stats/run-snapshots-batch auth", () => {
  it("runs the batch with the snapshot token", async () => {
    const res = createMockResponse();
    await handler(request({ headers: bearer(TOKEN) }), res);
    expect(res.statusCode).toBe(200);
    expect(walletCount).toHaveBeenCalledTimes(1);
  });

  it("401s a wrong token, a prefix or an extension of it, and touches no data", async () => {
    for (const token of ["wrong", TOKEN.slice(0, -1), `${TOKEN}x`]) {
      const res = createMockResponse();
      await handler(request({ headers: bearer(token) }), res);
      expect(res.statusCode).toBe(401);
    }
    expect(walletCount).not.toHaveBeenCalled();
    expect(walletFindMany).not.toHaveBeenCalled();
    expect(snapshotCreate).not.toHaveBeenCalled();
  });

  it("401s a missing header and a bare token without the Bearer scheme", async () => {
    // The old `replace('Bearer ', '')` accepted the raw token as well.
    for (const authorization of [undefined, TOKEN, `Basic ${TOKEN}`, "Bearer "]) {
      const res = createMockResponse();
      await handler(
        request({ headers: authorization === undefined ? {} : { authorization } }),
        res,
      );
      expect(res.statusCode).toBe(401);
    }
    expect(walletCount).not.toHaveBeenCalled();
  });

  it("405s anything but POST before looking at the token", async () => {
    const res = createMockResponse();
    await handler(request({ method: "GET", headers: bearer("wrong") }), res);
    expect(res.statusCode).toBe(405);
  });

  it.each([
    ["unset", undefined],
    ["empty", ""],
  ])("500s when the deployment's token is %s, whatever the header says", async (_label, value) => {
    if (value === undefined) delete process.env.SNAPSHOT_AUTH_TOKEN;
    else process.env.SNAPSHOT_AUTH_TOKEN = value;
    const res = createMockResponse();
    await handler(request({ headers: { authorization: "Bearer " } }), res);
    expect(res.statusCode).toBe(500);
    expect(walletCount).not.toHaveBeenCalled();
  });

  it("still validates the batch query once authorized", async () => {
    const res = createMockResponse();
    await handler(
      request({ headers: bearer(TOKEN), query: { batchId: "run-1", batchNumber: "1", batchSize: "6" } }),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it("stops guessing from one IP after 15 attempts a minute, without locking out the workflow", async () => {
    const ip = "203.0.113.70";
    const statuses: number[] = [];
    for (let i = 0; i < 16; i++) {
      const res = createMockResponse();
      await handler(request({ ip, headers: bearer(`guess-${i}`) }), res);
      statuses.push(res.statusCode ?? 0);
    }
    expect(statuses.slice(0, 15).every((s) => s === 401)).toBe(true);
    expect(statuses[15]).toBe(429);

    const ok = createMockResponse();
    await handler(request({ ip, headers: bearer(TOKEN) }), ok);
    expect(ok.statusCode).toBe(200);
  });

  it("does not count successful calls against the limit", async () => {
    // A full snapshot run is one call per batch of 5 wallets, all from one runner IP.
    const ip = "203.0.113.71";
    for (let i = 0; i < 30; i++) {
      const res = createMockResponse();
      await handler(request({ ip, headers: bearer(TOKEN) }), res);
      expect(res.statusCode).toBe(200);
    }
  });
});
