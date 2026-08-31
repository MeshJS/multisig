import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  AlertTriangle,
  Check,
  Eye,
  FileSignature,
  Loader2,
  Pencil,
  Send,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import WalletDetailSkeleton from "@/components/pages/wallet/wallet-detail-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import PageHeader from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { decideDraftSync } from "@/lib/documents/draft-sync";
import useAppWallet from "@/hooks/useAppWallet";
import { toast } from "@/hooks/use-toast";
import { api } from "@/utils/api";
import { toastError } from "@/utils/toast-error";

const PROSE =
  "max-w-none text-sm leading-relaxed text-muted-foreground " +
  "[&_h1]:mt-6 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-foreground " +
  "[&_h2]:mt-6 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground " +
  "[&_h3]:mt-5 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground " +
  "[&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:mt-3 [&_ol]:list-decimal [&_ol]:pl-5 " +
  "[&_li]:mt-1 [&_strong]:font-semibold [&_strong]:text-foreground " +
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs " +
  "[&_blockquote]:mt-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic " +
  "[&_hr]:my-6 [&_hr]:border-border " +
  "[&_table]:mt-3 [&_table]:w-full [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left " +
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1";

const AUTOSAVE_MS = 1200;

/**
 * The draft editor.
 *
 * Writes only to DocumentDraft, never to a version — `uploadVersion` supersedes
 * the previous version and resets approvals to zero, so autosaving through it
 * would destroy in-flight approvals every few keystrokes. Publishing is a
 * separate, deliberate action.
 *
 * COLLABORATION, HONESTLY
 *
 * This deployment runs stock `next start` with no custom server and no broker,
 * so there is nowhere to terminate a WebSocket and nothing to fan out through.
 * Real simultaneous multi-writer editing (a CRDT) cannot be hosted here, and
 * pretending otherwise would mean silently losing people's work.
 *
 * What it does instead is honest and useful: it polls the draft, adopts a newer
 * revision automatically while you have nothing unsaved, and if you DO have
 * unsaved edits when someone else saves, it stops and tells you rather than
 * overwriting them. `saveDraft` enforces the same rule server-side via the
 * revision, so a lost update is impossible even if this UI is wrong.
 */
export default function PageDocumentEditor() {
  const router = useRouter();
  const walletId = router.query.wallet as string;
  const documentId = router.query.documentId as string;
  const { appWallet } = useAppWallet();

  const [body, setBody] = useState("");
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [storeBody, setStoreBody] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<number | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const utils = api.useUtils();
  const { data: document, isLoading: loadingDoc } =
    api.document.getById.useQuery({ documentId }, { enabled: !!documentId });

  const { data: draft, isLoading: loadingDraft } =
    api.document.getDraft.useQuery(
      { documentId },
      {
        enabled: !!documentId,
        // Poll so a second editor's saves show up. Not in the background: an
        // unfocused tab has nothing to show and no reason to spend the query.
        refetchInterval: 5000,
        refetchIntervalInBackground: false,
      },
    );

  const saveDraft = api.document.saveDraft.useMutation({
    onSuccess: (saved) => {
      setBaseRevision(saved.revision);
      setDirty(false);
      setConflict(null);
      void utils.document.getDraft.invalidate({ documentId });
    },
    onError: (error) => {
      if (error.data?.code === "CONFLICT") {
        // Deliberately do NOT touch the textarea — the author's words stay
        // exactly where they are while they decide what to do.
        setConflict(draft?.revision ?? null);
        return;
      }
      toastError(error, "Could not save the draft");
    },
  });

  const publishDraft = api.document.publishDraft.useMutation({
    onSuccess: async (version) => {
      toast({
        title: `Published version ${version.versionNumber}`,
        description: "It is now hashed, attested and ready for signatures.",
      });
      await utils.document.getById.invalidate({ documentId });
      await router.push(`/wallets/${walletId}/documents/${documentId}`);
    },
    onError: (error) => toastError(error, "Could not publish"),
  });

  // Adopt the server's copy on first load, and afterwards only while there is
  // nothing local to lose.
  useEffect(() => {
    const decision = decideDraftSync({
      baseRevision,
      dirty,
      remoteRevision: draft?.revision ?? null,
    });
    if (decision === "ignore" || !draft) return;
    if (decision === "conflict") {
      setConflict(draft.revision);
      return;
    }
    setBody(draft.body ?? "");
    setStoreBody(draft.storeBody);
    setBaseRevision(draft.revision);
  }, [draft, baseRevision, dirty]);

  const scheduleSave = useCallback(
    (next: string, nextStore: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        saveDraft.mutate({
          documentId,
          body: next,
          storeBody: nextStore,
          ...(baseRevision !== null ? { expectedRevision: baseRevision } : {}),
        });
      }, AUTOSAVE_MS);
    },
    [documentId, baseRevision, saveDraft],
  );

  useEffect(
    () => () => void (timer.current && clearTimeout(timer.current)),
    [],
  );

  if (appWallet === undefined || loadingDoc || loadingDraft) {
    return <WalletDetailSkeleton />;
  }
  if (!document) {
    return (
      <main className="mx-auto w-full max-w-5xl p-8">
        <p className="text-sm text-muted-foreground">Document not found.</p>
      </main>
    );
  }

  const onChange = (next: string) => {
    setBody(next);
    setDirty(true);
    if (conflict === null) scheduleSave(next, storeBody);
  };

  const status = conflict
    ? "conflict"
    : saveDraft.isPending
      ? "saving"
      : dirty
        ? "unsaved"
        : "saved";

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-3 sm:p-4 md:gap-6 lg:gap-8 lg:p-8">
      <PageHeader
        pageTitle={`Editing ${document.title}`}
        backUrl={`/wallets/${walletId}/documents/${documentId}`}
      >
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? (
            <Pencil className="mr-2 h-4 w-4" />
          ) : (
            <Eye className="mr-2 h-4 w-4" />
          )}
          {showPreview ? "Write only" : "Preview"}
        </Button>
        <Button
          size="sm"
          disabled={
            !storeBody || dirty || publishDraft.isPending || !body.trim()
          }
          onClick={() => publishDraft.mutate({ documentId })}
        >
          <Send className="mr-2 h-4 w-4" />
          Publish version
        </Button>
      </PageHeader>

      {conflict !== null && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="space-y-2">
            <p className="font-medium text-foreground">
              Someone else saved revision {conflict} while you were writing.
            </p>
            <p className="text-muted-foreground">
              Your text is untouched and has not been sent. Copy anything you
              want to keep, then load their version — saving over it would throw
              their work away, so this stops rather than guessing.
            </p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setBody(draft?.body ?? "");
                setBaseRevision(draft?.revision ?? null);
                setDirty(false);
                setConflict(null);
              }}
            >
              Load their version
            </Button>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 py-4 text-sm">
          <div className="flex items-center gap-2">
            <Switch
              checked={storeBody}
              onCheckedChange={(next) => {
                setStoreBody(next);
                setDirty(true);
                if (conflict === null) scheduleSave(body, next);
              }}
              aria-label="Store this draft on the server"
            />
            <span className="text-muted-foreground">
              Store this draft on the server
            </span>
          </div>

          <span className="flex items-center gap-1.5 text-muted-foreground">
            {status === "saving" && (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
              </>
            )}
            {status === "saved" && (
              <>
                <Check className="h-3.5 w-3.5 text-green-500" /> Saved
                {baseRevision !== null && ` · revision ${baseRevision}`}
              </>
            )}
            {status === "unsaved" && "Unsaved changes"}
            {status === "conflict" && "Paused — resolve the conflict above"}
          </span>

          {draft?.updatedBy && (
            <span className="font-mono text-xs text-muted-foreground/70">
              last by {draft.updatedBy.slice(0, 12)}…
            </span>
          )}
        </CardContent>
      </Card>

      {!storeBody && (
        <p className="max-w-3xl rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
          Nothing is being saved. This feature&apos;s default is that document
          bytes never reach the server — only their hash does. Storing the draft
          here is what makes editing, collaboration and publishing possible, and
          it is a deliberate trade you make per document.
        </p>
      )}

      <div
        className={`grid gap-4 ${showPreview ? "lg:grid-cols-2" : "grid-cols-1"}`}
      >
        <Textarea
          value={body}
          onChange={(e) => onChange(e.target.value)}
          disabled={!storeBody}
          placeholder={
            storeBody
              ? "# Heading\n\nWrite in Markdown. Publishing hashes exactly these bytes."
              : "Turn on server storage to start writing."
          }
          className="min-h-[60vh] resize-y font-mono text-sm leading-relaxed"
          aria-label="Document body"
        />

        {showPreview && (
          <Card className="min-h-[60vh] overflow-auto">
            <CardContent className="py-4">
              {body.trim() ? (
                <div className={PROSE}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {body}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The preview appears here as you write.
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
        Publishing serialises this draft server-side, hashes it, records the
        hash as a new version and attests it. Approvals reset to zero, because
        approval is bound to the content hash rather than the title — signers
        are agreeing to these exact bytes.{" "}
        <Link
          href={`/wallets/${walletId}/documents/${documentId}`}
          className="underline underline-offset-2"
        >
          <FileSignature className="mr-1 inline h-3 w-3" />
          Version history
        </Link>
      </p>
    </main>
  );
}
