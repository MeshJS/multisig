import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NextApiRequest, NextApiResponse } from 'next';

// --- mocks ---------------------------------------------------------------

const addCorsCacheBustingHeadersMock = jest.fn<(res: NextApiResponse) => void>();
const corsMock = jest.fn<(req: NextApiRequest, res: NextApiResponse) => Promise<void>>();

jest.mock(
  '@/lib/cors',
  () => ({
    __esModule: true,
    addCorsCacheBustingHeaders: addCorsCacheBustingHeadersMock,
    cors: corsMock,
  }),
  { virtual: true },
);

const verifyJwtMock = jest.fn<(token: string | undefined) => { address: string } | null>();
const isBotJwtMock = jest.fn<(payload: unknown) => boolean>();

jest.mock(
  '@/lib/verifyJwt',
  () => ({
    __esModule: true,
    verifyJwt: verifyJwtMock,
    isBotJwt: isBotJwtMock,
  }),
  { virtual: true },
);

const applyRateLimitMock = jest.fn<
  (req: NextApiRequest, res: NextApiResponse, options?: unknown) => boolean
>();
const applyBotRateLimitMock = jest.fn<
  (req: NextApiRequest, res: NextApiResponse, botId: string) => boolean
>();
const enforceBodySizeMock = jest.fn<
  (req: NextApiRequest, res: NextApiResponse, maxBytes: number) => boolean
>();

jest.mock(
  '@/lib/security/requestGuards',
  () => ({
    __esModule: true,
    applyRateLimit: applyRateLimitMock,
    applyBotRateLimit: applyBotRateLimitMock,
    enforceBodySize: enforceBodySizeMock,
  }),
  { virtual: true },
);

const assertBotWalletAccessMock = jest.fn<
  (db: unknown, walletId: string, payload: unknown, ...rest: unknown[]) => Promise<{ wallet: unknown }>
>();

jest.mock(
  '@/lib/auth/botAccess',
  () => ({
    __esModule: true,
    assertBotWalletAccess: assertBotWalletAccessMock,
  }),
  { virtual: true },
);

const dbTransactionCreateMock = jest.fn<(args: unknown) => Promise<unknown>>();
const dbWalletFindUniqueMock = jest.fn<(args: unknown) => Promise<unknown>>();

const dbMock = {
  transaction: { create: dbTransactionCreateMock },
  wallet: { findUnique: dbWalletFindUniqueMock },
};

jest.mock(
  '@/server/db',
  () => ({
    __esModule: true,
    db: dbMock,
  }),
  { virtual: true },
);

const getProviderMock = jest.fn<(network: number) => { submitTx: (cbor: string) => unknown }>();

jest.mock(
  '@/utils/get-provider',
  () => ({
    __esModule: true,
    getProvider: getProviderMock,
  }),
  { virtual: true },
);

const transactionFromHexMock = jest.fn<(hex: string) => { _parsed: true }>();

jest.mock(
  '@meshsdk/core-csl',
  () => ({
    __esModule: true,
    csl: {
      Transaction: { from_hex: transactionFromHexMock },
    },
  }),
  { virtual: true },
);

// --- helpers -------------------------------------------------------------

type ResponseMock = NextApiResponse & { statusCode?: number };

function createMockResponse(): ResponseMock {
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

const VALID_CBOR = '84a3'.padEnd(64, '0');
const ADDRESS = 'addr_test1qpcallerexample';
const WALLET_ID = 'wallet-id-1';
const TOKEN = 'caller-token';

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    walletId: WALLET_ID,
    address: ADDRESS,
    txCbor: VALID_CBOR,
    txJson: JSON.stringify({ outputs: [] }),
    description: 'test tx',
    ...overrides,
  };
}

function buildReq(body: Record<string, unknown>): NextApiRequest {
  return {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}` },
    body,
  } as unknown as NextApiRequest;
}

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import('../pages/api/v1/addTransaction'));
});

beforeEach(() => {
  jest.clearAllMocks();

  corsMock.mockResolvedValue(undefined);
  addCorsCacheBustingHeadersMock.mockImplementation(() => undefined);
  applyRateLimitMock.mockReturnValue(true);
  applyBotRateLimitMock.mockReturnValue(true);
  enforceBodySizeMock.mockReturnValue(true);
  verifyJwtMock.mockReturnValue({ address: ADDRESS });
  isBotJwtMock.mockReturnValue(false);
  transactionFromHexMock.mockReturnValue({ _parsed: true });
  dbWalletFindUniqueMock.mockResolvedValue({
    id: WALLET_ID,
    type: 'atLeast',
    numRequiredSigners: 2,
    signersAddresses: [ADDRESS],
  });
  dbTransactionCreateMock.mockResolvedValue({ id: 'new-tx-id' });
});

// --- tests ---------------------------------------------------------------

describe('addTransaction API route validation', () => {
  it('rejects malformed CBOR with 400 and does not write to the DB', async () => {
    transactionFromHexMock.mockImplementation(() => {
      throw new Error('cbor deserialization failed');
    });

    const res = createMockResponse();
    await handler(buildReq(baseBody({ txCbor: 'deadbeef' })), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Invalid transaction CBOR'),
      }),
    );
    expect(dbTransactionCreateMock).not.toHaveBeenCalled();
  });

  it('rejects non-string txCbor with 400', async () => {
    const res = createMockResponse();
    await handler(buildReq(baseBody({ txCbor: 12345 })), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Invalid txCbor'),
      }),
    );
    expect(transactionFromHexMock).not.toHaveBeenCalled();
    expect(dbTransactionCreateMock).not.toHaveBeenCalled();
  });

  it('rejects unparseable txJson string with 400', async () => {
    const res = createMockResponse();
    await handler(buildReq(baseBody({ txJson: '{not json' })), res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining('Invalid txJson'),
      }),
    );
    expect(dbTransactionCreateMock).not.toHaveBeenCalled();
  });

  it('persists the transaction when CBOR and JSON are both valid', async () => {
    const res = createMockResponse();
    await handler(buildReq(baseBody()), res);

    expect(transactionFromHexMock).toHaveBeenCalledWith(VALID_CBOR);
    expect(dbTransactionCreateMock).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('accepts a txJson that is already an object', async () => {
    const res = createMockResponse();
    await handler(
      buildReq(baseBody({ txJson: { outputs: [], certificates: [] } })),
      res,
    );

    expect(dbTransactionCreateMock).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
