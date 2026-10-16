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

/** Load the real SDK once; later calls share the same promise. */
export function loadUtxosSdk(): Promise<typeof Real> {
  // The specifier is an alias defined in next.config.js, so TypeScript cannot
  // resolve it; the cast restores the real module's type.
  loading ??= import(
    /* webpackChunkName: "utxos-sdk" */ "@utxos/sdk-real" as string
  ) as Promise<typeof Real>;
  return loading;
}

export const Web3Wallet = {
  async enable(
    ...args: Parameters<typeof Real.Web3Wallet.enable>
  ): ReturnType<typeof Real.Web3Wallet.enable> {
    const sdk = await loadUtxosSdk();
    return sdk.Web3Wallet.enable(...args);
  },
};
