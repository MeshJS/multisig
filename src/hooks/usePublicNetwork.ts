import { useSiteStore } from "@/lib/zustand/site";
import { useUserStore } from "@/lib/zustand/user";

/**
 * Network id (0 = preprod, 1 = mainnet) for public, no-login pages.
 *
 * Defaults to mainnet so anonymous visitors get data immediately; when a
 * wallet is connected, follows that wallet's network. Public explorers used to
 * park on a "not yet known" sentinel until a wallet reported its network,
 * which left visitors without a wallet on an endless spinner.
 *
 * Reads the stores rather than the wallet: the connector already syncs the
 * wallet's network into the site store, and asking the wallet directly made
 * every public page that used this import the whole Mesh wallet stack.
 */
export default function usePublicNetwork(): number {
  const connectedAddress = useUserStore((state) => state.userAddress);
  const walletNetwork = useSiteStore((state) => state.network);
  return connectedAddress ? walletNetwork : 1;
}
