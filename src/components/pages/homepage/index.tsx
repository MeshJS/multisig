import ConnectWallet from "@/components/common/cardano-objects/connect-wallet";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import useUser from "@/hooks/useUser";
import { useRouter } from "next/router";
import { api } from "@/utils/api";
import Globe from "./globe";
import PageNewWalletInvite from "./wallets/invite";

export function PageHomepage() {
  const { user } = useUser();
  const router = useRouter();
  const pathIsNewWallet = router.pathname === "/wallets/invite/[id]";
  const newWalletId = pathIsNewWallet ? (router.query.id as string) : undefined;

  const { data: newWallet } = api.wallet.getNewWallet.useQuery(
    { walletId: newWalletId! },
    {
      enabled: pathIsNewWallet && newWalletId !== undefined,
    },
  );

  return (
    <div className="relative min-h-screen">
      {/* Background Globe */}
      <div className="absolute inset-0 -z-10 flex items-center justify-center">
        <Globe />
      </div>

      {newWallet ? (
        /* Render the invite page if a new wallet is found */
        <PageNewWalletInvite />
      ) : (
        /* Otherwise show the homepage */
        <div className="container mx-auto px-4 py-8 relative z-10 flex flex-col items-center justify-center">
          <div className="mx-auto grid max-w-[500px] gap-6 text-center">
            <h1 className="text-3xl font-bold">Multisig Platform</h1>
            <p className="text-balance text-muted-foreground">
              Secure your treasury and participate in governance as a team with multi-signature
            </p>

            <div>
              {user ? (
                <div className="flex gap-2 justify-center">
                  <Button size="sm" asChild>
                    <Link href="/wallets/new-wallet">New Wallet</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link href="/wallets">Your Wallets</Link>
                  </Button>
                </div>
              ) : (
                <ConnectWallet />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}