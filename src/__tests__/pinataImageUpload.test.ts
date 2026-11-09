import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";
import { Readable } from "stream";
import { createMockResponse } from "./apiTestUtils";

// POST /api/pinata-storage/image/put used to be open to anyone, and it streamed
// every upload to an OS temp file (up to 200 MB, never deleted) before checking
// the 1 MB limit. These tests pin the contract: authenticate before reading a
// byte of the body, cap the upload while it streams, and only then pin.

const getWalletSessionFromReqMock: jest.Mock = jest.fn();
const verifyJwtMock: jest.Mock = jest.fn();
const applyRateLimitMock: jest.Mock = jest.fn();

jest.mock("@/lib/auth/walletSession", () => ({
  __esModule: true,
  getWalletSessionFromReq: getWalletSessionFromReqMock,
}));

jest.mock("@/lib/verifyJwt", () => ({
  __esModule: true,
  verifyJwt: verifyJwtMock,
}));

jest.mock("@/lib/security/requestGuards", () => ({
  __esModule: true,
  applyRateLimit: applyRateLimitMock,
}));

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<unknown>;
let routeConfig: { api?: { bodyParser?: unknown } } | undefined;
let vercelHandler: (req: NextApiRequest, res: NextApiResponse) => unknown;

const BOUNDARY = "----meshtestboundary";
const realFetch = global.fetch;
const fetchMock = jest.fn<typeof fetch>();

type Part =
  | { name: string; value: string }
  | { name: string; filename: string; contentType: string; data: Buffer };

function multipartBody(parts: Part[]): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${BOUNDARY}\r\n`));
    if ("data" in part) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
            `Content-Type: ${part.contentType}\r\n\r\n`,
        ),
      );
      chunks.push(part.data, Buffer.from("\r\n"));
    } else {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
        ),
      );
    }
  }
  chunks.push(Buffer.from(`--${BOUNDARY}--\r\n`));
  return Buffer.concat(chunks);
}

/** A request whose body is `body`, recording whether anything read it. */
function uploadRequest(
  body: Buffer,
  headers: Record<string, string | undefined> = {},
): NextApiRequest & { bodyWasRead: () => boolean } {
  let read = false;
  let sent = false;
  const stream = new Readable({
    read() {
      read = true;
      if (sent) return;
      sent = true;
      // Deliver in 64 KB slices so the size cap can trip mid-stream.
      for (let i = 0; i < body.length; i += 64 * 1024) {
        this.push(body.subarray(i, i + 64 * 1024));
      }
      this.push(null);
    },
  });
  return Object.assign(stream, {
    method: "POST",
    cookies: {},
    query: {},
    // A header passed as `undefined` is left out (e.g. a chunked upload with
    // no Content-Length).
    headers: Object.fromEntries(
      Object.entries({
        "content-type": `multipart/form-data; boundary=${BOUNDARY}`,
        "content-length": String(body.length),
        ...headers,
      }).filter(([, v]) => v !== undefined),
    ),
    bodyWasRead: () => read,
  }) as unknown as NextApiRequest & { bodyWasRead: () => boolean };
}

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const validParts = (data: Buffer = PNG): Part[] => [
  { name: "file", filename: "avatar.png", contentType: "image/png", data },
  { name: "shortHash", value: "abcdef0123" },
  { name: "filename", value: "avatar.png" },
];

function pinataOk() {
  return new Response(
    JSON.stringify({ data: { id: "pin-1", cid: "bafytestcid" } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeAll(async () => {
  global.fetch = fetchMock as unknown as typeof fetch;
  ({ default: handler, config: routeConfig } = await import(
    "../pages/api/pinata-storage/image/put"
  ));
  ({ default: vercelHandler } = await import("../pages/api/vercel-storage/image/put"));
});

afterAll(() => {
  global.fetch = realFetch;
});

beforeEach(() => {
  jest.clearAllMocks();
  applyRateLimitMock.mockReturnValue(true);
  getWalletSessionFromReqMock.mockReturnValue({ wallets: ["wallet-1"] });
  verifyJwtMock.mockReturnValue(null);
  fetchMock.mockImplementation(async () => pinataOk());
});

describe("POST /api/pinata-storage/image/put", () => {
  it("turns off Next's body parser, which would otherwise consume the multipart stream", () => {
    // Calling the handler directly (as below) skips Next's parser, so this is
    // the only test that would notice the export going missing: with the
    // parser on, formidable waits on an already-drained stream forever.
    expect(routeConfig?.api?.bodyParser).toBe(false);
  });

  it("rejects a caller with neither a wallet session nor a bearer token, without reading the body", async () => {
    getWalletSessionFromReqMock.mockReturnValue(null);
    const req = uploadRequest(multipartBody(validParts()));
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(req.bodyWasRead()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats a wallet session with no wallets as unauthenticated", async () => {
    getWalletSessionFromReqMock.mockReturnValue({ wallets: [] });
    const res = createMockResponse();

    await handler(uploadRequest(multipartBody(validParts())), res);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("rejects an invalid bearer token", async () => {
    getWalletSessionFromReqMock.mockReturnValue(null);
    const res = createMockResponse();

    await handler(
      uploadRequest(multipartBody(validParts()), { authorization: "Bearer forged" }),
      res,
    );

    expect(verifyJwtMock).toHaveBeenCalledWith("forged");
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("accepts a valid v1 bearer token in place of a wallet session", async () => {
    getWalletSessionFromReqMock.mockReturnValue(null);
    verifyJwtMock.mockReturnValue({ address: "addr_test1qpbearer" });
    const res = createMockResponse();

    await handler(
      uploadRequest(multipartBody(validParts()), { authorization: "Bearer good" }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("stops at the rate limiter before authenticating or reading the body", async () => {
    applyRateLimitMock.mockReturnValue(false);
    const req = uploadRequest(multipartBody(validParts()));
    const res = createMockResponse();

    await handler(req, res);

    expect(getWalletSessionFromReqMock).not.toHaveBeenCalled();
    expect(req.bodyWasRead()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pins the exact uploaded bytes under the given filename and returns the gateway URL", async () => {
    const res = createMockResponse();

    await handler(uploadRequest(multipartBody(validParts())), res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ cid: "bafytestcid", id: "pin-1" }),
    );
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://uploads.pinata.cloud/v3/files");
    const sent = (init!.body as FormData).get("file") as File;
    expect(sent.name).toBe("avatar.png");
    expect(sent.type).toBe("image/png");
    expect(Buffer.from(await sent.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("accepts a file of exactly 1 MB", async () => {
    const res = createMockResponse();

    await handler(uploadRequest(multipartBody(validParts(Buffer.alloc(1024 * 1024, 1)))), res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("answers 413 for a file over 1 MB and never pins it", async () => {
    const res = createMockResponse();

    await handler(
      uploadRequest(multipartBody(validParts(Buffer.alloc(1024 * 1024 + 1, 1)))),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a declared Content-Length over the cap without reading the body", async () => {
    const req = uploadRequest(multipartBody(validParts(Buffer.alloc(20 * 1024 * 1024, 1))));
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(req.bodyWasRead()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a chunked upload with no Content-Length (411) without reading it", async () => {
    // formidable's caps count part bodies only; a chunked request could grow a
    // part header without limit. The declared length is what bounds the body.
    const req = uploadRequest(multipartBody(validParts()), {
      "content-length": undefined,
      "transfer-encoding": "chunked",
    });
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(411);
    expect(req.bodyWasRead()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still enforces the file cap while streaming when the declared length is understated", async () => {
    // Node would stop at the declared length on a real socket; the fake stream
    // keeps going, which exercises formidable's own mid-stream cap.
    const res = createMockResponse();

    await handler(
      uploadRequest(multipartBody(validParts(Buffer.alloc(20 * 1024 * 1024, 1))), {
        "content-length": "1000",
      }),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ error: "File size exceeds 1MB limit" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an image sent under a field other than `file`, so it cannot dodge the limits", async () => {
    const res = createMockResponse();

    await handler(
      uploadRequest(
        multipartBody([
          { name: "other", filename: "x.png", contentType: "image/png", data: PNG },
          { name: "shortHash", value: "abcdef0123" },
          { name: "filename", value: "x.png" },
        ]),
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a second file part", async () => {
    const res = createMockResponse();

    await handler(
      uploadRequest(multipartBody([...validParts(), validParts()[0]!])),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ error: "Too many files or fields" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a file that does not declare an image type", async () => {
    const res = createMockResponse();

    await handler(
      uploadRequest(
        multipartBody([
          { name: "file", filename: "page.html", contentType: "text/html", data: Buffer.from("<script>") },
          { name: "shortHash", value: "abcdef0123" },
          { name: "filename", value: "page.html" },
        ]),
      ),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(415);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers 400 when no file is uploaded", async () => {
    const res = createMockResponse();

    await handler(uploadRequest(multipartBody(validParts().slice(1))), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "No file uploaded" });
  });

  it("answers 400 when shortHash or filename is missing", async () => {
    const [file, shortHash, filename] = validParts();

    const noHash = createMockResponse();
    await handler(uploadRequest(multipartBody([file!, filename!])), noHash);
    expect(noHash.status).toHaveBeenCalledWith(400);
    expect(noHash.json).toHaveBeenCalledWith({ error: "shortHash is required" });

    const noName = createMockResponse();
    await handler(uploadRequest(multipartBody([file!, shortHash!])), noName);
    expect(noName.status).toHaveBeenCalledWith(400);
    expect(noName.json).toHaveBeenCalledWith({ error: "filename is required" });
  });

  it.each(["application/json", "application/octet-stream", "application/x-www-form-urlencoded"])(
    "refuses a %s body without reading it (formidable's non-multipart parsers ignore the size caps)",
    async (contentType) => {
      const req = uploadRequest(Buffer.alloc(5 * 1024 * 1024, 1), {
        "content-type": contentType,
        "content-length": undefined,
      });
      const res = createMockResponse();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(415);
      expect(req.bodyWasRead()).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("answers 400, not 500, for a malformed multipart body", async () => {
    const res = createMockResponse();

    await handler(
      uploadRequest(Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\nContent-Type: image/png\r\n\r\nunterminated`)),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes a Pinata failure status through", async () => {
    fetchMock.mockImplementation(async () => new Response("quota exceeded", { status: 429 }));
    const res = createMockResponse();

    await handler(uploadRequest(multipartBody(validParts())), res);

    expect(res.status).toHaveBeenCalledWith(429);
  });

  it("rejects methods other than POST", async () => {
    const res = createMockResponse();

    await handler({ method: "GET", headers: {}, cookies: {} } as unknown as NextApiRequest, res);

    expect(res.status).toHaveBeenCalledWith(405);
  });
});

describe("POST /api/vercel-storage/image/put", () => {
  it("answers 501 without reading the body", async () => {
    const req = uploadRequest(multipartBody(validParts()));
    const res = createMockResponse();

    await vercelHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(501);
    expect(req.bodyWasRead()).toBe(false);
  });
});
