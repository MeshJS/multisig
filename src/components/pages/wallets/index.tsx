import { Button } from "@/components/ui/button";
import Link from "next/link";
import PageHeader from "@/components/common/page-header";
import useUserWallets from "@/hooks/useUserWallets";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { getFirstAndLast } from "@/lib/strings";

export default function PageWallets() {
  const { wallets } = useUserWallets();

  return (
    <>
      <>
        <PageHeader pageTitle="Wallets">
          <Button size="sm" asChild>
            <Link href="/wallets/new-wallet">New Wallet</Link>
          </Button>
        </PageHeader>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {wallets &&
            wallets.map((wallet) => (
              <CardWallet key={wallet.id} wallet={wallet as Wallet} />
            ))}
        </div>
      </>
    </>
  );
}

function CardWallet({ wallet }: { wallet: Wallet }) {
  return (
    <Link href={`/wallets/${wallet.id}`}>
      <CardUI
        title={wallet.name}
        description={wallet.description}
        cardClassName=""
      >
        <RowLabelInfo
          label="Address"
          value={getFirstAndLast(wallet.address)}
          copyString={wallet.address}
        />
        <RowLabelInfo
          label="DRep ID"
          value={getFirstAndLast(wallet.dRepId)}
          copyString={wallet.dRepId}
        />
      </CardUI>
    </Link>
  );
}
