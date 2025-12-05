import { env } from "@/env";
import { BlockfrostProvider, KoiosProvider } from "@meshsdk/core";

export function getProvider(network: number) {
  if (!env.NEXT_PUBLIC_GOV_TESTNET) {
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
    return new KoiosProvider(`${baseUrl}/api/koios`);
  }
  // Server-side: use direct Koios URL (no CORS issues)
  return new KoiosProvider("https://sancho.koios.rest/api/v1");
}
