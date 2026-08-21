import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

import type { WalletImportFlowState } from "../shared/useWalletImportFlowState";

interface Props {
  flow: WalletImportFlowState;
}

export default function ReadyStep({ flow }: Props) {
  const walletId = flow.createdWalletId;
  return (
    <>
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <CardTitle className="text-base sm:text-lg">
            Wallet imported
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
          <div className="flex items-start gap-3 rounded-lg border border-muted-foreground/20 bg-muted/50 p-3 sm:p-4">
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600 dark:text-green-400" />
            <div className="space-y-1">
              <p className="text-sm font-medium">
                Your imported wallet is ready to use.
              </p>
              <p className="text-sm text-muted-foreground">
                It resolves to the same on-chain address as the source —
                balances, transactions, and governance state are derived
                from chain on demand.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button asChild variant="outline" className="w-full sm:w-auto">
          <Link href="/wallets">View All Wallets</Link>
        </Button>
        {walletId && (
          <Button asChild className="w-full sm:w-auto">
            <Link href={`/wallets/${walletId}`}>Go to Wallet</Link>
          </Button>
        )}
      </div>
    </>
  );
}
