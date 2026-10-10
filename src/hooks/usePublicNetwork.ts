import { useEffect, useState } from "react";
import useMeshWallet from "@/hooks/useMeshWallet";

/**
 * Network id (0 = preprod, 1 = mainnet) for public, no-login pages.
 *
 * Defaults to mainnet so anonymous visitors get data immediately; when a
 * wallet connects, switches to that wallet's network. Public explorers used
 * to park on a "not yet known" sentinel until a wallet reported its network,
 * which left visitors without a wallet on an endless spinner.
 */
export default function usePublicNetwork(): number {
  const { wallet, connected } = useMeshWallet();
  const [network, setNetwork] = useState<number>(1);

  useEffect(() => {
    let cancelled = false;
    if (connected && wallet) {
      wallet
        .getNetworkId()
        .then((net) => {
          if (!cancelled) setNetwork(net);
        })
        .catch((error) => {
          console.error("Error fetching network ID:", error);
          if (!cancelled) setNetwork(1);
        });
    } else {
      setNetwork(1);
    }
    return () => {
      cancelled = true;
    };
  }, [connected, wallet]);

  return network;
}
