import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/env", () => ({
  env: {
    NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD: "preprodKEY123",
    NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET: "mainnetKEY456",
  },
}));

import { getBlockfrostReader } from "@/utils/blockfrost-get";

/**
 * The light reader replaces Mesh's BlockfrostProvider.get on public pages, so
 * it has to behave the same: same URL, same auth header, same resolved value,
 * and the same rejection shape that callers already parse.
 */
describe("getBlockfrostReader", () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  const respond = (status: number, body: unknown) =>
    fetchMock.mockResolvedValueOnce(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );

  it("calls the network the key belongs to, with the project_id header", async () => {
    respond(200, [{ drep_id: "drep1" }]);
    const data = await getBlockfrostReader(1).get("/governance/dreps?count=1");
    expect(data).toEqual([{ drep_id: "drep1" }]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://cardano-mainnet.blockfrost.io/api/v0/governance/dreps?count=1",
    );
    expect((init as RequestInit).headers).toEqual({ project_id: "mainnetKEY456" });
  });

  it("uses the preprod endpoint for network 0", async () => {
    respond(200, {});
    await getBlockfrostReader(0).get("txs/abc/utxos");
    expect(fetchMock.mock.calls[0]![0]).toBe(
      "https://cardano-preprod.blockfrost.io/api/v0/txs/abc/utxos",
    );
  });

  it("accepts 202 like Mesh does", async () => {
    respond(202, { queued: true });
    await expect(getBlockfrostReader(0).get("x")).resolves.toEqual({ queued: true });
  });

  it("rejects with Mesh's JSON-string error shape, status included", async () => {
    respond(404, { status_code: 404, error: "Not Found" });
    const error = await getBlockfrostReader(0)
      .get("governance/dreps/nope")
      .catch((e: unknown) => e);
    expect(typeof error).toBe("string");
    expect(JSON.parse(error as string)).toMatchObject({
      status: 404,
      data: { status_code: 404, error: "Not Found" },
    });
  });

  it("rejects with a message when the request never completes", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down"));
    const error = await getBlockfrostReader(0).get("x").catch((e: unknown) => e);
    expect(JSON.parse(error as string)).toEqual({ message: "network down" });
  });
});
