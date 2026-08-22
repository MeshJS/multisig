import Link from "next/link";
import { useRouter } from "next/router";
import { FileSignature, Plus, Shield } from "lucide-react";

import { api } from "@/utils/api";
import useAppWallet from "@/hooks/useAppWallet";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import PageHeader from "@/components/ui/page-header";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";
import DocumentStatusBadge from "./status-badge";

/**
 * Documents list — the status-scan view. A signer opening this page should be
 * able to tell in one pass which documents are waiting on them.
 */
export default function PageDocuments() {
  const router = useRouter();
  const walletId = router.query.wallet as string;
  const { appWallet } = useAppWallet();

  const { data: documents, isLoading } = api.document.listByWallet.useQuery(
    { walletId },
    { enabled: !!walletId },
  );

  if (appWallet === undefined) return <WalletDetailSkeleton />;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8">
      <PageHeader pageTitle="Documents" backUrl={`/wallets/${walletId}`}>
        <Button asChild size="sm" variant="outline">
          <Link href={`/wallets/${walletId}/documents/preview`}>
            <Shield className="mr-2 h-4 w-4" />
            Shielded sign-off
          </Link>
        </Button>
        <Button asChild size="sm">
          <Link href={`/wallets/${walletId}/documents/new`}>
            <Plus className="mr-2 h-4 w-4" />
            New document
          </Link>
        </Button>
      </PageHeader>

      <p className="max-w-3xl text-sm text-muted-foreground">
        Approvals are bound to an exact version hash and inherit this
        wallet&apos;s signers and threshold. Uploading a new version starts a
        fresh round at zero approvals.
      </p>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && (documents?.length ?? 0) === 0 && (
        <EmptyState
          icon={FileSignature}
          title="No documents yet"
          description="Create a document to collect threshold sign-off from this wallet's signers."
          action={
            <Button asChild size="sm">
              <Link href={`/wallets/${walletId}/documents/new`}>
                New document
              </Link>
            </Button>
          }
        />
      )}

      <div className="flex flex-col gap-3">
        {documents?.map((doc) => {
          const latest = doc.versions[0];
          const approvals =
            latest?.reviews.filter((r) => r.action === "approve").length ?? 0;
          const required = latest?.signerSnapshot?.requiredSigners;

          return (
            <Link
              key={doc.id}
              href={`/wallets/${walletId}/documents/${doc.id}`}
              className="block"
            >
              <Card className="transition-colors hover:border-foreground/20">
                <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{doc.title}</span>
                      <DocumentStatusBadge status={doc.status} />
                    </div>
                    {doc.description && (
                      <p className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                        {doc.description}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-sm text-muted-foreground">
                    {latest ? (
                      <>
                        v{latest.versionNumber}
                        {required !== undefined && (
                          <>
                            {" "}
                            · {approvals}/{required} approvals
                          </>
                        )}
                      </>
                    ) : (
                      "No version yet"
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
    </main>
  );
}
