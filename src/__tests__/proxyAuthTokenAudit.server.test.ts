import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { csl } from "@meshsdk/core-csl";
import type { Wallet as DbWallet } from "@prisma/client";

const resolveWalletScriptAddressMock = jest.fn<(...args: unknown[]) => string>();
const getProviderMock = jest.fn<(network: number) => unknown>();

jest.mock("@/lib/server/walletScriptAddress", () => ({
  __esModule: true,
  resolveWalletScriptAddress: resolveWalletScriptAddressMock,
}));

jest.mock("@/utils/get-provider", () => ({
  __esModule: true,
  getProvider: getProviderMock,
}));

const POLICY = "d".repeat(56);

function enterpriseAddress(keyHashHex: string): string {
  return csl.EnterpriseAddress.new(
    csl.NetworkInfo.testnet_preview().network_id(),
    csl.Credential.from_keyhash(csl.Ed25519KeyHash.from_hex(keyHashHex)),
  )
    .to_address()
    .to_bech32();
}

const WALLET = enterpriseAddress("1".repeat(56));
const PROXY = enterpriseAddress("2".repeat(56));
const STRANGER = enterpriseAddress("3".repeat(56));

function buildTxHex(args: {
  outputs: { address: string; token?: string }[];
  burn?: boolean;
}): string {
  const inputs = csl.TransactionInputs.new();
  inputs.add(
    csl.TransactionInput.new(csl.TransactionHash.from_bytes(Buffer.from("00".repeat(32), "hex")), 0),
  );
  const outputs = csl.TransactionOutputs.new();
  for (const spec of args.outputs) {
    const value = csl.Value.new(csl.BigNum.from_str("2000000"));
    if (spec.token) {
      const assets = csl.Assets.new();
      assets.insert(csl.AssetName.new(Buffer.alloc(0)), csl.BigNum.from_str(spec.token));
      const multiasset = csl.MultiAsset.new();
      multiasset.insert(csl.ScriptHash.from_hex(POLICY), assets);
      value.set_multiasset(multiasset);
    }
    outputs.add(csl.TransactionOutput.new(csl.Address.from_bech32(spec.address), value));
  }
  const body = csl.TransactionBody.new(inputs, outputs, csl.BigNum.from_str("200000"), undefined);
  if (args.burn) {
    const mintAssets = csl.MintAssets.new();
    mintAssets.insert(csl.AssetName.new(Buffer.alloc(0)), csl.Int.from_str("-10"));
    const mint = csl.Mint.new();
    mint.insert(csl.ScriptHash.from_hex(POLICY), mintAssets);
    body.set_mint(mint);
  }
  return csl.Transaction.new(body, csl.TransactionWitnessSet.new(), undefined).to_hex();
}

const wallet = { id: "wallet-1" } as DbWallet;

type FindManyArgs = { where: Record<string, unknown>; select?: Record<string, boolean> };

function dbWithProxies(rows: { authTokenId: string; proxyAddress: string; isActive: boolean }[]) {
  const findMany = jest.fn(async (args: FindManyArgs) => {
    // Mirror Prisma: only filter by what the query asks for.
    return rows
      .filter((row) => !("isActive" in args.where) || row.isActive === args.where.isActive)
      .map(({ authTokenId, proxyAddress }) => ({ authTokenId, proxyAddress }));
  });
  return { db: { proxy: { findMany } } as never, findMany };
}

let auditPendingTxForProxyWallet: typeof import("@/lib/server/proxyAuthTokenAudit")["auditPendingTxForProxyWallet"];

beforeEach(async () => {
  jest.clearAllMocks();
  resolveWalletScriptAddressMock.mockReturnValue(WALLET);
  ({ auditPendingTxForProxyWallet } = await import("@/lib/server/proxyAuthTokenAudit"));
});

describe("auditPendingTxForProxyWallet", () => {
  it("skips wallets without proxies without resolving anything", async () => {
    const { db } = dbWithProxies([]);
    const txCbor = buildTxHex({ outputs: [{ address: STRANGER, token: "1" }] });
    await expect(
      auditPendingTxForProxyWallet(db, { wallet, signerAddress: WALLET, txCbor, context: "t" }),
    ).resolves.toBeNull();
    expect(resolveWalletScriptAddressMock).not.toHaveBeenCalled();
  });

  it("audits every proxy row, including ones flagged inactive in the DB", async () => {
    const { db, findMany } = dbWithProxies([
      { authTokenId: POLICY, proxyAddress: PROXY, isActive: false },
    ]);
    const txCbor = buildTxHex({ outputs: [{ address: STRANGER, token: "1" }] });
    const message = await auditPendingTxForProxyWallet(db, {
      wallet,
      signerAddress: WALLET,
      txCbor,
      context: "t",
    });
    expect(message).toMatch(/moves a proxy auth token away from the wallet address/);
    expect(findMany).toHaveBeenCalledWith({
      where: { walletId: "wallet-1" },
      select: { authTokenId: true, proxyAddress: true },
    });
  });

  it("accepts a safe transaction", async () => {
    const { db } = dbWithProxies([{ authTokenId: POLICY, proxyAddress: PROXY, isActive: true }]);
    const txCbor = buildTxHex({ outputs: [{ address: WALLET, token: "1" }, { address: PROXY }] });
    await expect(
      auditPendingTxForProxyWallet(db, { wallet, signerAddress: WALLET, txCbor, context: "t" }),
    ).resolves.toBeNull();
    expect(getProviderMock).not.toHaveBeenCalled();
  });

  it("refuses a burn while the proxy address still holds UTxOs", async () => {
    const fetchAddressUTxOs = jest.fn(async (_address: string) => [{} as never]);
    getProviderMock.mockReturnValue({ fetchAddressUTxOs });
    const { db } = dbWithProxies([{ authTokenId: POLICY, proxyAddress: PROXY, isActive: true }]);
    const txCbor = buildTxHex({ outputs: [{ address: WALLET }], burn: true });
    const message = await auditPendingTxForProxyWallet(db, {
      wallet,
      signerAddress: WALLET,
      txCbor,
      context: "t",
    });
    expect(message).toMatch(/still holds 1 UTxO\(s\)/);
    expect(getProviderMock).toHaveBeenCalledWith(0);
    expect(fetchAddressUTxOs).toHaveBeenCalledWith(PROXY);
  });

  it("accepts a burn once the proxy address is empty and honours an injected fetcher", async () => {
    const fetchProxyUtxos = jest.fn(async (_address: string) => [] as never[]);
    const { db } = dbWithProxies([{ authTokenId: POLICY, proxyAddress: PROXY, isActive: true }]);
    const txCbor = buildTxHex({ outputs: [{ address: WALLET }], burn: true });
    await expect(
      auditPendingTxForProxyWallet(db, {
        wallet,
        signerAddress: WALLET,
        txCbor,
        context: "t",
        fetchProxyUtxos,
      }),
    ).resolves.toBeNull();
    expect(fetchProxyUtxos).toHaveBeenCalledWith(PROXY);
    expect(getProviderMock).not.toHaveBeenCalled();
  });

  it("fails closed when the wallet address cannot be resolved", async () => {
    resolveWalletScriptAddressMock.mockImplementation(() => {
      throw new Error("no script");
    });
    const { db } = dbWithProxies([{ authTokenId: POLICY, proxyAddress: PROXY, isActive: true }]);
    const txCbor = buildTxHex({ outputs: [{ address: WALLET }] });
    const message = await auditPendingTxForProxyWallet(db, {
      wallet,
      signerAddress: WALLET,
      txCbor,
      context: "t",
    });
    expect(message).toMatch(/wallet script address resolution failed/);
  });
});
