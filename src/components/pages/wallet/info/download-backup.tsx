import Button from "@/components/common/button";
import CardUI from "@/components/ui/card-content";
import { useToast } from "@/hooks/use-toast";
import { Wallet } from "@/types/wallet";
import { api } from "@/utils/api";

/**
 * Download a JSON snapshot of the wallet config that the Import Wallet
 * wizard's JSON tab can ingest. Purely a config export — no transactions,
 * no signed history. The server-side integrity hash binds the payload to
 * this wallet so a stolen file can't be relabeled as a different wallet.
 */
export function DownloadBackup({ appWallet }: { appWallet: Wallet }) {
  const { toast } = useToast();
  const { refetch, isFetching } = api.wallet.exportWallet.useQuery(
    { walletId: appWallet.id },
    { enabled: false },
  );

  async function handleDownload() {
    try {
      const result = await refetch();
      if (!result.data) {
        throw new Error(result.error?.message ?? "Export returned no data");
      }
      const envelope = {
        ...result.data,
        sourceInstance:
          typeof window !== "undefined" ? window.location.origin : undefined,
        exportedAt: new Date().toISOString(),
      };
      const blob = new Blob([JSON.stringify(envelope, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slugify(appWallet.name)}-wallet-backup.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({
        title: "Backup downloaded",
        description: "Import it on any instance via Wallets → Import Wallet → Upload JSON.",
        duration: 4000,
      });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <CardUI
      title="Download JSON backup"
      description="Export this wallet's config so you can import it on another instance"
      cardClassName="col-span-2"
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          The file contains signers, the script CBOR, and signing policy —
          everything needed to recreate this wallet's local record on
          another deployment. No funds move and no transactions are
          included.
        </p>
        <div>
          <Button
            onClick={() => void handleDownload()}
            disabled={isFetching}
            variant="default"
            className="w-full sm:w-auto"
          >
            {isFetching ? "Preparing…" : "Download backup"}
          </Button>
        </div>
      </div>
    </CardUI>
  );
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "wallet"
  );
}
