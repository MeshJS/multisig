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
import budget from "../../scripts/bundle-budget.json";

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
      openConnect: null,
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

  it("holds every light route to its own bundle budget", () => {
    // Without a per-page entry a light route falls back to the wallet-route
    // budget, and a page that starts importing the Cardano stack would pass.
    const pages = budget.pages as Record<string, number>;
    for (const route of LIGHT_ROUTES) {
      if (["/404", "/500", "/_error"].includes(route)) continue;
      expect(pages[route]).toBeLessThanOrEqual(500);
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

  it("opens the picker once, at the connector that was clicked", () => {
    useWalletRuntime.getState().request({ openConnect: true, anchor: "cta" });
    expect(useWalletRuntime.getState().requested).toBe(true);
    // Another connector on the page (the hero) must not take the click.
    expect(useWalletRuntime.getState().consumeOpenConnect("hero")).toBe(false);
    expect(useWalletRuntime.getState().consumeOpenConnect("cta")).toBe(true);
    expect(useWalletRuntime.getState().consumeOpenConnect("cta")).toBe(false);
  });

  it("a background request (remembered wallet) does not open the picker", () => {
    useWalletRuntime.getState().request();
    expect(useWalletRuntime.getState().consumeOpenConnect("default")).toBe(
      false,
    );
  });
});
