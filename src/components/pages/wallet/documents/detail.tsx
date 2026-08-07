import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Download, PlayCircle, Upload } from "lucide-react";

import { api } from "@/utils/api";
import useAppWallet from "@/hooks/useAppWallet";
import { toastError } from "@/utils/toast-error";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import PageHeader from "@/components/ui/page-header";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";
import DocumentStatusBadge from "./status-badge";
import { sha256HexFromFile } from "./hash-file";

/**
 * Document detail — lifecycle, version history, who approved, who is missing.
 *
 * "Missing signers" is computed against the version's frozen snapshot, not the
 * live wallet, so the list stays truthful even after the wallet's membership
 * changes.
 */
export default function PageDocumentDetail() {
  const router = useRouter();
  const walletId = router.query.wallet as string;
  const documentId = router.query.documentId as string;
  const { appWallet } = useAppWallet();
  const [uploading, setUploading] = useState(false);

  const utils = api.useUtils();
  const { data: document, isLoading } = api.document.getById.useQuery(
    { documentId },
    { enabled: !!documentId },
  );

  const refresh = async () => {
    await utils.document.getById.invalidate({ documentId });
    await utils.document.listByWallet.invalidate({ walletId });
  };

  const startReview = api.document.startReview.useMutation({
    onSuccess: async () => {
      await refresh();
      toast({ title: "Review round started" });
    },
    onError: (error) => toastError(error, "Could not start the review"),
  });

  const uploadVersion = api.document.uploadVersion.useMutation({
    onSuccess: async () => {
      await refresh();
      toast({
        title: "New version uploaded",
        description: "Approvals were reset — this version starts at zero.",
      });
    },
    onError: (error) => toastError(error, "Could not upload the version"),
  });

  const exportProof = api.document.exportProof.useMutation({
    onSuccess: (proof) => {
      const blob = new Blob([JSON.stringify(proof, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `signoff-proof-${proof.document.id}-v${proof.version.versionNumber}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    onError: (error) => toastError(error, "Could not export the proof"),
  });

  async function onUploadFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    try {
      uploadVersion.mutate({
        documentId,
        contentHash: await sha256HexFromFile(file),
        fileName: file.name,
        mimeType: file.type || undefined,
        fileSize: file.size,
        storageMode: "hashOnly",
      });
    } catch (error) {
      toastError(error, "Could not hash that file");
    } finally {
      setUploading(false);
    }
  }

  if (appWallet === undefined || isLoading) return <WalletDetailSkeleton />;
  if (!document) {
    return (
      <main className="mx-auto w-full max-w-5xl p-8">
        <p className="text-sm text-muted-foreground">Document not found.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8">
      <PageHeader
        pageTitle={document.title}
        backUrl={`/wallets/${walletId}/documents`}
      >
        <DocumentStatusBadge status={document.status} />
      </PageHeader>

      {document.description && (
        <p className="max-w-3xl text-sm text-muted-foreground">
          {document.description}
        </p>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>New version</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            Uploading a new version supersedes the current one and starts a fresh
            round at zero approvals — approval is bound to the content hash, not
            the title.
          </p>
          <Input
            type="file"
            disabled={uploading || uploadVersion.isPending}
            onChange={(e) => void onUploadFile(e.target.files?.[0] ?? null)}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {document.versions.map((version) => {
          const snapshot = version.signerSnapshot;
          const approvals = version.reviews.filter((r) => r.action === "approve");
          const rejections = version.reviews.filter((r) => r.action === "reject");
          const acted = new Set(version.reviews.map((r) => r.signerAddress));
          const missing =
            snapshot?.signersAddresses.filter((a) => !acted.has(a)) ?? [];

          return (
            <Card key={version.id}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  Version {version.versionNumber}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <DocumentStatusBadge status={version.status} />
                  {version.status === "Draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={startReview.isPending}
                      onClick={() => startReview.mutate({ versionId: version.id })}
                    >
                      <PlayCircle className="mr-2 h-4 w-4" />
                      Start review
                    </Button>
                  )}
                  {version.status === "InReview" && (
                    <Button size="sm" asChild>
                      <Link
                        href={`/wallets/${walletId}/documents/${documentId}/review/${version.id}`}
                      >
                        Review &amp; sign
                      </Link>
                    </Button>
                  )}
                  {snapshot && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={exportProof.isPending}
                      onClick={() => exportProof.mutate({ versionId: version.id })}
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Proof
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 text-sm">
                <div className="flex flex-col gap-1">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">
                    Content hash ({version.hashAlgorithm})
                  </span>
                  <code className="break-all font-mono text-xs">
                    {version.contentHash}
                  </code>
                  {version.fileName && (
                    <span className="text-xs text-muted-foreground">
                      {version.fileName}
                    </span>
                  )}
                </div>

                {snapshot ? (
                  <div className="flex flex-col gap-2">
                    <span className="font-medium">
                      {approvals.length} of {snapshot.requiredSigners} approvals
                      {rejections.length > 0 && ` · ${rejections.length} rejected`}
                    </span>
                    {version.reviews.map((review) => (
                      <div key={review.id} className="flex flex-col">
                        <span className="font-mono text-xs">
                          {review.action === "approve" ? "✓" : "✗"}{" "}
                          {review.signerAddress}
                        </span>
                        {review.comment && (
                          <span className="pl-4 text-xs text-muted-foreground">
                            “{review.comment}”
                          </span>
                        )}
                      </div>
                    ))}
                    {missing.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        Waiting on {missing.length} signer
                        {missing.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-muted-foreground">
                    No review round started yet.
                  </span>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-xs">
          {document.events.map((event) => (
            <div key={event.id} className="flex flex-wrap gap-2">
              <span className="font-mono text-muted-foreground">
                {new Date(event.createdAt).toISOString()}
              </span>
              <span className="font-medium">{event.type}</span>
              {event.actorAddress && (
                <span className="truncate font-mono text-muted-foreground">
                  {event.actorAddress}
                </span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Upload className="h-3 w-3" />
        An exported proof is an approval attestation by this wallet&apos;s signers.
        It is not a qualified electronic signature.
      </p>
    </main>
  );
}
