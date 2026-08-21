import { jest } from "@jest/globals";
import type { NextApiRequest, NextApiResponse } from "next";

export type BotJwtPayload = {
  address: string;
  botId: string;
  type: "bot";
};

export const BOT_TEST_ADDRESS = "addr_test1qpbotintegrationfixture000000000000000000000000";
export const BOT_TEST_ID = "bot-test-id";

export function makeBotJwtPayload(
  overrides: Partial<BotJwtPayload> = {},
): BotJwtPayload {
  return {
    address: BOT_TEST_ADDRESS,
    botId: BOT_TEST_ID,
    type: "bot",
    ...overrides,
  };
}

export type ResponseMock = NextApiResponse & { statusCode?: number };

export function createMockResponse(): ResponseMock {
  const res = {
    statusCode: undefined as number | undefined,
    status: jest.fn<(code: number) => NextApiResponse>(),
    json: jest.fn<(payload: unknown) => unknown>(),
    end: jest.fn<() => void>(),
    setHeader: jest.fn<(name: string, value: string) => void>(),
  };

  res.status.mockImplementation((code: number) => {
    res.statusCode = code;
    return res as unknown as NextApiResponse;
  });
  res.json.mockImplementation((payload: unknown) => payload);

  return res as unknown as ResponseMock;
}

export function makeBearerAuth(token = "bot-token"): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

export function makeApiRequest(
  request: Partial<NextApiRequest>,
): NextApiRequest {
  return request as NextApiRequest;
}
