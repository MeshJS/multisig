import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Row from "./row";
import Link from "next/link";
import PageHeader from "@/components/common/page-header";
import useUserWallets from "@/hooks/useUserWallets";
import { Wallet } from "@/types/wallet";

export default function PageWallets() {
  const { wallets, isLoading } = useUserWallets();

  return (
    <>
      <>
        <PageHeader pageTitle="Wallets">
          <Button size="sm" asChild>
            <Link href="/wallets/new-wallet">New Wallet</Link>
          </Button>
        </PageHeader>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Address</TableHead>
              <TableHead>dRepID</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {wallets &&
              wallets.map((wallet) => (
                <Row key={wallet.id} wallet={wallet as Wallet} />
              ))}
          </TableBody>
        </Table>
      </>
    </>
  );
}
