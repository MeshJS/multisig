import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/ui/card-content";
import Code from "@/components/ui/code";
import { useToast } from "@/hooks/use-toast";
import useTransaction from "@/hooks/useTransaction";
import useWalletRegistration from "@/hooks/useWalletRegistration";
import { useSiteStore } from "@/lib/zustand/site";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { Wallet } from "@/types/wallet";
import { api } from "@/utils/api";
import {
  buildLabel1854Metadata,
  isRegistrationUpToDate,
} from "@/utils/cip146Registration";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { MultisigWallet } from "@/utils/multisigSDK";

export const REGISTRATION_TX_DESCRIPTION = "CIP-0146 wallet registration";

/** Minimum lovelace on the spent UTxO to comfortably cover fee + min-ADA change. */
const MIN_REGISTRATION_LOVELACE = 2_000_000;

/**
 * CIP-0146 on-chain registration card.
 *
 * Registration is a self-spend from the multisig wallet carrying label
 * 1854 metadata. Spending a wallet UTxO also satisfies CIP-0146 update
 * semantics (a later self-spend with new 1854 metadata supersedes the
 * old one) and exposes the native script on-chain, which the discovery
 * flow relies on to reconstruct the wallet exactly.
 */
export function RegisterWallet({
  appWallet,
  mWallet,
}: {
  appWallet: Wallet;
  mWallet?: MultisigWallet;
}) {
  const { toast } = useToast();
  const { newTransaction } = useTransaction();
  const network = useSiteStore((state) => state.network);
  const setLoading = useSiteStore((state) => state.setLoading);
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const [busy, setBusy] = useState(false);

  const { isRegistered, registrations, isLoading } =
    useWalletRegistration(mWallet);

  const { data: pendingTransactions } =
    api.transaction.getPendingTransactions.useQuery(
      { walletId: appWallet.id },
      { enabled: !!appWallet.id },
    );

  if (!mWallet) return null;

  const utxos = walletsUtxos[appWallet.id] ?? [];
  const lovelaceOf = (utxo: (typeof utxos)[number]) =>
    Number(
      utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? 0,
    );
  // Prefer a pure-lovelace UTxO (keeps native assets out of the
  // self-spend); fall back to any sufficiently funded UTxO — change
  // returns everything to the wallet address anyway.
  const candidateUtxos = utxos.filter(
    (u) => lovelaceOf(u) >= MIN_REGISTRATION_LOVELACE,
  );
  const pureLovelace = candidateUtxos.filter(
    (u) => u.output.amount.length === 1,
  );
  const spendUtxo =
    [...pureLovelace].sort((a, b) => lovelaceOf(a) - lovelaceOf(b))[0] ??
    [...candidateUtxos].sort((a, b) => lovelaceOf(a) - lovelaceOf(b))[0];

  const hasPendingRegistration = pendingTransactions?.some(
    (tx) => tx.description === REGISTRATION_TX_DESCRIPTION,
  );

  const latestRegistration = registrations[registrations.length - 1];
  const upToDate = latestRegistration
    ? isRegistrationUpToDate(latestRegistration, mWallet)
    : false;

  async function createRegistrationTransaction() {
    if (!mWallet || !appWallet.scriptCbor || !spendUtxo) return;
    setBusy(true);
    setLoading(true);
    try {
      const txBuilder = await getTxBuilder(network);
      txBuilder
        .txIn(
          spendUtxo.input.txHash,
          spendUtxo.input.outputIndex,
          spendUtxo.output.amount,
          spendUtxo.output.address,
        )
        .txInScript(appWallet.scriptCbor)
        // Attach the 1854 payload directly on the builder — do NOT use
        // newTransaction's metadataValue param, which wraps values in a
        // CIP-674 style { msg } object and would break the CIP-0146 shape.
        .metadataValue("1854", buildLabel1854Metadata(mWallet))
        .changeAddress(appWallet.address);

      await newTransaction({
        txBuilder,
        description: REGISTRATION_TX_DESCRIPTION,
        toastMessage:
          "Registration transaction created — once enough signers approve, it will be submitted on-chain.",
      });
    } catch (error) {
      console.error("Failed to create registration transaction:", error);
      setLoading(false);
      toast({
        title: "Registration failed",
        description:
          error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <CardUI
      title="Register Wallet"
      description="Register your wallet on-chain through a CIP-0146 registration transaction, so co-signers can discover and import it."
      cardClassName="col-span-2"
      headerDom={
        isRegistered ? (
          <Badge
            variant="outline"
            className="bg-green-400/10 border-green-400/30 text-green-600 dark:text-green-300"
          >
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Registered
          </Badge>
        ) : undefined
      }
    >
      {isLoading ? (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking on-chain registration…
        </div>
      ) : hasPendingRegistration ? (
        <div className="p-4 bg-muted/50 rounded-lg border border-border/30 space-y-2">
          <p className="text-sm text-muted-foreground">
            A registration transaction is awaiting signatures.
          </p>
          <Link
            href={`/wallets/${appWallet.id}/transactions`}
            className="text-sm font-medium underline underline-offset-4"
          >
            Review pending transactions
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {isRegistered && latestRegistration && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>
                This wallet is registered on-chain
                {upToDate
                  ? " and the registration is up to date."
                  : ", but its metadata has changed since."}
              </span>
              <Link
                href={`https://${network === 0 ? "preprod." : ""}cardanoscan.io/transaction/${latestRegistration.tx_hash}`}
                target="_blank"
                className="inline-flex items-center gap-1 font-medium underline underline-offset-4"
              >
                View registration
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          )}

          {(!isRegistered || !upToDate) && (
            <>
              <div className="overflow-x-auto">
                <Code className="block text-xs sm:text-sm whitespace-pre">
                  {JSON.stringify(buildLabel1854Metadata(mWallet), null, 2)}
                </Code>
              </div>
              {!spendUtxo && (
                <p className="text-sm text-muted-foreground">
                  Fund the wallet first — registration is an on-chain
                  transaction paid from the wallet and needs a UTxO of at
                  least 2 ADA.
                </p>
              )}
              <Button
                onClick={() => void createRegistrationTransaction()}
                disabled={busy || !spendUtxo || !appWallet.scriptCbor}
              >
                {busy
                  ? "Creating transaction…"
                  : isRegistered
                    ? "Update Registration"
                    : "Register Wallet"}
              </Button>
            </>
          )}
        </div>
      )}
    </CardUI>
  );
}
