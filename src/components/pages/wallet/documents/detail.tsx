import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  Archive,
  Download,
  FileArchive,
  FileJson,
  FileText,
  GitCompare,
  MoreVertical,
  Pencil,
  PlayCircle,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";

import { api } from "@/utils/api";
import useAppWallet from "@/hooks/useAppWallet";
import { absoluteUrl } from "@/lib/seo";
import { downloadFile, downloadJson } from "@/utils/download-file";
import { toastError } from "@/utils/toast-error";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import FileDrop from "./file-drop";
import PageHeader from "@/components/ui/page-header";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";
import DocumentStatusBadge from "./status-badge";
import { sha256HexFromFile } from "./hash-file";
import VersionDiffDialog from "./version-diff-dialog";

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
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [typedTitle, setTypedTitle] = useState("");
  const [comparing, setComparing] = useState<{
    fromId: string;
    toId: string;
  } | null>(null);
  const [restoring, setRestoring] = useState<{
    id: string;
    versionNumber: number;
  } | null>(null);

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

  const archiveDocument = api.document.archiveDocument.useMutation({
    onSuccess: async () => {
      await refresh();
      toast({
        title: "Document archived",
        description: "History is kept — it just leaves active use.",
      });
    },
    onError: (error) => toastError(error, "Could not archive the document"),
  });

  const deleteDocument = api.document.deleteDocument.useMutation({
    onSuccess: async (result) => {
      await utils.document.listByWallet.invalidate({ walletId });
      toast({
        title: "Document deleted",
        description:
          result.signatureCount > 0
            ? `${result.signatureCount} signature${result.signatureCount === 1 ? "" : "s"} were destroyed with it.`
            : "It carried no signatures.",
      });
      await router.push(`/wallets/${walletId}/documents`);
    },
    onError: (error) => toastError(error, "Could not delete the document"),
  });

  const restoreVersion = api.document.restoreVersion.useMutation({
    onSuccess: async (version) => {
      setRestoring(null);
      await refresh();
      toast({
        title: `Restored as version ${version.versionNumber}`,
        description:
          "Same content, new round — signers approve it again from zero.",
      });
    },
    onError: (error) => toastError(error, "Could not restore that version"),
  });

  const exportProof = api.document.exportProof.useMutation();
  const exportAudit = api.document.exportAudit.useMutation();

  /**
   * The whole document's record in one file: every version with its lineage
   * and proof, the event log, and the attestation chain. Checkable offline —
   * see src/lib/documents/audit.ts.
   */
  async function onExportAudit() {
    try {
      const pkg = await exportAudit.mutateAsync({ documentId });
      downloadJson(pkg, `signoff-audit-${pkg.document.id}.json`);
      await utils.document.getById.invalidate({ documentId });
    } catch (error) {
      toastError(error, "Could not export the audit trail");
    }
  }

  /**
   * Both exports are the same package. The JSON is what a verifier checks; the
   * PDF is what gets filed, attached to a board pack or handed to someone who
   * is never going to open a JSON file. The PDF is built here in the browser,
   * behind a dynamic import, so its renderer stays out of the wallet bundle
   * until somebody actually asks for one.
   */
  async function onExportProof(versionId: string, format: "json" | "pdf") {
    try {
      const proof = await exportProof.mutateAsync({ versionId });
      if (format === "json") {
        downloadJson(
          proof,
          `signoff-proof-${proof.document.id}-v${proof.version.versionNumber}.json`,
        );
        return;
      }
      const { buildProofPdf, proofPdfFileName } =
        await import("@/lib/documents/proof-pdf");
      downloadFile(
        buildProofPdf(proof, { verifyUrl: absoluteUrl("/verify") }),
        proofPdfFileName(proof),
        "application/pdf",
      );
    } catch (error) {
      toastError(error, "Could not export the proof");
    }
  }

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

  // Signatures across every version. Zero means this is a draft nobody has
  // acted on, and deleting it destroys nothing anyone relied on; above zero the
  // dialog demands the title be retyped.
  const signatureCount = document.versions.reduce(
    (total, version) => total + version.reviews.length,
    0,
  );

  // Versions arrive newest first, so the head is index 0.
  const head = document.versions[0];
  const headId = head?.id;
  const versionOptions = document.versions.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
  }));
  const restoredFrom = new Map<string, number>();
  for (const event of document.events) {
    const meta = event.metadata as {
      restoredFromVersionNumber?: unknown;
    } | null;
    if (
      event.type === "version.restored" &&
      event.versionId &&
      typeof meta?.restoredFromVersionNumber === "number"
    ) {
      restoredFrom.set(event.versionId, meta.restoredFromVersionNumber);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8">
      <PageHeader
        pageTitle={document.title}
        backUrl={`/wallets/${walletId}/documents`}
      >
        <DocumentStatusBadge status={document.status} />
        <Button asChild size="sm" variant="outline">
          <Link href={`/wallets/${walletId}/documents/${documentId}/edit`}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </Link>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" aria-label="Document actions">
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={exportAudit.isPending}
              onClick={() => void onExportAudit()}
            >
              <FileArchive className="mr-2 h-4 w-4" />
              Export audit trail (JSON)
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={
                document.status === "Archived" || archiveDocument.isPending
              }
              onClick={() => archiveDocument.mutate({ documentId })}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-500 focus:text-red-500"
              onClick={() => {
                setTypedTitle("");
                setConfirmingDelete(true);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete permanently
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
            Uploading a new version supersedes the current one and starts a
            fresh round at zero approvals — approval is bound to the content
            hash, not the title.
          </p>
          <FileDrop
            busy={uploading || uploadVersion.isPending}
            onFile={(file) => void onUploadFile(file)}
          />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        {document.versions.map((version, index) => {
          const previous = document.versions[index + 1];
          const snapshot = version.signerSnapshot;
          const approvals = version.reviews.filter(
            (r) => r.action === "approve",
          );
          const rejections = version.reviews.filter(
            (r) => r.action === "reject",
          );
          const acted = new Set(version.reviews.map((r) => r.signerAddress));
          const missing =
            snapshot?.signersAddresses.filter((a) => !acted.has(a)) ?? [];

          return (
            <Card key={version.id}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-baseline gap-2 text-base">
                  Version {version.versionNumber}
                  {restoredFrom.has(version.id) && (
                    <span className="text-xs font-normal text-muted-foreground">
                      restored from v{restoredFrom.get(version.id)}
                    </span>
                  )}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <DocumentStatusBadge status={version.status} />
                  {previous && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setComparing({ fromId: previous.id, toId: version.id })
                      }
                    >
                      <GitCompare className="mr-2 h-4 w-4" />
                      Changes
                    </Button>
                  )}
                  {version.id !== headId &&
                    version.contentHash !== head?.contentHash &&
                    document.status !== "Archived" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={restoreVersion.isPending}
                        onClick={() =>
                          setRestoring({
                            id: version.id,
                            versionNumber: version.versionNumber,
                          })
                        }
                      >
                        <RotateCcw className="mr-2 h-4 w-4" />
                        Restore
                      </Button>
                    )}
                  {version.status === "Draft" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={startReview.isPending}
                      onClick={() =>
                        startReview.mutate({ versionId: version.id })
                      }
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
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={exportProof.isPending}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Proof
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onClick={() => onExportProof(version.id, "json")}
                        >
                          <FileJson className="mr-2 h-4 w-4" />
                          JSON — the verifiable package
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => onExportProof(version.id, "pdf")}
                        >
                          <FileText className="mr-2 h-4 w-4" />
                          PDF — a readable summary
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link href="/verify" target="_blank">
                            <ShieldCheck className="mr-2 h-4 w-4" />
                            Verify a proof
                          </Link>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
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
                      {rejections.length > 0 &&
                        ` · ${rejections.length} rejected`}
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
        An exported proof is an approval attestation by this wallet&apos;s
        signers. It is not a qualified electronic signature.
      </p>

      {comparing && (
        <VersionDiffDialog
          documentId={documentId}
          versions={versionOptions}
          initialFromId={comparing.fromId}
          initialToId={comparing.toId}
          open={comparing !== null}
          onOpenChange={(open) => !open && setComparing(null)}
        />
      )}

      <Dialog
        open={restoring !== null}
        onOpenChange={(open) => !open && setRestoring(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Restore version {restoring?.versionNumber}?
            </DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This publishes version {restoring?.versionNumber}&apos;s exact
                  content as a new version and supersedes the current one.
                  Nothing is deleted — the versions in between stay in the
                  history, and the restore itself is logged and attested.
                </p>
                <p>
                  Approvals do not come back. The restored version starts a
                  fresh round at zero, and signers approve it again.
                </p>
                {head?.status === "InReview" && (
                  <p className="text-red-500">
                    Version {head.versionNumber} is in review
                    {head.reviews.length > 0
                      ? ` with ${head.reviews.length} signature${head.reviews.length === 1 ? "" : "s"}`
                      : ""}
                    . Restoring ends that round.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoring(null)}>
              Cancel
            </Button>
            <Button
              disabled={restoreVersion.isPending || !restoring}
              onClick={() =>
                restoring &&
                restoreVersion.mutate({
                  documentId,
                  versionId: restoring.id,
                  expectedHeadVersionId: headId,
                })
              }
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              Restore as new version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this document?</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  This removes every version, every signature, the signer
                  snapshots, the attestation chain and the document&apos;s audit
                  trail. It cannot be undone.
                </p>
                {signatureCount > 0 ? (
                  <p className="text-red-500">
                    {signatureCount} signature
                    {signatureCount === 1 ? " has" : "s have"} been given on
                    this document. Deleting it destroys the evidence that
                    {signatureCount === 1
                      ? " that person"
                      : " those people"}{" "}
                    approved anything. Archive keeps all of it.
                  </p>
                ) : (
                  <p>
                    No one has signed this document, so nothing is being erased
                    beyond the draft itself.
                  </p>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {signatureCount > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Type{" "}
                <span className="font-medium text-foreground">
                  {document.title}
                </span>{" "}
                to confirm.
              </p>
              <Input
                value={typedTitle}
                onChange={(e) => setTypedTitle(e.target.value)}
                placeholder={document.title}
                aria-label="Type the document title to confirm deletion"
              />
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={
                deleteDocument.isPending ||
                (signatureCount > 0 && typedTitle !== document.title)
              }
              onClick={() =>
                deleteDocument.mutate({
                  documentId,
                  ...(signatureCount > 0 ? { confirmTitle: typedTitle } : {}),
                })
              }
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete permanently
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
