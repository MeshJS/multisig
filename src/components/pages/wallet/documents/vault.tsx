import Link from "next/link";
import { useRouter } from "next/router";
import { FileSignature, Shield } from "lucide-react";

import VaultBrowser from "@/components/pages/vault/browser";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import PageHeader from "@/components/ui/page-header";
import useAppWallet from "@/hooks/useAppWallet";
import { api } from "@/utils/api";

/**
 * This wallet's own documents, as a vault.
 *
 * The demo at /vault answers "what would shielded sign-off look like" using
 * this repo's own notes. This is the same browser over the team's real
 * documents, which is the part that was missing: there was no path from seeing
 * the idea to having one.
 */
export default function PageWalletVault() {
  const router = useRouter();
  const walletId = router.query.wallet as string;
  const { appWallet } = useAppWallet();

  const { data: view, isLoading } = api.document.vaultView.useQuery(
    { walletId },
    { enabled: !!walletId },
  );

  if (appWallet === undefined || isLoading) return <WalletDetailSkeleton />;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8">
      <PageHeader pageTitle="Vault" backUrl={`/wallets/${walletId}/documents`}>
        <Button asChild size="sm" variant="outline">
          <Link href={`/wallets/${walletId}/documents`}>
            <FileSignature className="mr-2 h-4 w-4" />
            Documents
          </Link>
        </Button>
      </PageHeader>

      {!view || view.notes.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No documents to commit to yet"
          description="Your vault is built from this wallet's documents, grouped by their type. Create a document and it appears here, with its own hash under its type's hub."
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button asChild size="sm">
                <Link href={`/wallets/${walletId}/documents/new`}>
                  New document
                </Link>
              </Button>
              <Button asChild size="sm" variant="outline">
                <Link href={`/wallets/${walletId}/documents/preview`}>
                  See how it works
                </Link>
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="max-w-3xl space-y-3 text-sm text-muted-foreground">
            <p>
              Every document sits under its type, and every trust edge commits
              to the hash of what it points at — so one signature over the root
              binds this whole structure. Document types act as proxy hubs: you
              can prove a policy belongs to your governance spine without
              revealing what else is in the vault.
            </p>
            <p className="font-mono text-xs">
              root {view.rootHash.slice(0, 32)}… · {view.hubs.length} hubs ·{" "}
              {view.notes.length - view.hubs.length} documents
            </p>
          </div>
          <VaultBrowser view={view} />
        </>
      )}
    </main>
  );
}
