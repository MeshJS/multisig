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

const dbTransactionFindUniqueMock = jest.fn<(args: unknown) => Promise<unknown>>();
const dbTransactionUpdateManyMock = jest.fn<
  (args: {
    where: unknown;
    data: unknown;
  }) => Promise<{ count: number }>
>();

const dbMock = {
  transaction: {
    findUnique: dbTransactionFindUniqueMock,
    updateMany: dbTransactionUpdateManyMock,
  },
};

jest.mock(
  '@/server/db',
  () => ({
    __esModule: true,
    db: dbMock,
  }),
  { virtual: true },
);

const getProviderMock = jest.fn<(network: number) => unknown>();

jest.mock(
  '@/utils/get-provider',
  () => ({
    __esModule: true,
    getProvider: getProviderMock,
  }),
  { virtual: true },
);

const addressToNetworkMock = jest.fn<(address: string) => number>();

jest.mock(
  '@/utils/multisigSDK',
  () => ({
    __esModule: true,
    addressToNetwork: addressToNetworkMock,
  }),
  { virtual: true },
);

const resolvePaymentKeyHashMock = jest.fn<(address: string) => string>();

jest.mock(
  '@meshsdk/core',
  () => ({
    __esModule: true,
    resolvePaymentKeyHash: resolvePaymentKeyHashMock,
  }),
  { virtual: true },
);

const witnessKeyHashHex = '00112233';

class MockEd25519Signature {
  constructor(public hex: string) {}

  static from_hex(hex: string) {
    return new MockEd25519Signature(hex);
  }

  to_bytes() {
    return Buffer.from(this.hex, 'hex');
  }
}

class MockPublicKey {
  constructor(public hex: string) {}

  static from_hex(hex: string) {
    return new MockPublicKey(hex);
  }

  hash() {
    return {
      to_bytes: () => Buffer.from(witnessKeyHashHex, 'hex'),
    };
  }

  verify() {
    return true;
  }

  to_bech32() {
    return `mock_bech32_${this.hex.slice(0, 8)}`;
  }
}

class MockVkey {
  constructor(private readonly publicKey: MockPublicKey) {}

  static new(publicKey: MockPublicKey) {
    return new MockVkey(publicKey);
  }

  public_key() {
    return this.publicKey;
  }
}

class MockVkeywitness {
  constructor(
    private readonly vkeyInstance: MockVkey,
    private readonly signatureInstance: MockEd25519Signature,
  ) {}

  static new(vkey: MockVkey, signature: MockEd25519Signature) {
    return new MockVkeywitness(vkey, signature);
  }

  vkey() {
    return this.vkeyInstance;
  }

  signature() {
    return this.signatureInstance;
  }
}

class MockVkeywitnesses {
  private static lastItems: MockVkeywitness[] = [];

  static reset() {
    MockVkeywitnesses.lastItems = [];
  }

  private readonly items: MockVkeywitness[];

  constructor(items: MockVkeywitness[] = []) {
    this.items = [...items];
  }

  static new() {
    return new MockVkeywitnesses();
  }

  static from_bytes() {
    return new MockVkeywitnesses(MockVkeywitnesses.lastItems);
  }

  to_bytes() {
    MockVkeywitnesses.lastItems = [...this.items];
    return new Uint8Array();
  }

  len() {
    return this.items.length;
  }

  get(index: number) {
    return this.items[index];
  }

  add(item: MockVkeywitness) {
    this.items.push(item);
  }
}

class MockTransactionBody {
  constructor(private readonly bytes: Uint8Array) {}

  static from_bytes(bytes: Uint8Array) {
    return new MockTransactionBody(bytes);
  }

  to_bytes() {
    return this.bytes;
  }
}

class MockTransactionWitnessSet {
  constructor(private vkeysInstance: MockVkeywitnesses | undefined) {}

  static from_bytes() {
    return new MockTransactionWitnessSet(MockVkeywitnesses.from_bytes());
  }

  to_bytes() {
    return this.vkeysInstance?.to_bytes() ?? new Uint8Array();
  }

  vkeys() {
    return this.vkeysInstance;
  }

  set_vkeys(vkeys: MockVkeywitnesses) {
    this.vkeysInstance = vkeys;
  }
}

class MockTransaction {
  private isValid = true;

  constructor(
    private readonly bodyInstance: MockTransactionBody,
    private readonly witnessSetInstance: MockTransactionWitnessSet,
    private readonly auxData: unknown,
    private hexValue: string,
  ) {}

  static from_hex(hex: string) {
    const body = new MockTransactionBody(new Uint8Array([1, 2]));
    const witnessSet = new MockTransactionWitnessSet(MockVkeywitnesses.from_bytes());
    return new MockTransaction(body, witnessSet, { type: 'aux' }, hex);
  }

  static new(
    body: MockTransactionBody,
    witnessSet: MockTransactionWitnessSet,
    auxData: unknown,
  ) {
    return new MockTransaction(body, witnessSet, auxData, 'updated-tx-hex');
  }

  body() {
    return this.bodyInstance;
  }

  witness_set() {
    return this.witnessSetInstance;
  }

  auxiliary_data() {
    return this.auxData;
  }

  is_valid() {
    return this.isValid;
  }

  set_is_valid(value: boolean) {
    this.isValid = value;
  }

  to_hex() {
    return this.hexValue;
  }
}

const calculateTxHashMock = jest.fn<(hex: string) => string>();

const cslMock = {
  Transaction: MockTransaction,
  TransactionBody: MockTransactionBody,
  TransactionWitnessSet: MockTransactionWitnessSet,
  PublicKey: MockPublicKey,
  Ed25519Signature: MockEd25519Signature,
  Vkey: MockVkey,
  Vkeywitness: MockVkeywitness,
  Vkeywitnesses: MockVkeywitnesses,
};

jest.mock(
  '@meshsdk/core-csl',
  () => ({
    __esModule: true,
    csl: cslMock,
    calculateTxHash: calculateTxHashMock,
  }),
  { virtual: true },
);

const consoleErrorSpy = jest
  .spyOn(console, 'error')
  .mockImplementation(() => undefined);
const consoleWarnSpy = jest
  .spyOn(console, 'warn')
  .mockImplementation(() => undefined);

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

let handler: (req: NextApiRequest, res: NextApiResponse) => Promise<void | NextApiResponse>;

beforeAll(async () => {
  ({ default: handler } = await import('../pages/api/v1/signTransaction'));
});

beforeEach(() => {
  jest.clearAllMocks();
  MockVkeywitnesses.reset();

  walletGetWalletMock.mockReset();
  dbTransactionFindUniqueMock.mockReset();
  dbTransactionUpdateManyMock.mockReset();
  getProviderMock.mockReset();
  addressToNetworkMock.mockReset();
  resolvePaymentKeyHashMock.mockReset();
  calculateTxHashMock.mockReset();
  corsMock.mockReset();
  addCorsCacheBustingHeadersMock.mockReset();
  createCallerMock.mockReset();
  verifyJwtMock.mockReset();

  corsMock.mockResolvedValue(undefined);
  addCorsCacheBustingHeadersMock.mockImplementation(() => {
    // no-op for tests
  });
  calculateTxHashMock.mockReturnValue('deadbeef');
  resolvePaymentKeyHashMock.mockReturnValue(witnessKeyHashHex);
  addressToNetworkMock.mockReturnValue(0);

  createCallerMock.mockReturnValue({
    wallet: { getWallet: walletGetWalletMock },
  });
});

afterEach(() => {
  consoleErrorSpy.mockClear();
  consoleWarnSpy.mockClear();
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

describe('signTransaction API route', () => {
  it('updates transaction when payload is valid', async () => {
    const address = 'addr_test1qpl3w9v4l5qhxk778exampleaddress';
    const walletId = 'wallet-id-123';
    const transactionId = 'transaction-id-456';
    const signatureHex = 'aa'.repeat(64);
    const keyHex = 'bb'.repeat(64);

    verifyJwtMock.mockReturnValue({ address });

    walletGetWalletMock.mockResolvedValue({
      id: walletId,
      type: 'atLeast',
      numRequiredSigners: 1,
      signersAddresses: [address],
    });

    const transactionRecord = {
      id: transactionId,
      walletId,
      state: 0,
      signedAddresses: [] as string[],
      rejectedAddresses: [] as string[],
      txCbor: 'stored-tx-hex',
      txHash: null as string | null,
      txJson: '{}',
    };

    const updatedTransaction = {
      ...transactionRecord,
      signedAddresses: [address],
      txCbor: 'updated-tx-hex',
      state: 1,
      txHash: 'provided-hash',
      txJson: '{"multisig":{"state":1}}',
    };

    dbTransactionFindUniqueMock
      .mockResolvedValueOnce(transactionRecord)
      .mockResolvedValueOnce(updatedTransaction);

    dbTransactionUpdateManyMock.mockResolvedValue({ count: 1 });

    const submitTxMock = jest.fn<(txHex: string) => Promise<string>>();
    submitTxMock.mockResolvedValue('provided-hash');
    getProviderMock.mockReturnValue({ submitTx: submitTxMock });

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: {
        walletId,
        transactionId,
        address,
        signature: signatureHex,
        key: keyHex,
        txHash: 'provided-hash',
      },
    } as unknown as NextApiRequest;

    const res = createMockResponse();

    await handler(req, res);

    expect(addCorsCacheBustingHeadersMock).toHaveBeenCalledWith(res);
    expect(corsMock).toHaveBeenCalledWith(req, res);
    expect(verifyJwtMock).toHaveBeenCalledWith('valid-token');
    expect(createCallerMock).toHaveBeenCalledWith({
      db: dbMock,
      session: expect.objectContaining({
        user: { id: address },
        expires: expect.any(String),
      }),
    });
    expect(walletGetWalletMock).toHaveBeenCalledWith({ walletId, address });
    expect(dbTransactionFindUniqueMock).toHaveBeenNthCalledWith(1, {
      where: { id: transactionId },
    });
    expect(getProviderMock).toHaveBeenCalledWith(0);
    expect(submitTxMock).toHaveBeenCalledWith('updated-tx-hex');
    expect(dbTransactionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: transactionId,
        signedAddresses: { equals: [] },
        rejectedAddresses: { equals: [] },
        txCbor: 'stored-tx-hex',
        txJson: '{}',
      },
      data: expect.objectContaining({
        signedAddresses: { set: [address] },
        rejectedAddresses: { set: [] },
        txCbor: 'updated-tx-hex',
        state: 1,
        txHash: 'provided-hash',
        txJson: expect.any(String),
      }),
    });
    expect(dbTransactionFindUniqueMock).toHaveBeenNthCalledWith(2, {
      where: { id: transactionId },
    });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      transaction: updatedTransaction,
      submitted: true,
      txHash: 'provided-hash',
    });
  });

  it('returns 403 when JWT address mismatches request address', async () => {
    verifyJwtMock.mockReturnValue({ address: 'addr_test1qpotheraddress' });

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer mismatch-token' },
      body: {
        walletId: 'wallet-mismatch',
        transactionId: 'tx-mismatch',
        address: 'addr_test1qprequestaddress',
        signature: 'aa'.repeat(64),
        key: 'bb'.repeat(64),
      },
    } as unknown as NextApiRequest;

    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Address mismatch' });
    expect(createCallerMock).not.toHaveBeenCalled();
    expect(walletGetWalletMock).not.toHaveBeenCalled();
  });

  it('returns 404 when wallet is not found', async () => {
    const address = 'addr_test1qpwalletmissing';
    verifyJwtMock.mockReturnValue({ address });

    walletGetWalletMock.mockResolvedValue(null);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: {
        walletId: 'wallet-missing',
        transactionId: 'tx-any',
        address,
        signature: 'aa'.repeat(64),
        key: 'bb'.repeat(64),
      },
    } as unknown as NextApiRequest;

    const res = createMockResponse();

    await handler(req, res);

    expect(walletGetWalletMock).toHaveBeenCalledWith({
      walletId: 'wallet-missing',
      address,
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Wallet not found' });
    expect(dbTransactionFindUniqueMock).not.toHaveBeenCalled();
  });

  it('returns 404 when transaction is not found', async () => {
    const address = 'addr_test1qptransactionmissing';
    const walletId = 'wallet-without-transaction';
    const transactionId = 'missing-tx';
    verifyJwtMock.mockReturnValue({ address });

    walletGetWalletMock.mockResolvedValue({
      id: walletId,
      type: 'atLeast',
      numRequiredSigners: 1,
      signersAddresses: [address],
    });
    dbTransactionFindUniqueMock.mockResolvedValue(null);

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: {
        walletId,
        transactionId,
        address,
        signature: 'aa'.repeat(64),
        key: 'bb'.repeat(64),
      },
    } as unknown as NextApiRequest;

    const res = createMockResponse();

    await handler(req, res);

    expect(dbTransactionFindUniqueMock).toHaveBeenCalledWith({
      where: { id: transactionId },
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: 'Transaction not found' });
  });

  it('returns 401 when authorization header is missing', async () => {
    const req = {
      method: 'POST',
      headers: {},
      body: {},
    } as unknown as NextApiRequest;

    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized - Missing token' });
    expect(verifyJwtMock).not.toHaveBeenCalled();
    expect(createCallerMock).not.toHaveBeenCalled();
  });

  it('returns 409 when address already signed the transaction', async () => {
    const address = 'addr_test1qpmockalready';
    const walletId = 'wallet-id-dupe';
    const transactionId = 'transaction-id-dupe';
    const signatureHex = 'aa'.repeat(64);
    const keyHex = 'bb'.repeat(64);

    verifyJwtMock.mockReturnValue({ address });

    walletGetWalletMock.mockResolvedValue({
      id: walletId,
      type: 'atLeast',
      numRequiredSigners: 2,
      signersAddresses: [address, 'addr_test1qpother'],
    });

    dbTransactionFindUniqueMock.mockResolvedValue({
      id: transactionId,
      walletId,
      state: 0,
      signedAddresses: [address],
      rejectedAddresses: [],
      txCbor: 'stored-tx-hex',
      txHash: null,
    });

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: {
        walletId,
        transactionId,
        address,
        signature: signatureHex,
        key: keyHex,
      },
    } as unknown as NextApiRequest;

    const res = createMockResponse();

    await handler(req, res);

    expect(walletGetWalletMock).toHaveBeenCalledWith({ walletId, address });
    expect(dbTransactionFindUniqueMock).toHaveBeenCalledWith({ where: { id: transactionId } });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Address has already signed this transaction',
    });
    expect(dbTransactionUpdateManyMock).not.toHaveBeenCalled();
    expect(getProviderMock).not.toHaveBeenCalled();
  });

  it('returns 500 when stored transaction is missing txCbor', async () => {
    const address = 'addr_test1qpmissingtxcbor';
    const walletId = 'wallet-missing-txcbor';
    const transactionId = 'transaction-missing-txcbor';

    verifyJwtMock.mockReturnValue({ address });
    walletGetWalletMock.mockResolvedValue({
      id: walletId,
      type: 'atLeast',
      numRequiredSigners: 1,
      signersAddresses: [address],
    });
    dbTransactionFindUniqueMock.mockResolvedValue({
      id: transactionId,
      walletId,
      state: 0,
      signedAddresses: [] as string[],
      rejectedAddresses: [] as string[],
      txCbor: '',
      txHash: null as string | null,
    });

    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer valid-token' },
      body: {
        walletId,
        transactionId,
        address,
        signature: 'aa'.repeat(64),
        key: 'bb'.repeat(64),
      },
    } as unknown as NextApiRequest;

    const res = createMockResponse();

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Stored transaction is missing txCbor',
    });
    expect(dbTransactionUpdateManyMock).not.toHaveBeenCalled();
  });

});

