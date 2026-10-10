import { useRef, useState } from "react";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
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
import { Loader, Upload, CheckCircle } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  WALLET_TRANSFER_FORMAT,
  WALLET_TRANSFER_VERSION,
  type WalletTransferPayloadV1,
} from "@/types/walletTransfer";

export function ImportTransferDialog() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [payload, setPayload] = useState<WalletTransferPayloadV1 | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setBusy(false);
    setFileName(null);
    setPayload(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as WalletTransferPayloadV1;
      if (parsed.format !== WALLET_TRANSFER_FORMAT) {
        throw new Error(`Unexpected format: ${String(parsed.format)}`);
      }
      if (parsed.version !== WALLET_TRANSFER_VERSION) {
        throw new Error(`Unsupported payload version: ${String(parsed.version)}`);
      }
      if (!parsed.wallet?.scriptCbor || !Array.isArray(parsed.wallet.signersAddresses)) {
        throw new Error("Payload is missing wallet definition fields");
      }
      setPayload(parsed);
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : "Invalid JSON file");
    }
  };

  const submit = async () => {
    if (!payload) return;
    setBusy(true);
    try {
      const res = await fetch("/api/v1/wallet/transfer/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string })?.error ?? `Import failed (${res.status})`);
      }
      const result = body as { newWalletId: string; inviteUrl: string };
      toast({
        title: "Wallet imported",
        description: "Redirecting to the invite page so signers can claim.",
      });
      setOpen(false);
      reset();
      await router.push(`/wallets/invite/${result.newWalletId}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed";
      setError(msg);
      toast({ title: "Import failed", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        Import Transfer
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) reset();
          setOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Import wallet transfer</DialogTitle>
            <DialogDescription>
              Upload a wallet transfer JSON exported from another Multisig
              instance.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="transfer-file">Transfer file</Label>
              <Input
                id="transfer-file"
                type="file"
                accept="application/json,.json"
                ref={fileRef}
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              {fileName && (
                <p className="mt-1 text-xs text-muted-foreground">{fileName}</p>
              )}
            </div>

            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {payload && !error && (
              <Alert>
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>
                  <div className="space-y-1 text-sm">
                    <div>
                      <strong>{payload.wallet.name}</strong>
                    </div>
                    <div className="text-muted-foreground">
                      {payload.wallet.signersAddresses.length} signer
                      {payload.wallet.signersAddresses.length === 1 ? "" : "s"}
                      {" · "}
                      type: {payload.wallet.type}
                      {payload.contacts ? ` · ${payload.contacts.length} contacts` : ""}
                      {payload.ballots ? ` · ${payload.ballots.length} ballots` : ""}
                    </div>
                    {payload.exportedFromOrigin && (
                      <div className="text-muted-foreground text-xs">
                        from {payload.exportedFromOrigin}
                      </div>
                    )}
                  </div>
                </AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
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
            <Button onClick={submit} disabled={!payload || busy}>
              {busy ? (
                <>
                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Import
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
