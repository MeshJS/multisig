import RootLayout from "@/components/common/layout";
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

export default function PageWallets() {
  return (
    <RootLayout>
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
              <TableHead>Status</TableHead>
              <TableHead className="hidden md:table-cell">Price</TableHead>
              <TableHead className="hidden md:table-cell">
                Total Sales
              </TableHead>
              <TableHead className="hidden md:table-cell">Created at</TableHead>
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <Row />
            <Row />
            <Row />
            <Row />
            <Row />
          </TableBody>
        </Table>
      </>
    </RootLayout>
  );
}
