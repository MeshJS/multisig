import dynamic from "next/dynamic";

import { Button } from "@/components/ui/button";
import { useWalletRuntime } from "@/lib/wallet-runtime";

const DelegateButton = dynamic(() => import("./delegateButton"), {
  ssr: false,
  loading: () => <Button disabled>Delegate</Button>,
});

/**
 * The DRep "Delegate" button without its cost for anonymous visitors.
 *
 * The real button needs a connected wallet and the transaction builder — the
 * whole Cardano stack, ~1.9 MB gzipped. Without a wallet it is disabled
 * anyway, so until the wallet runtime is active this renders the same
 * disabled button and downloads nothing. A lazy import on its own would not
 * do: it still fires right after hydration for every visitor.
 */
export default function DelegateSlot({ drepid }: { drepid: string }) {
  const active = useWalletRuntime((s) => s.active);
  if (!active) {
    return (
      <Button disabled title="Connect a wallet to delegate">
        Delegate
      </Button>
    );
  }
  return <DelegateButton drepid={drepid} />;
}
