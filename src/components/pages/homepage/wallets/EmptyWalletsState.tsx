import Link from "next/link";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/common/card-content";

export default function EmptyWalletsState() {
  return (
    <div className="col-span-full">
      <CardUI
        title="Create or import your first wallet"
        description=""
        cardClassName=""
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Create a shared wallet with your team and choose who can approve
            transactions, or import a wallet your team already uses.
          </p>

          <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:items-center">
            <Button asChild size="lg">
              <Link prefetch={false} href="/wallets/new-wallet-flow/save">
                Create Your First Wallet
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link prefetch={false} href="/wallets/import-wallet">
                Import existing wallet
              </Link>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            New to multisig?{" "}
            <Link
              href="/getting-started"
              className="underline underline-offset-4"
            >
              Read the getting started guide
            </Link>
            .
          </p>
        </div>
      </CardUI>
    </div>
  );
}
