import { useState } from "react";
import { useRouter } from "next/router";
import { FileUp } from "lucide-react";

import { api } from "@/utils/api";
import useAppWallet from "@/hooks/useAppWallet";
import { toastError } from "@/utils/toast-error";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/ui/page-header";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";
import { sha256HexFromFile } from "./hash-file";

/**
 * Create a document, optionally with its first version.
 *
 * The file is hashed **in the browser** and only the digest is sent — the bytes
 * never leave the machine, which is what makes it usable for confidential
 * documents. The hash is the thing signers will bind their approval to.
 */
export default function PageDocumentNew() {
  const router = useRouter();
  const walletId = router.query.wallet as string;
  const { appWallet } = useAppWallet();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [documentType, setDocumentType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [contentHash, setContentHash] = useState<string | null>(null);
  const [hashing, setHashing] = useState(false);

  const utils = api.useUtils();
  const createDocument = api.document.createDocument.useMutation({
    onSuccess: async (doc) => {
      await utils.document.listByWallet.invalidate({ walletId });
      toast({ title: "Document created" });
      void router.push(`/wallets/${walletId}/documents/${doc.id}`);
    },
    onError: (error) => toastError(error, "Could not create the document"),
  });

  async function onPickFile(picked: File | null) {
    setFile(picked);
    setContentHash(null);
    if (!picked) return;
    setHashing(true);
    try {
      setContentHash(await sha256HexFromFile(picked));
    } catch (error) {
      toastError(error, "Could not hash that file");
    } finally {
      setHashing(false);
    }
  }

  if (appWallet === undefined) return <WalletDetailSkeleton />;

  const canSubmit = title.trim().length > 0 && !hashing && !createDocument.isPending;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8">
      <PageHeader
        pageTitle="New document"
        backUrl={`/wallets/${walletId}/documents`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Document</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="doc-title">Title</Label>
            <Input
              id="doc-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Q3 Treasury Budget"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="doc-description">Description</Label>
            <Textarea
              id="doc-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What are signers approving, and why?"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="doc-type">Type (optional)</Label>
            <Input
              id="doc-type"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              placeholder="Budget, agreement, policy…"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>First version</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            The file is hashed in your browser. Only the SHA-256 digest is stored —
            the document itself never leaves this device.
          </p>

          <div className="flex flex-col gap-2">
            <Label htmlFor="doc-file">File</Label>
            <Input
              id="doc-file"
              type="file"
              onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {hashing && (
            <p className="text-sm text-muted-foreground">Hashing…</p>
          )}

          {contentHash && (
            <div className="flex flex-col gap-1 rounded-md bg-muted p-3">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                Content hash (SHA-256)
              </span>
              <code className="break-all font-mono text-xs">{contentHash}</code>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button
          disabled={!canSubmit}
          onClick={() =>
            createDocument.mutate({
              walletId,
              title: title.trim(),
              description: description.trim() || undefined,
              documentType: documentType.trim() || undefined,
              firstVersion: contentHash
                ? {
                    contentHash,
                    fileName: file?.name,
                    mimeType: file?.type || undefined,
                    fileSize: file?.size,
                    storageMode: "hashOnly",
                  }
                : undefined,
            })
          }
        >
          <FileUp className="mr-2 h-4 w-4" />
          {createDocument.isPending ? "Creating…" : "Create document"}
        </Button>
      </div>
    </main>
  );
}
