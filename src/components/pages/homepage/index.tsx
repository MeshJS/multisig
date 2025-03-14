import ConnectWallet from "@/components/common/cardano-objects/connect-wallet";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import useUser from "@/hooks/useUser";
import { useRouter } from "next/router";
import { api } from "@/utils/api";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import Globe from "./globe";
import KeyGenerator from "./wallets/invite/cip146/146Wallet";

export function PageHomepage() {
  const { user } = useUser();
  const router = useRouter();
  const pathIsNewWallet = router.pathname == "/wallets/invite/[id]";
  const newWalletId = pathIsNewWallet ? (router.query.id as string) : undefined;

  const { data: newWallet } = api.wallet.getNewWallet.useQuery(
    { walletId: newWalletId! },
    {
      enabled: pathIsNewWallet && newWalletId !== undefined,
    },
  );

  return (
  <div className="relative min-h-screen w-full lg:grid lg:grid-cols-3">
      <div className="absolute inset-0 -z-10 flex justify-center items-center">
    <Globe />
  </div>
      <div className="flex items-center justify-center py-12 relative z-10">
        <div className="mx-auto grid max-w-[500px] gap-6">
          <div className="grid gap-2 text-center">
            <h1 className="text-3xl font-bold">Multisig Platform</h1>
            <p className="text-balance text-muted-foreground">
              Secure your treasury and participant in governance, as a team with
              multi-signature
            </p>
            {newWallet && (
              <CardUI
                title={`Invited as signer`}
                description={`You have been invited to join this wallet as a signer, connect your wallet to accept the invitation`}
                cardClassName="text-left mt-4"
              >
                <RowLabelInfo label="Wallet Name" value={newWallet.name} />
                {newWallet.description && (<RowLabelInfo label="About" value={newWallet.description} />)}
              </CardUI>
            )}
            {newWallet && (
              <KeyGenerator/>
            )}
          </div>
          <div className="flex items-center justify-center">
            {user ? (
              <div className="flex gap-2">
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
    </div>
  );
}
