import "@meshsdk/react/styles.css";

import { useEffect, type ReactNode } from "react";
import { MeshProvider } from "@meshsdk/react";

import RootLayout from "@/components/common/overall-layout/layout";
import { useWalletRuntime } from "@/lib/wallet-runtime";

/**
 * The wallet runtime: MeshProvider and the full wallet layout, with the
 * Cardano stack they bring. Loaded on demand by AppFrame (src/pages/_app.tsx)
 * and kept mounted once loaded — see src/lib/wallet-runtime.ts for when.
 */
export default function AppRuntime({ children }: { children: ReactNode }) {
  const markActive = useWalletRuntime((s) => s.markActive);
  useEffect(() => {
    markActive();
  }, [markActive]);

  return (
    <MeshProvider>
      <RootLayout>{children}</RootLayout>
    </MeshProvider>
  );
}
