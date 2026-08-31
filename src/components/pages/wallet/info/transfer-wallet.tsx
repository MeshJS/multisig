import { useState } from "react";
import CardUI from "@/components/ui/card-content";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader, Download, Send, CheckCircle, ExternalLink } from "lucide-react";
import type { Wallet } from "@/types/wallet";
import type { WalletTransferPayloadV1 } from "@/types/walletTransfer";
import { toast } from "@/hooks/use-toast";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";

type Mode = "download" | "push";

export function TransferWallet({ appWallet }: { appWallet: Wallet }) {
  const userAddress = useUserStore((s) => s.userAddress);
  const isOwner = appWallet.ownerAddress === userAddress;

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("download");
  const [includeContacts, setIncludeContacts] = useState(false);
  const [includeBallots, setIncludeBallots] = useState(false);
  const [targetUrl, setTargetUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultInviteUrl, setResultInviteUrl] = useState<string | null>(null);

  const exportMutation = api.wallet.exportTransferPayload.useMutation();

  const reset = () => {
    setMode("download");
    setIncludeContacts(false);
    setIncludeBallots(false);
    setTargetUrl("");
    setBusy(false);
    setResultInviteUrl(null);
  };

  const downloadJson = (payload: WalletTransferPayloadV1) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const safeName = (appWallet.name || "wallet").replace(/[^a-z0-9._-]+/gi, "_");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${safeName}-transfer-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const pushToTarget = async (
    payload: WalletTransferPayloadV1,
    rawTarget: string,
  ) => {
    let normalized = rawTarget.trim();
    if (!normalized) throw new Error("Target instance URL is required");
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
    const base = normalized.replace(/\/+$/, "");
    const endpoint = `${base}/api/v1/wallet/transfer/import`;
    const enriched: WalletTransferPayloadV1 = {
      ...payload,
      exportedFromOrigin: window.location.origin,
    };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(enriched),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Target rejected the transfer (${res.status}): ${text || res.statusText}`);
    }
    return (await res.json()) as { newWalletId: string; inviteUrl: string };
  };

  const submit = async () => {
    setBusy(true);
    try {
      const payload = await exportMutation.mutateAsync({
        walletId: appWallet.id,
        includeContacts,
        includeBallots,
      });
      const enriched: WalletTransferPayloadV1 = {
        ...payload,
        exportedFromOrigin: window.location.origin,
      };
      if (mode === "download") {
        downloadJson(enriched);
        toast({
          title: "Wallet exported",
          description: "Transfer JSON downloaded.",
        });
        setOpen(false);
        reset();
      } else {
        const result = await pushToTarget(payload, targetUrl);
        setResultInviteUrl(result.inviteUrl);
        toast({
          title: "Wallet sent",
          description: "Recipient instance accepted the transfer.",
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Transfer failed";
      toast({
        title: "Transfer failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <CardUI
      title="Transfer Wallet"
      description="Export this wallet's definition for use on another Multisig instance."
      cardClassName="col-span-2"
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Sends the wallet definition (signers, threshold, script) to another
          instance. On-chain history, balances, and pending transactions stay on
          chain. Optionally include contacts and ballots.
        </p>
        <div>
          <Button
            onClick={() => setOpen(true)}
            disabled={!isOwner}
            className="w-full sm:w-auto"
          >
            Transfer to another instance
          </Button>
          {!isOwner && (
            <p className="mt-2 text-xs text-muted-foreground">
              Only the wallet owner can initiate a transfer.
            </p>
          )}
        </div>
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) reset();
          setOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Transfer wallet</DialogTitle>
            <DialogDescription>
              Move &ldquo;{appWallet.name}&rdquo; to another Multisig instance.
            </DialogDescription>
          </DialogHeader>

          {resultInviteUrl ? (
            <div className="space-y-3">
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  Transfer accepted. Share this invite link with signers on the
                  target instance:
                </AlertDescription>
              </Alert>
              <div className="flex items-center gap-2 rounded border p-2 text-sm break-all">
                <ExternalLink className="h-4 w-4 shrink-0" />
                <a
                  className="underline"
                  href={resultInviteUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {resultInviteUrl}
                </a>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Method</Label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setMode("download")}
                    className={`rounded border p-3 text-left text-sm transition ${
                      mode === "download"
                        ? "border-primary bg-primary/5"
                        : "hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <Download className="h-4 w-4" />
                      Download JSON
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Save a file and upload on the target instance.
                    </p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode("push")}
                    className={`rounded border p-3 text-left text-sm transition ${
                      mode === "push"
                        ? "border-primary bg-primary/5"
                        : "hover:border-primary/40"
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <Send className="h-4 w-4" />
                      Send to instance URL
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Push directly to a remote instance.
                    </p>
                  </button>
                </div>
              </div>

              {mode === "push" && (
                <div className="space-y-2">
                  <Label htmlFor="target-url">Target instance URL</Label>
                  <Input
                    id="target-url"
                    placeholder="https://multisig.example.com"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label>Include (optional)</Label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={includeContacts}
                    onCheckedChange={(v) => setIncludeContacts(Boolean(v))}
                  />
                  Contacts (address book entries scoped to this wallet)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={includeBallots}
                    onCheckedChange={(v) => setIncludeBallots(Boolean(v))}
                  />
                  Ballots (governance ballots and rationale comments)
                </label>
              </div>
            </div>
          )}

          <DialogFooter>
            {resultInviteUrl ? (
              <Button
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
              >
                Done
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    setOpen(false);
                    reset();
                  }}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button onClick={submit} disabled={busy || (mode === "push" && !targetUrl.trim())}>
                  {busy ? (
                    <>
                      <Loader className="mr-2 h-4 w-4 animate-spin" />
                      Working...
                    </>
                  ) : mode === "download" ? (
                    "Download"
                  ) : (
                    "Send"
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardUI>
  );
}
