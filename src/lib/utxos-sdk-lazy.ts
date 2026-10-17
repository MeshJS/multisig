/**
 * Client-side stand-in for `@utxos/sdk`.
 *
 * The real SDK embeds the Spark/FROST WASM as base64 strings — about 15 MB of
 * JavaScript — and `@meshsdk/react` imports it statically for one call,
 * `Web3Wallet.enable`, behind its "UTXOS" wallet button. Imported normally,
 * every page shipped those 15 MB in the shared `_app` bundle before rendering
 * anything.
 *
 * next.config.js aliases `@utxos/sdk` to this file for browser builds, so every
 * importer (ours and `@meshsdk/react`'s) gets a `Web3Wallet` whose `enable`
 * loads the real SDK on first use. The real module stays reachable under the
 * `@utxos/sdk-real` alias; the server build is not aliased at all.
 *
 * Only the static `enable` is proxied — it is the only entry point either
 * importer uses; everything else is reached through the instance it returns.
 * Types come from the real package.
 */

import type * as Real from "@utxos/sdk";

export type * from "@utxos/sdk";

let loading: Promise<typeof Real> | null = null;
let loaded = false;

/**
 * Load the real SDK once; later calls share the same promise. A failed load is
 * forgotten so the next attempt retries instead of replaying the failure.
 */
export function loadUtxosSdk(): Promise<typeof Real> {
  // The specifier is an alias defined in next.config.js, so TypeScript cannot
  // resolve it; the cast restores the real module's type.
  loading ??= (
    import(
      /* webpackChunkName: "utxos-sdk" */ "@utxos/sdk-real" as string
    ) as Promise<typeof Real>
  ).then(
    (sdk) => {
      loaded = true;
      return sdk;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** Whether `Web3Wallet.enable` can run without a download first. */
export function isUtxosSdkLoaded(): boolean {
  return loaded;
}

/**
 * Start the download ahead of the click that needs it. `enable` opens a
 * sign-in popup, and browsers only allow that within a few seconds of the
 * user's click — the ~7 MB gzipped SDK can take longer than that to arrive.
 * Call this as soon as a UTXOS option is on screen or about to be.
 */
export function preloadUtxosSdk(): void {
  void loadUtxosSdk().catch(() => {
    // Preloading is best-effort; `enable` reports a real failure.
  });
}

export const Web3Wallet = {
  async enable(
    ...args: Parameters<typeof Real.Web3Wallet.enable>
  ): ReturnType<typeof Real.Web3Wallet.enable> {
    const sdk = await loadUtxosSdk();
    return sdk.Web3Wallet.enable(...args);
  },
};
