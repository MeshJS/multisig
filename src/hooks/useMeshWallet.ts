import { useEffect, useState } from "react";
import { useWallet } from "@meshsdk/react";
import { BrowserWallet, type IWallet } from "@meshsdk/core";

/**
 * Bridges @meshsdk/react 2.0's connection state to a @meshsdk/core 1.9 `IWallet`.
 *
 * react 2.0's `useWallet().wallet` is a lower-level CIP-30 `MeshCardanoBrowserWallet`
 * whose API is incompatible with the 1.9 `IWallet` this app is built on:
 *   - `signData(addressBech32, data)` has the arguments swapped vs 1.9's
 *     `signData(payload, address)` — both are `string`, so a wrong-order call would
 *     compile but sign the wrong bytes.
 *   - `signTx(tx, partialSign)` requires `partialSign`; `getUtxos()` returns `string[]`
 *     instead of `UTxO[]`; `getDRep()` / `getAssets()` / `getLovelace()` are gone.
 *
 * Re-enabling the connected wallet through the 1.9 `BrowserWallet` gives back the
 * exact 1.9 surface the signing/tx code expects, so no signing behaviour changes.
 * react 2.0 still owns connection state (name / connected); this only sources the
 * wallet instance used for signing and transaction building.
 */
export default function useMeshWallet() {
  const { name, connected } = useWallet();
  const [wallet, setWallet] = useState<IWallet | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (connected && name) {
      BrowserWallet.enable(name)
        .then((w) => {
          if (!cancelled) setWallet(w);
        })
        .catch(() => {
          if (!cancelled) setWallet(null);
        });
    } else {
      setWallet(null);
    }
    return () => {
      cancelled = true;
    };
  }, [connected, name]);

  return { wallet, connected, name };
}
