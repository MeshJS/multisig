import dynamic from "next/dynamic";
import { Loader2, Wallet } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWalletRuntime } from "@/lib/wallet-runtime";

const ConnectWallet = dynamic(
  () => import("@/components/common/cardano-objects/connect-wallet"),
  { ssr: false, loading: () => null },
);

type Variant = "hero" | "compact";

/**
 * The wallet connector, wherever a page wants one — without making that page
 * carry the wallet runtime.
 *
 * Until the runtime is active this is a plain button that asks for it (and for
 * the picker to open once it is up). After that it is the real connector. On
 * a light public route this is what keeps the Cardano stack off the critical
 * path: a visitor who never connects never downloads it.
 */
export default function ConnectWalletSlot({
  variant = "hero",
}: {
  variant?: Variant;
}) {
  const active = useWalletRuntime((s) => s.active);
  const requested = useWalletRuntime((s) => s.requested);
  const request = useWalletRuntime((s) => s.request);

  if (active) return <ConnectWallet variant={variant} />;

  return (
    <Button
      variant="secondary"
      size={variant === "hero" ? "lg" : "default"}
      disabled={requested}
      onClick={() => request({ openConnect: true })}
      className={cn(
        "gap-2 rounded-full border border-zinc-200 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-50 dark:hover:bg-zinc-800",
        variant === "compact" && "h-auto px-4 py-2",
      )}
    >
      {requested ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Wallet className="h-4 w-4" />
      )}
      {requested ? "Loading wallets…" : "Connect wallet"}
    </Button>
  );
}
