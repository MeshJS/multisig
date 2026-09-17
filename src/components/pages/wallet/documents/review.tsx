import { useState } from "react";
import { useRouter } from "next/router";
import { Check, X } from "lucide-react";

import { api } from "@/utils/api";
import useAppWallet from "@/hooks/useAppWallet";
import useMeshWallet from "@/hooks/useMeshWallet";
import { useUserStore } from "@/lib/zustand/user";
import { sign } from "@/utils/signing";
import { toastError } from "@/utils/toast-error";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PageHeader from "@/components/ui/page-header";
import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";
import DocumentStatusBadge from "./status-badge";

/**
 * Version review — the signing decision.
 *
 * The payload is fetched from the server immediately before signing, with the
 * signer's current action and comment already folded in. That matters: the
 * server rebuilds the same payload on submit and rejects anything that isn't
 * byte-identical, so composing it client-side would only invite drift.
 */
export default function PageDocumentReview() {
  const router = useRouter();
  const walletId = router.query.wallet as string;
  const documentId = router.query.documentId as string;
  const versionId = router.query.versionId as string;

  const { appWallet } = useAppWallet();
  const { wallet } = useMeshWallet();
  const userAddress = useUserStore((state) => state.userAddress);

  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const utils = api.useUtils();
  const { data, isLoading } = api.document.getVersionForReview.useQuery(
    { versionId },
    { enabled: !!versionId },
  );

  const submit = api.document.submitSignerAction.useMutation({
    onSuccess: async (result) => {
      await utils.document.getById.invalidate({ documentId });
      await utils.document.listByWallet.invalidate({ walletId });
      toast({
        title:
          result.outcome === "Approved"
            ? "Threshold reached — document approved"
            : result.outcome === "Rejected"
              ? "Version rejected"
              : "Your signature was recorded",
      });
      void router.push(`/wallets/${walletId}/documents/${documentId}`);
    },
    onError: (error) => toastError(error, "Could not record your decision"),
  });

  async function act(action: "approve" | "reject") {
    if (!wallet || !userAddress) {
      toastError(new Error("Connect your wallet first"), "No wallet connected");
      return;
    }
    setBusy(true);
    try {
      // Re-fetch with the exact action + comment being signed, so the string we
      // sign is the one the server will rebuild.
      const fresh = await utils.document.getVersionForReview.fetch({
        versionId,
        action,
        comment: comment.trim() || undefined,
        signerAddress: userAddress,
      });
      if (!fresh.payloadToSign || !fresh.payload) {
        throw new Error("No review round is open for this version");
      }

      const signature = await sign(fresh.payloadToSign, wallet, 0, userAddress);

      submit.mutate({
        versionId,
        action,
        comment: comment.trim() || undefined,
        signerAddress: userAddress,
        signedAt: fresh.payload.signedAt,
        payload: fresh.payloadToSign,
        signature: signature.signature,
        signatureKey: signature.key,
      });
    } catch (error) {
      toastError(error, "Signing failed");
    } finally {
      setBusy(false);
    }
  }

  if (appWallet === undefined || isLoading) return <WalletDetailSkeleton />;
  if (!data) {
    return (
      <main className="mx-auto w-full max-w-3xl p-8">
        <p className="text-sm text-muted-foreground">Version not found.</p>
      </main>
    );
  }

  const { version, document, snapshot, alreadyActed, canSign } = data;
  const pending = busy || submit.isPending;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8">
      <PageHeader
        pageTitle={`Review v${version.versionNumber}`}
        backUrl={`/wallets/${walletId}/documents/${documentId}`}
      >
        <DocumentStatusBadge status={version.status} />
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>{document.title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 text-sm">
          {document.description && (
            <p className="text-muted-foreground">{document.description}</p>
          )}

          {version.reviewInstructions && (
            <div className="rounded-md border p-3">
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                What changed
              </span>
              <p className="mt-1">{version.reviewInstructions}</p>
            </div>
          )}

          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">
              You are approving this exact content hash
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

          {snapshot && (
            <p className="text-muted-foreground">
              This round needs <strong>{snapshot.requiredSigners}</strong> of{" "}
              <strong>{snapshot.signersAddresses.length}</strong> signers, frozen
              when the review started. Changing the wallet&apos;s signers later
              will not change this round.
            </p>
          )}
        </CardContent>
      </Card>

      {alreadyActed ? (
        <Card>
          <CardContent className="p-4 text-sm">
            You already{" "}
            <strong>
              {alreadyActed.action === "approve" ? "approved" : "rejected"}
            </strong>{" "}
            this version. A decision is final for the version it was made on — a
            new version starts a fresh round.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your decision</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="review-comment">Comment (optional)</Label>
              <Textarea
                id="review-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Why are you approving or rejecting?"
              />
              <p className="text-xs text-muted-foreground">
                Your comment is part of what you sign, so it cannot be altered
                afterwards.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button disabled={!canSign || pending} onClick={() => void act("approve")}>
                <Check className="mr-2 h-4 w-4" />
                {pending ? "Signing…" : "Approve"}
              </Button>
              <Button
                variant="outline"
                disabled={!canSign || pending}
                onClick={() => void act("reject")}
              >
                <X className="mr-2 h-4 w-4" />
                Reject
              </Button>
            </div>

            {!canSign && (
              <p className="text-xs text-muted-foreground">
                {version.status !== "InReview"
                  ? `This version is ${version.status} and is not open for signing.`
                  : "You are not in this round's signer snapshot."}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
