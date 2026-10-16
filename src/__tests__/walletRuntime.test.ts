import { beforeEach, describe, expect, it } from "@jest/globals";

// The suite runs in node; give the module the one browser API it reads.
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    clear: () => store.clear(),
  },
};

import {
  LIGHT_ROUTES,
  hasRememberedWallet,
  isLightRoute,
  useWalletRuntime,
} from "@/lib/wallet-runtime";
import { publicRoutes } from "@/data/public-routes";

/**
 * When the wallet runtime loads decides both how fast public pages are and
 * whether a returning user looks signed in. These pin the policy.
 */
describe("wallet runtime policy", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useWalletRuntime.setState({
      requested: false,
      active: false,
      openConnect: false,
    });
  });

  it("treats only wallet-free routes as light", () => {
    expect(isLightRoute("/")).toBe(true);
    expect(isLightRoute("/verify")).toBe(true);
    expect(isLightRoute("/wallets/[wallet]")).toBe(false);
    expect(isLightRoute("/api-docs")).toBe(false); // signs a bearer token
    expect(isLightRoute("/dapps")).toBe(false);
  });

  it("never makes a private route light", () => {
    const allowedExtras = new Set(["/404", "/500", "/_error"]);
    for (const route of LIGHT_ROUTES) {
      if (allowedExtras.has(route)) continue;
      expect(publicRoutes).toContain(route);
    }
  });

  it("restores a remembered browser wallet, but not a UTXOS session", () => {
    expect(hasRememberedWallet()).toBe(false);
    window.localStorage.setItem(
      "mesh-wallet-persist",
      JSON.stringify({ walletName: "eternl" }),
    );
    expect(hasRememberedWallet()).toBe(true);
    // Mesh discards a remembered UTXOS session instead of restoring it.
    window.localStorage.setItem(
      "mesh-wallet-persist",
      JSON.stringify({ walletName: "utxos" }),
    );
    expect(hasRememberedWallet()).toBe(false);
    window.localStorage.setItem("mesh-wallet-persist", "{not json");
    expect(hasRememberedWallet()).toBe(false);
  });

  it("opens the picker once after a connect request, not on every mount", () => {
    const store = useWalletRuntime.getState();
    store.request({ openConnect: true });
    expect(useWalletRuntime.getState().requested).toBe(true);
    expect(useWalletRuntime.getState().consumeOpenConnect()).toBe(true);
    expect(useWalletRuntime.getState().consumeOpenConnect()).toBe(false);
  });

  it("a background request (remembered wallet) does not open the picker", () => {
    useWalletRuntime.getState().request();
    expect(useWalletRuntime.getState().consumeOpenConnect()).toBe(false);
  });
});
