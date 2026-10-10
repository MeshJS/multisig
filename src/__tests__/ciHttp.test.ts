import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { requestJson } from "../../scripts/ci/framework/http";

function jsonResponse(status: number, data: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), { status, headers });
}

describe("CI requestJson retry policy", () => {
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it("retries transient 429 responses", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { error: "Too many requests" }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const response = await requestJson<{ ok?: boolean }>({
      url: "http://example.test/rate-limited",
      retries: 1,
      retryDelayMs: 0,
      maxRetryDelayMs: 0,
    });

    expect(response).toEqual({ status: 200, data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-transient validation responses", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error: "Bad Request" }));

    const response = await requestJson<{ error?: string }>({
      url: "http://example.test/bad-request",
      retries: 3,
      retryDelayMs: 0,
      maxRetryDelayMs: 0,
    });

    expect(response).toEqual({ status: 400, data: { error: "Bad Request" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns the final transient response after retries are exhausted", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(429, { error: "Too many requests" }))
      .mockResolvedValueOnce(jsonResponse(429, { error: "Still rate limited" }));

    const response = await requestJson<{ error?: string }>({
      url: "http://example.test/rate-limited",
      retries: 1,
      retryDelayMs: 0,
      maxRetryDelayMs: 0,
    });

    expect(response).toEqual({ status: 429, data: { error: "Still rate limited" } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry transient responses when retries are disabled", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(502, {
        error: "Transaction witness recorded, but submission to network failed",
      }),
    );

    const response = await requestJson<{ error?: string }>({
      url: "http://example.test/signTransaction",
      method: "POST",
      body: { transactionId: "tx-1" },
      retries: 0,
    });

    expect(response).toEqual({
      status: 502,
      data: {
        error: "Transaction witness recorded, but submission to network failed",
      },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries failed fetch attempts", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("connection reset"))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const response = await requestJson<{ ok?: boolean }>({
      url: "http://example.test/flaky",
      retries: 1,
      retryDelayMs: 0,
      maxRetryDelayMs: 0,
    });

    expect(response).toEqual({ status: 200, data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects BigInt request bodies before fetch retries", async () => {
    await expect(
      requestJson({
        url: "http://example.test/bigint",
        method: "POST",
        body: {
          nested: {
            selectedLovelace: 1n,
          },
        },
      }),
    ).rejects.toThrow(/non-JSON BigInt at body\.nested\.selectedLovelace/);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
