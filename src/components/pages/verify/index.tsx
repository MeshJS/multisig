import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileJson,
  FileText,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { api } from "@/utils/api";
import { absoluteUrl } from "@/lib/seo";
import { downloadFile } from "@/utils/download-file";
import { toastError } from "@/utils/toast-error";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import FileDrop from "@/components/pages/wallet/documents/file-drop";
import { sha256HexFromFile } from "@/components/pages/wallet/documents/hash-file";
import {
  VERIFICATION_INSTRUCTIONS,
  parseProofPackage,
} from "@/lib/documents/proof";

/** One line of the verdict: a name, an outcome, and how worried to be. */
function CheckRow({
  label,
  detail,
  state,
}: {
  label: string;
  detail: string;
  state: "pass" | "fail" | "unknown";
}) {
  const Icon =
    state === "pass" ? CheckCircle2 : state === "fail" ? XCircle : AlertTriangle;
  const tone =
    state === "pass"
      ? "text-emerald-600 dark:text-emerald-400"
      : state === "fail"
        ? "text-red-600 dark:text-red-400"
        : "text-muted-foreground";

  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-sm text-muted-foreground">{detail}</div>
      </div>
    </div>
  );
}

/**
 * The public verifier for a Document Sign-Off proof (PRD-001).
 *
 * The point of an exportable proof is that it can be checked by someone who has
 * no account here, was never a signer, and has no reason to take the wallet's
 * word for anything. So this page is public, it asks for nothing, and it is
 * honest about its own limits: the four steps it performs are printed on the
 * page, and anyone who would rather not trust this server can run them
 * themselves against the same JSON.
 *
 * The document being attested never reaches the server. It is hashed in the
 * browser and only the digest is compared, which is what makes it safe to check
 * a confidential contract against a proof.
 */
export default function PageVerifyProof() {
  const [proofText, setProofText] = useState("");
  const [file, setFile] = useState<{ name: string; hash: string } | null>(null);
  const [hashing, setHashing] = useState(false);

  const parsed = useMemo(() => {
    const trimmed = proofText.trim();
    return trimmed === "" ? null : parseProofPackage(trimmed);
  }, [proofText]);
  const proof = parsed?.ok ? parsed.proof : null;

  const verify = api.document.verifyProof.useMutation({
    onError: (error) => toastError(error, "Could not check this proof"),
  });
  const result = verify.data;

  async function onDocumentFile(picked: File) {
    setHashing(true);
    try {
      setFile({ name: picked.name, hash: await sha256HexFromFile(picked) });
      verify.reset();
    } catch (error) {
      toastError(error, "Could not hash that file");
    } finally {
      setHashing(false);
    }
  }

  async function onProofFile(event: React.ChangeEvent<HTMLInputElement>) {
    const picked = event.target.files?.[0];
    event.target.value = "";
    if (!picked) return;
    setProofText(await picked.text());
    verify.reset();
  }

  async function onDownloadPdf() {
    if (!proof) return;
    try {
      const { buildProofPdf, proofPdfFileName } = await import(
        "@/lib/documents/proof-pdf"
      );
      downloadFile(
        buildProofPdf(proof, {
          verification: result ?? null,
          verifyUrl: absoluteUrl("/verify"),
        }),
        proofPdfFileName(proof),
        "application/pdf",
      );
    } catch (error) {
      toastError(error, "Could not build the PDF");
    }
  }

  const validReviews = result?.reviews.filter((r) => r.valid).length ?? 0;

  return (
    <div className="relative z-20 mx-auto w-full min-w-0 max-w-[1000px] px-6 py-10 lg:py-8">
      <h1 className="text-3xl font-medium tracking-tight text-black dark:text-white lg:text-4xl">
        Verify a sign-off proof
      </h1>
      <p className="my-4 max-w-3xl text-sm font-normal text-neutral-500 dark:text-neutral-300 lg:text-base">
        A Mesh Multisig sign-off proof is a JSON file: the approved document&apos;s
        hash, the signer set frozen when the review opened, and each signer&apos;s
        CIP-8 signature over that exact version. Drop one here to check it. You do
        not need an account, and you do not need to have been a signer.
      </p>
      <p className="mb-8 max-w-3xl text-xs text-muted-foreground">
        The proof JSON is sent to this server to be checked — it reads nothing
        from, and writes nothing to, the database. The document itself is not
        sent: it is hashed in your browser and only the digest is compared.
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileJson className="h-4 w-4" />
              1. The proof
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-md border border-input px-3 py-2 text-sm hover:bg-accent">
              <input
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={onProofFile}
              />
              Choose a proof file
            </label>
            <Textarea
              value={proofText}
              onChange={(e) => {
                setProofText(e.target.value);
                verify.reset();
              }}
              placeholder="…or paste the JSON proof package here"
              className="h-48 font-mono text-xs"
            />
            {parsed && !parsed.ok && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {parsed.error}
              </p>
            )}
            {proof && (
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                <div className="font-medium">{proof.document.title}</div>
                <div className="text-muted-foreground">
                  Version {proof.version.versionNumber} · {proof.version.status}{" "}
                  · {proof.policy.requiredSigners} of{" "}
                  {proof.policy.signersAddresses.length} signers required
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" />
              2. The document (optional)
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Add the file the proof is about and it will be re-hashed here, so
              you learn whether the copy in your hands is the one that was
              approved. Without it, the signatures can still be checked — but
              only against the hash the proof itself claims.
            </p>
            <FileDrop onFile={onDocumentFile} busy={hashing} />
            {file && (
              <div className="rounded-md bg-muted/50 p-3 text-sm">
                <div className="font-medium">{file.name}</div>
                <code className="break-all font-mono text-xs text-muted-foreground">
                  {file.hash}
                </code>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          disabled={!proof || verify.isPending}
          onClick={() =>
            proof &&
            verify.mutate({
              proof,
              expectedContentHash: file?.hash,
            })
          }
        >
          {verify.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="mr-2 h-4 w-4" />
          )}
          Verify this proof
        </Button>
        {proof && (
          <Button variant="outline" onClick={onDownloadPdf}>
            Download a PDF summary
          </Button>
        )}
      </div>

      {result && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {result.valid ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
              )}
              {result.valid
                ? "This proof verifies"
                : "This proof does not verify"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <CheckRow
              label="Signatures"
              state={
                result.reviews.length > 0 && validReviews === result.reviews.length
                  ? "pass"
                  : "fail"
              }
              detail={`${validReviews} of ${result.reviews.length} recorded ${
                result.reviews.length === 1 ? "signature" : "signatures"
              } are genuine, bound to this version, and from a signer in the frozen set.`}
            />
            <CheckRow
              label="Threshold"
              state={result.thresholdReached ? "pass" : "fail"}
              detail={`${result.approvals} valid ${
                result.approvals === 1 ? "approval" : "approvals"
              } against ${result.requiredSigners} required${
                result.rejections > 0
                  ? `, and ${result.rejections} rejection${result.rejections === 1 ? "" : "s"}`
                  : ""
              }.`}
            />
            <CheckRow
              label="Document bytes"
              state={
                result.contentHashMatches === undefined
                  ? "unknown"
                  : result.contentHashMatches
                    ? "pass"
                    : "fail"
              }
              detail={
                result.contentHashMatches === undefined
                  ? "No file supplied, so nothing was compared against the approved hash."
                  : result.contentHashMatches
                    ? "The file you supplied hashes to the approved content hash."
                    : "The file you supplied does not hash to the approved content hash. It is not the version that was approved."
              }
            />

            {result.errors.length > 0 && (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-red-600 dark:text-red-400">
                {result.errors.map((error, index) => (
                  <li key={index}>{error}</li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex flex-col gap-3">
              {result.reviews.map((review, index) => (
                <div
                  key={`${review.signerAddress}-${index}`}
                  className="rounded-md border p-3 text-sm"
                >
                  <div className="flex items-center gap-2 font-medium">
                    {review.valid ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                    )}
                    {review.action === "approve"
                      ? "Approved"
                      : review.action === "reject"
                        ? "Rejected"
                        : "Unreadable"}
                  </div>
                  <code className="mt-1 block break-all font-mono text-xs text-muted-foreground">
                    {review.signerAddress}
                  </code>
                  {review.errors.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-600 dark:text-red-400">
                      {review.errors.map((error, errorIndex) => (
                        <li key={errorIndex}>{error}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>

            <p className="mt-4 text-xs text-muted-foreground">
              An approval attestation by the wallet&apos;s signers. It is not a
              qualified electronic signature.
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">
            Or check it yourself, without us
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Nothing here depends on this server. These are the four steps it
            performs, and the proof package carries them too:
          </p>
          <ol className="list-decimal space-y-2 pl-5 text-sm">
            {(proof?.verification.instructions ?? VERIFICATION_INSTRUCTIONS).map(
              (instruction, index) => (
                <li key={index} className="pl-1">
                  {instruction.replace(/^\d+\.\s*/, "")}
                </li>
              ),
            )}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
