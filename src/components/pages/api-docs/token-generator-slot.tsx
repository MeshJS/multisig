import dynamic from "next/dynamic";
import type { MutableRefObject } from "react";

import { useWalletRuntime } from "@/lib/wallet-runtime";
import ConnectHint from "./connect-hint";
import type { SwaggerSystem } from "./token-generator";

const TokenGenerator = dynamic(() => import("./token-generator"), {
  ssr: false,
  loading: () => <ConnectHint />,
});

/**
 * The /api-docs token generator without its cost for readers.
 *
 * Generating a token needs a connected wallet, and the wallet bridge brings
 * the whole Cardano stack (~1.8 MB gzipped). Most visitors only read the API
 * reference, and without a wallet the control is a hint anyway — so until the
 * wallet runtime is active (a remembered wallet, or the visitor pressing
 * Connect in the header) this renders that hint and downloads nothing. The
 * same pattern as DelegateSlot on the DRep pages.
 */
export default function TokenGeneratorSlot({
  swaggerSystemRef,
}: {
  swaggerSystemRef: MutableRefObject<SwaggerSystem | null>;
}) {
  const active = useWalletRuntime((s) => s.active);
  if (!active) return <ConnectHint />;
  return <TokenGenerator swaggerSystemRef={swaggerSystemRef} />;
}
