import Link from "next/link";
import { useRouter } from "next/router";
import { FileSignature, Shield } from "lucide-react";

import VaultBrowser from "@/components/pages/vault/browser";
import { EmptyState } from "@/components/common/empty-state";
import PageHeader from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import type { VaultTrustView } from "@/lib/vault-trust-types";

/**
 * Shielded sign-off, shown inside Documents as a working preview.
 *
 * The content is Mesh Multisig's OWN feature vault, not this wallet's documents,
 * and the copy says so plainly — a demo that lets someone believe they are
 * looking at their own records would be worse than no demo. What it does show
 * honestly is the mechanism they would get: a vault of linked Markdown where
 * every trust edge commits to a hash, so a single document can be proved to
 * belong without revealing the ones beside it.
 *
 * This reuses `VaultBrowser` exactly as the public /vault page does — it takes
 * one `view` prop and owns all its state — so there is one implementation of
 * the browser, not a second one that drifts.
 */
export default function PageDocumentsVaultPreview({
  view,
}: {
  view: VaultTrustView | null;
}) {
  const router = useRouter();
  const walletId = router.query.wallet as string;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8">
      <PageHeader
        pageTitle="Shielded sign-off preview"
        backUrl={`/wallets/${walletId}/documents`}
      >
        <Button asChild size="sm" variant="outline">
          <Link href={`/wallets/${walletId}/documents`}>
            <FileSignature className="mr-2 h-4 w-4" />
            Your documents
          </Link>
        </Button>
      </PageHeader>

      <div className="max-w-3xl space-y-3 text-sm text-muted-foreground">
        <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3">
          <Shield className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong className="font-medium text-foreground">
              This is Mesh Multisig&apos;s own feature vault, not your
              documents.
            </strong>{" "}
            It is real content with real hashes, shown so you can see how
            shielded sign-off behaves before it holds anything of yours.
          </span>
        </p>
        <p>
          Today a document is signed on its own: one file, one hash, one round
          of approvals. A vault adds the relationships between them. Every trust
          edge commits to the hash of what it points at, so signing the root
          binds the whole structure underneath it.
        </p>
        <p>
          That is what makes selective disclosure possible. Pick any note and
          the panel on the right shows the path a proof of it would reveal — and
          the documents it would keep sealed, present only as hashes. A
          counterparty can verify that one policy belongs to your governance
          spine without learning what else is in it.
        </p>
      </div>

      {view ? (
        <VaultBrowser view={view} />
      ) : (
        <EmptyState
          icon={Shield}
          title="Preview unavailable"
          description="The demo vault could not be loaded. Your documents are unaffected — this panel is illustrative content only."
          action={
            <Button asChild size="sm" variant="outline">
              <Link href={`/wallets/${walletId}/documents`}>
                Back to documents
              </Link>
            </Button>
          }
        />
      )}
    </main>
  );
}
