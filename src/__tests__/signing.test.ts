import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, jest } from "@jest/globals";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Tripwire: the "broken" pattern — `return true ? signature : undefined;`
// must never reappear in `src/utils/signing.ts`. It both throws away the
// `checkSignature` result and obscures the actual signing contract. The
// regression we fixed here was that a failed signature verification still
// returned a (forged-looking) signature to the caller because the ternary
// was always truthy.
// ---------------------------------------------------------------------------
describe("signing.ts source contract", () => {
  it("never returns the always-true ternary on the verification result", () => {
    const src = fs.readFileSync(
      path.resolve(__dirname, "../utils/signing.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/return\s+true\s*\?/);
    // Positive: the verified result must drive an explicit `if (!verified)`
    // throw. The exact identifier we use is `verified` — accept either name
    // so a future rename doesn't trip the tripwire.
    expect(src).toMatch(/if\s*\(\s*!\s*(verified|result)\b/);
  });
});

// ---------------------------------------------------------------------------
// Behavioural: import the real `sign` and exercise every role plus the
// failure path. We mock the @meshsdk/core helpers because they pull in
// CSL/serialization which is heavyweight for a unit test.
// ---------------------------------------------------------------------------
const checkSignatureMock = jest.fn<
  (nonce: string, signature: { signature: string; key: string }, address?: string) => Promise<boolean>
>();
const generateNonceMock = jest.fn<(payload: string) => string>();

jest.unstable_mockModule("@meshsdk/core", () => ({
  __esModule: true,
  checkSignature: checkSignatureMock,
  generateNonce: generateNonceMock,
}));

const { sign } = await import("../utils/signing");

type MockWallet = {
  signData: jest.Mock<(payload: string, address?: string) => Promise<{ signature: string; key: string }>>;
  getRewardAddresses: jest.Mock<() => Promise<string[]>>;
};

function createWallet(overrides?: Partial<MockWallet>): MockWallet {
  return {
    signData: jest.fn<(payload: string, address?: string) => Promise<{ signature: string; key: string }>>(
      async () => ({ signature: "deadbeef", key: "cafe" }),
    ),
    getRewardAddresses: jest.fn<() => Promise<string[]>>(async () => ["stake_addr"]),
    ...overrides,
  } as MockWallet;
}

describe("sign", () => {
  beforeEach(() => {
    checkSignatureMock.mockReset();
    generateNonceMock.mockReset();
    generateNonceMock.mockReturnValue("nonce-payload");
  });

  it("role=0 signs with the user payment address and returns the signature", async () => {
    checkSignatureMock.mockResolvedValueOnce(true);
    const wallet = createWallet();
    const sig = await sign("payload", wallet as never, 0, "addr_test_user");
    expect(sig).toEqual({ signature: "deadbeef", key: "cafe" });
    expect(wallet.signData).toHaveBeenCalledWith("payload", "addr_test_user");
  });

  it("role=2 signs with the wallet's reward (stake) address", async () => {
    checkSignatureMock.mockResolvedValueOnce(true);
    const wallet = createWallet();
    await sign("payload", wallet as never, 2);
    expect(wallet.getRewardAddresses).toHaveBeenCalled();
    expect(wallet.signData).toHaveBeenCalledWith("payload", "stake_addr");
  });

  it("role=3 requires an explicit dRepAddress and uses it", async () => {
    checkSignatureMock.mockResolvedValueOnce(true);
    const wallet = createWallet();
    await sign("payload", wallet as never, 3, undefined, "drep_xxx");
    expect(wallet.signData).toHaveBeenCalledWith("payload", "drep_xxx");
  });

  it("throws when the chosen role has no resolved address", async () => {
    const wallet = createWallet();
    await expect(sign("payload", wallet as never, 0, undefined)).rejects.toThrow(
      /missing address/i,
    );
  });

  it("throws when checkSignature returns false (no silent ternary fallback)", async () => {
    checkSignatureMock.mockResolvedValueOnce(false);
    const wallet = createWallet();
    await expect(sign("payload", wallet as never, 0, "addr_test_user")).rejects.toThrow(
      /Signature failed verification/i,
    );
  });
});
