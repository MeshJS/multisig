import { describe, expect, it, jest } from "@jest/globals";
import type { NextApiResponse } from "next";

// The wallet session is one signed JWT in one cookie, and every wallet the
// user authorizes is appended to it. Browsers silently drop a Set-Cookie whose
// name+value exceeds 4096 bytes, keeping the OLD cookie — so past ~25
// addresses a sign-in "succeeded" while the new wallet never reached the
// session. These tests pin the bound that keeps the cookie acceptable.

jest.mock("@/env", () => ({
  __esModule: true,
  env: { JWT_SECRET: "x".repeat(32), NODE_ENV: "production" },
}));

import {
  MAX_SESSION_WALLETS,
  addWalletToSession,
  setWalletSessionCookie,
} from "@/lib/auth/walletSession";

/** RFC 6265bis / browser limit on a cookie's name + value. */
const BROWSER_COOKIE_LIMIT = 4096;

// The longest address shape a session holds: a 108-char testnet base address
// (mainnet base addresses are 103).
const longAddress = (i: number) => `addr_test1qz${String(i).padStart(96, "x")}`;

describe("addWalletToSession", () => {
  it("starts a session with just the signed-in wallet", () => {
    expect(addWalletToSession(undefined, "a")).toEqual(["a"]);
    expect(addWalletToSession(null, "a")).toEqual(["a"]);
  });

  it("appends a new wallet after the ones already authorized", () => {
    expect(addWalletToSession(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  });

  it("moves a re-authorized wallet to the most-recent end instead of duplicating it", () => {
    expect(addWalletToSession(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]);
  });

  it("evicts the least recently authorized wallets beyond the cap", () => {
    const full = Array.from({ length: MAX_SESSION_WALLETS }, (_, i) => `w${i}`);
    const next = addWalletToSession(full, "new");
    expect(next).toHaveLength(MAX_SESSION_WALLETS);
    expect(next[0]).toBe("w1");
    expect(next.at(-1)).toBe("new");
  });

  it("trims an already oversized session (issued before the cap) back to the cap", () => {
    const legacy = Array.from({ length: 40 }, (_, i) => `w${i}`);
    const next = addWalletToSession(legacy, "new");
    expect(next).toHaveLength(MAX_SESSION_WALLETS);
    expect(next.at(-1)).toBe("new");
  });

  it("drops duplicates and non-string junk from a tampered-looking payload", () => {
    expect(addWalletToSession(["a", "a", 7, null, "b"], "c")).toEqual(["a", "b", "c"]);
  });
});

describe("setWalletSessionCookie", () => {
  it("stays under the browser cookie limit with a full session of the longest addresses", () => {
    const wallets = addWalletToSession(
      Array.from({ length: 50 }, (_, i) => longAddress(i)),
      longAddress(99),
    );
    const setHeader = jest.fn();
    setWalletSessionCookie({ setHeader } as unknown as NextApiResponse, {
      wallets,
      primaryWallet: wallets.at(-1),
    });

    const cookie = setHeader.mock.calls[0]![1] as string;
    const nameAndValue = cookie.split(";")[0]!;
    expect(nameAndValue.length).toBeLessThan(BROWSER_COOKIE_LIMIT);
  });
});
