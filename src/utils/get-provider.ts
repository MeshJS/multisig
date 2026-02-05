import { env } from "@/env";
import { BlockfrostProvider, KoiosProvider } from "@meshsdk/core";

export function getProvider(network: number) {
  // Check if GOV_TESTNET is enabled
  const isGovTestnet = env.NEXT_PUBLIC_GOV_TESTNET === true || env.NEXT_PUBLIC_GOV_TESTNET === "true";
  
  console.log("[getProvider] Configuration:", {
    network,
    NEXT_PUBLIC_GOV_TESTNET: env.NEXT_PUBLIC_GOV_TESTNET,
    isGovTestnet,
    isClient: typeof window !== "undefined",
  });

  if (!isGovTestnet) {
    return new BlockfrostProvider(
      network == 0
        ? env.NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD
        : env.NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET,
    );
  }

  // Use proxy API route to avoid CORS issues on client-side
  if (typeof window !== "undefined") {
    // Client-side: use full URL to proxy (relative URLs might not work with Mesh SDK)
    const baseUrl = window.location.origin;
    const koiosUrl = `${baseUrl}/api/koios`;
    console.log("[getProvider] Using KoiosProvider (client-side):", koiosUrl);
    return new KoiosProvider(koiosUrl);
  }
  // Server-side: use network constructor to avoid Authorization header
  console.log("[getProvider] Using KoiosProvider (server-side): sancho");
  return new KoiosProvider("sancho");
}
