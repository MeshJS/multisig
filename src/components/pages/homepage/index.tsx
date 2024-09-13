import Image from "next/image";
import ConnectWallet from "@/components/common/connect-wallet";
import { useUserStore } from "@/lib/zustand/user";
import { Button } from "@/components/ui/button";
import Link from "next/link";

export function PageHomepage() {
  const userAddress = useUserStore((state) => state.userAddress);

  return (
    <div className="h-screen w-full lg:grid lg:grid-cols-2">
      <div className="flex items-center justify-center py-12">
        <div className="mx-auto grid w-[600px] gap-6">
          <div className="grid gap-2 text-center">
            <h1 className="text-3xl font-bold">Multisig platform on Cardano</h1>
            <p className="text-balance text-muted-foreground">
              Secure your treasury and participant in Cardano governance as a
              team with multi-signature wallet
            </p>
          </div>
          <div className="flex items-center justify-center">
            {userAddress ? (
              <Button size="sm" asChild>
                <Link href="/wallets/new-wallet">New Wallet</Link>
              </Button>
            ) : (
              <ConnectWallet />
            )}
          </div>
        </div>
      </div>
      <div className="hidden bg-muted lg:block">
        <Image
          src="/welcome-hero.webp"
          alt="Image"
          width="1080"
          height="1080"
          className="h-full w-full object-cover"
        />
      </div>
    </div>
  );
}
