import { beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { NextApiRequest, NextApiResponse } from 'next';

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

jest.mock(
  '@/lib/verifyJwt',
  () => ({
    __esModule: true,
    verifyJwt: verifyJwtMock,
  }),
  { virtual: true },
);

const createCallerMock = jest.fn();

jest.mock(
  '@/server/api/root',
  () => ({
    __esModule: true,
    createCaller: createCallerMock,
  }),
  { virtual: true },
);

const dbMock = { __type: 'dbMock' };

jest.mock(
  '@/server/db',
  () => ({
    __esModule: true,
    db: dbMock,
  }),
  { virtual: true },
);

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

const walletGetWalletMock = jest.fn<(args: unknown) => Promise<unknown>>();
const transactionGetPendingTransactionsMock = jest.fn<(args: unknown) => Promise<unknown>>();
const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import('../pages/api/v1/pendingTransactions'));
});

beforeEach(() => {
  jest.clearAllMocks();

  walletGetWalletMock.mockReset();
  transactionGetPendingTransactionsMock.mockReset();
  verifyJwtMock.mockReset();
  createCallerMock.mockReset();
  addCorsCacheBustingHeadersMock.mockReset();
  corsMock.mockReset();

  corsMock.mockResolvedValue(undefined);
  addCorsCacheBustingHeadersMock.mockImplementation(() => {
    // no-op
  });

  createCallerMock.mockReturnValue({
    wallet: { getWallet: walletGetWalletMock },
    transaction: { getPendingTransactions: transactionGetPendingTransactionsMock },
  });
});

afterEach(() => {
  consoleErrorSpy.mockClear();
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

describe('pendingTransactions API route', () => {
  it('handles OPTIONS preflight requests', async () => {
    const req = {
      method: 'OPTIONS',
      headers: { authorization: 'Bearer token' },
      query: {},
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(addCorsCacheBustingHeadersMock).toHaveBeenCalledWith(res);
    expect(corsMock).toHaveBeenCalledWith(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(res.end).toHaveBeenCalled();
  });

  it('returns 405 for unsupported methods', async () => {
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer token' },
      query: {},
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(405);
    expect(res.json).toHaveBeenCalledWith({ error: 'Method Not Allowed' });
  });

  it('returns pending transactions for valid request', async () => {
    const address = 'addr_test1qpvalidaddress';
    const walletId = 'wallet-valid';
    const token = 'valid-token';
    const pendingTransactions = [{ id: 'tx-1' }, { id: 'tx-2' }];

    verifyJwtMock.mockReturnValue({ address });
    walletGetWalletMock.mockResolvedValue({
      id: walletId,
      signersAddresses: [address],
    });
    transactionGetPendingTransactionsMock.mockResolvedValue(pendingTransactions);

    const req = {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
      query: { walletId, address },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(addCorsCacheBustingHeadersMock).toHaveBeenCalledWith(res);
    expect(corsMock).toHaveBeenCalledWith(req, res);
    expect(verifyJwtMock).toHaveBeenCalledWith(token);
    expect(createCallerMock).toHaveBeenCalledWith({
      db: dbMock,
      session: expect.objectContaining({
        user: { id: address },
        expires: expect.any(String),
      }),
    });
    expect(walletGetWalletMock).toHaveBeenCalledWith({ walletId, address });
    expect(transactionGetPendingTransactionsMock).toHaveBeenCalledWith({ walletId });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(pendingTransactions);
  });

  it('returns 401 when authorization header is missing', async () => {
    const req = {
      method: 'GET',
      headers: {},
      query: { walletId: 'wallet', address: 'addr_test1qpmissingauth' },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized - Missing token' });
    expect(verifyJwtMock).not.toHaveBeenCalled();
    expect(createCallerMock).not.toHaveBeenCalled();
  });

  it('returns 401 when token verification fails', async () => {
    verifyJwtMock.mockReturnValue(null);

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer invalid-token' },
      query: { walletId: 'wallet-id', address: 'addr_test1qpinvalidtoken' },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(verifyJwtMock).toHaveBeenCalledWith('invalid-token');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    expect(createCallerMock).not.toHaveBeenCalled();
  });

  it('returns 403 when JWT address mismatches query address', async () => {
    verifyJwtMock.mockReturnValue({ address: 'addr_test1qpjwtaddress' });

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer mismatch-token' },
      query: {
        walletId: 'wallet-mismatch',
        address: 'addr_test1qpqueryaddress',
      },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Address mismatch' });
    expect(createCallerMock).not.toHaveBeenCalled();
  });

  it('returns 400 when address parameter is invalid', async () => {
    verifyJwtMock.mockReturnValue({ address: 'addr_test1qpaddressparam' });

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token' },
      query: { walletId: 'wallet-id', address: ['addr'] },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid address parameter' });
  });

  it('returns 400 when walletId parameter is invalid', async () => {
    verifyJwtMock.mockReturnValue({ address: 'addr_test1qpwalletparam' });

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token' },
      query: { walletId: ['wallet'], address: 'addr_test1qpwalletparam' },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid walletId parameter' });
  });

  it('returns 404 when wallet is not found', async () => {
    const address = 'addr_test1qpwalletmissing';
    const walletId = 'wallet-missing';

    verifyJwtMock.mockReturnValue({ address });
    walletGetWalletMock.mockResolvedValue(null);

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token' },
      query: { walletId, address },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(walletGetWalletMock).toHaveBeenCalledWith({ walletId, address });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Wallet not found' });
    expect(transactionGetPendingTransactionsMock).not.toHaveBeenCalled();
  });

  it('returns 500 when fetching pending transactions fails', async () => {
    const address = 'addr_test1qperrorcase';
    const walletId = 'wallet-error';
    const failure = new Error('database unavailable');

    verifyJwtMock.mockReturnValue({ address });
    walletGetWalletMock.mockResolvedValue({ id: walletId });
    transactionGetPendingTransactionsMock.mockRejectedValue(failure);

    const req = {
      method: 'GET',
      headers: { authorization: 'Bearer token' },
      query: { walletId, address },
    } as unknown as NextApiRequest;
    const res = createMockResponse();

    await handler(req, res);

    expect(transactionGetPendingTransactionsMock).toHaveBeenCalledWith({ walletId });
    expect(consoleErrorSpy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: 'Internal Server Error' });
  });
});


