import RootLayout from "@/components/common/layout";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Link from "next/link";
import PageHeader from "@/components/common/page-header";
import useUserWallets from "@/hooks/useUserWallets";
import { Wallet } from "@/types/wallet";
import useWallet from "@/hooks/useWallet";
import {
  Activity,
  ArrowUpRight,
  CircleUser,
  CreditCard,
  DollarSign,
  Menu,
  Package2,
  Search,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import CardBalance from "./card-balance";
import { use, useEffect, useState } from "react";
import { getProvider } from "@/components/common/blockfrost";
import { UTxO } from "@meshsdk/core";

export default function Transactions({
  utxos,
  address,
}: {
  utxos: UTxO[];
  address: string;
}) {
  useEffect(() => {
    utxos = utxos.reverse().splice(0, 20);
    console.log(441, utxos);
  }, [utxos]);

  return (
    <Card className="xl:col-span-2 self-start">
      <CardHeader className="flex flex-row items-center">
        <div className="grid gap-2">
          <CardTitle>Transactions</CardTitle>
        </div>
        <Button asChild size="sm" className="ml-auto gap-1">
          <Link
            href={`https://preprod.cardanoscan.io/address/${address}`}
            target="_blank"
          >
            View All
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Address</TableHead>
              <TableHead className="text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell>
                <div className="font-medium">addr1123abc...123abc123abc123abc</div>
                <div className="text-sm text-muted-foreground md:inline">
                  2024-07-16
                </div>
              </TableCell>
              <TableCell className="text-right text-red-400">-₳ 250</TableCell>
            </TableRow>
            <TableRow>
              <TableCell>
                <div className="font-medium">addr1123abc...123abc123abc123abc</div>
                <div className="text-sm text-muted-foreground md:inline">
                  2024-07-01
                </div>
              </TableCell>
              <TableCell className="text-right text-green-400">+₳ 550</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
