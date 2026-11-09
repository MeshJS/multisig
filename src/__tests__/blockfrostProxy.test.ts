import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Readable } from "node:stream";
import type { NextApiRequest, NextApiResponse } from "next";

// /api/blockfrost/* forwards requests to Blockfrost with our project key. It is
// public (the UTXOS wallet's BlockfrostProvider calls it from the browser), so
// these tests pin down what it must not forward:
//   - methods the client never uses,
//   - POSTs to anything but the three endpoints the client submits to,
//   - request bodies of unbounded size (body parsing is off on this route).

jest.mock("@/env", () => ({
  env: {
    BLOCKFROST_API_KEY_PREPROD: "preprodKEY",
    BLOCKFROST_API_KEY_MAINNET: "mainnetKEY",
  },
}));

// The real CORS middleware only logs and sets headers here; keep it out of
// the way so the tests are about the proxy itself.
jest.mock("@/lib/cors", () => ({
  cors: async () => undefined,
  addCorsCacheBustingHeaders: () => undefined,
}));

import handler from "@/pages/api/blockfrost/[...slug]";

const MAX_BODY = 1024 * 1024;

const fetchMock = jest.fn<typeof fetch>();
const realFetch = global.fetch;

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = realFetch;
});

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status: jest.fn((code: number) => {
      res.statusCode = code;
      return res;
    }),
    json: jest.fn((payload: unknown) => {
      res.body = payload;
      return res;
    }),
    end: jest.fn(() => res),
    setHeader: jest.fn((name: string, value: string) => {
      res.headers[name.toLowerCase()] = value;
      return res;
    }),
  };
  return res;
}

type ReqInit = {
  method: string;
  path: string;
  body?: Buffer[];
  headers?: Record<string, string>;
};

/** A request whose body arrives as a stream, as it does with bodyParser off. */
function makeReq({ method, path, body = [], headers = {} }: ReqInit) {
  const stream = Readable.from(body) as unknown as NextApiRequest;
  const [pathname] = path.split("?");
  Object.assign(stream, {
    method,
    url: `/api/blockfrost/${path}`,
    headers,
    query: { slug: pathname!.split("/") },
  });
  return stream;
}

async function call(init: ReqInit) {
  const res = makeRes();
  await handler(makeReq(init), res as unknown as NextApiResponse);
  return res;
}

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

describe("/api/blockfrost methods", () => {
  it("forwards a GET with the network's project key and query string", async () => {
    fetchMock.mockResolvedValue(jsonOk([{ tx_hash: "ab" }]));
    const res = await call({
      method: "GET",
      path: "preprod/addresses/addr_test1xyz/utxos?page=2",
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual([{ tx_hash: "ab" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://cardano-preprod.blockfrost.io/api/v0/addresses/addr_test1xyz/utxos?page=2",
    );
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).project_id).toBe("preprodKEY");
  });

  it.each(["PUT", "DELETE", "PATCH", "HEAD"])(
    "refuses %s without calling Blockfrost",
    async (method) => {
      const res = await call({ method, path: "preprod/tx/submit" });
      expect(res.statusCode).toBe(405);
      expect(res.headers.allow).toBe("GET, POST, OPTIONS");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("still answers a CORS preflight", async () => {
    const res = await call({ method: "OPTIONS", path: "preprod/tx/submit" });
    expect(res.statusCode).toBe(200);
    expect(res.end).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a POST to an endpoint the client never submits to", async () => {
    const res = await call({
      method: "POST",
      path: "mainnet/ipfs/pin/add/QmSomething",
      body: [Buffer.from("{}")],
    });
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe("GET, OPTIONS");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("/api/blockfrost paths", () => {
  it("refuses a network other than mainnet or preprod instead of using the preprod key", async () => {
    const res = await call({ method: "GET", path: "foo/blocks/latest" });
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["a dot-dot segment", ["preprod", "..", "..", "v1", "x"]],
    ["a decoded slash", ["preprod", "..%2F..".replace("%2F", "/"), "x"]],
    ["a decoded query string", ["preprod", "blocks?x=1"]],
    ["a decoded fragment", ["preprod", "blocks#x"]],
  ])("refuses %s in the path", async (_label, slug) => {
    const req = makeReq({ method: "GET", path: "preprod/blocks" });
    (req as unknown as { query: unknown }).query = { slug };
    const res = makeRes();
    await handler(req, res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    "preprod/epochs/latest/parameters",
    "mainnet/accounts/stake1u9ylzsgxaa6xctf4juup682ar3juj85n8tx3hthnljg47zctvm3rc/addresses",
    "preprod/assets/0123abcdef0123abcdef0123abcdef0123abcdef0123abcdef01234d657368",
    "mainnet/governance/dreps/drep1ygr9tuapcanc3kpeyy4dc3vmrz9cfe5q7v9wj3x9j0ap3tswtre9j",
  ])("forwards a real client path: %s", async (path) => {
    fetchMock.mockResolvedValue(jsonOk({}));
    const res = await call({ method: "GET", path });
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("/api/blockfrost POST bodies", () => {
  it("submits transaction bytes as CBOR, as before", async () => {
    fetchMock.mockResolvedValue(new Response('"txhash"', { status: 200 }));
    const res = await call({
      method: "POST",
      path: "preprod/tx/submit",
      body: [Buffer.from([0x84, 0xa4, 0x00])],
    });
    expect(res.statusCode).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://cardano-preprod.blockfrost.io/api/v0/tx/submit");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/cbor",
    );
    // The raw transaction bytes are forwarded unchanged.
    expect(Array.from(init?.body as Uint8Array)).toEqual([0x84, 0xa4, 0x00]);
  });

  it("forwards an evaluate/utxos JSON body unchanged", async () => {
    fetchMock.mockResolvedValue(jsonOk({ result: {} }));
    const payload = JSON.stringify({ cbor: "84a4", additionalUtxoSet: [] });
    const res = await call({
      method: "POST",
      path: "preprod/utils/txs/evaluate/utxos",
      body: [Buffer.from(payload)],
    });
    expect(res.statusCode).toBe(200);
    expect(fetchMock.mock.calls[0]![1]?.body).toBe(payload);
  });

  it("accepts a body right at the cap", async () => {
    fetchMock.mockResolvedValue(jsonOk({ result: {} }));
    const res = await call({
      method: "POST",
      path: "preprod/utils/txs/evaluate/utxos",
      body: [Buffer.alloc(MAX_BODY / 2, 0x61), Buffer.alloc(MAX_BODY / 2, 0x61)],
    });
    expect(res.statusCode).toBe(200);
    expect((fetchMock.mock.calls[0]![1]?.body as string).length).toBe(MAX_BODY);
  });

  it("refuses a declared oversized body without reading it", async () => {
    const req = makeReq({
      method: "POST",
      path: "preprod/tx/submit",
      body: [Buffer.alloc(1024, 0x61), Buffer.alloc(1024, 0x61)],
      headers: { "content-length": String(MAX_BODY + 1) },
    });
    const res = makeRes();
    await handler(req, res as unknown as NextApiResponse);
    expect(res.statusCode).toBe(413);
    expect(res.headers.connection).toBe("close");
    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing consumed the body: the stream was never switched to flowing.
    expect(req.readableFlowing).toBeNull();
    expect(req.readableEnded).toBe(false);
  });

  it("reads a body whose declared length is exactly the cap", async () => {
    fetchMock.mockResolvedValue(new Response('"txhash"', { status: 200 }));
    const res = await call({
      method: "POST",
      path: "preprod/tx/submit",
      body: [Buffer.alloc(MAX_BODY, 0x61)],
      headers: { "content-length": String(MAX_BODY) },
    });
    expect(res.statusCode).toBe(200);
    expect((fetchMock.mock.calls[0]![1]?.body as Uint8Array).byteLength).toBe(MAX_BODY);
  });

  it("forwards utils/txs/evaluate as CBOR", async () => {
    fetchMock.mockResolvedValue(new Response('{"result":{}}', { status: 200 }));
    const res = await call({
      method: "POST",
      path: "mainnet/utils/txs/evaluate",
      body: [Buffer.from([0x84, 0xa4])],
    });
    expect(res.statusCode).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://cardano-mainnet.blockfrost.io/api/v0/utils/txs/evaluate");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/cbor",
    );
    expect((init?.headers as Record<string, string>).project_id).toBe("mainnetKEY");
  });

  it.each(["preprod/tx/submit", "preprod/utils/txs/evaluate/utxos"])(
    "stops reading an undeclared body once it passes the cap (%s)",
    async (path) => {
      // An endless chunked body: only a reader that gives up can finish.
      let pulled = 0;
      const endless = new Readable({
        read() {
          pulled += 1;
          this.push(Buffer.alloc(64 * 1024, 0x61));
        },
      });
      Object.assign(endless, {
        method: "POST",
        url: `/api/blockfrost/${path}`,
        headers: {},
        query: { slug: path.split("/") },
      });
      const res = makeRes();
      await handler(
        endless as unknown as NextApiRequest,
        res as unknown as NextApiResponse,
      );
      expect(res.statusCode).toBe(413);
      expect(fetchMock).not.toHaveBeenCalled();
      // 1 MiB in 64 KiB chunks is 16 reads; allow for stream read-ahead.
      expect(pulled).toBeLessThan(40);
      // And it stays stopped: a stream left flowing would keep reading.
      expect(endless.isPaused()).toBe(true);
      const pulledAtReturn = pulled;
      await new Promise((resolve) => setImmediate(resolve));
      expect(pulled).toBeLessThanOrEqual(pulledAtReturn + 1);
      endless.destroy();
    },
  );
});
