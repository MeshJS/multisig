import Button from "@/components/common/button";
import CardUI from "@/components/ui/card-content";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";
import { Wallet } from "@/types/wallet";
import { api } from "@/utils/api";
import { useRouter } from "next/router";

export function ArchiveWallet({ appWallet }: { appWallet: Wallet }) {
  const ctx = api.useUtils();
  const { toast } = useToast();
  const userAddress = useUserStore((state) => state.userAddress);
  const router = useRouter();

  const { mutate: updateWalletMetadata } = api.wallet.updateWallet.useMutation({
    onSuccess: async (data) => {
      toast({
        title: data.isArchived ? "Wallet Archived" : "Wallet Restored",
        description: `This wallet has been ${data.isArchived ? "archived" : "restored"}`,
        duration: 5000,
      });
      void ctx.wallet.getWallet.invalidate({
        address: userAddress,
        walletId: appWallet.id,
      });
      router.push(`/wallets`);
    },
    onError: (e) => {
      console.error(e);
    },
  });

  async function archiveWallet(isArchived: boolean) {
    updateWalletMetadata({
      walletId: appWallet.id,
      name: appWallet.name,
      description: appWallet.description ?? "",
      isArchived: isArchived,
    });
  }

  return (
    <CardUI
      title="Archive Wallet"
      description="Archive this wallet to remove it from your wallet list"
      cardClassName="col-span-2"
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {appWallet.isArchived 
            ? "This wallet is currently archived and hidden from your wallet list."
            : "Archiving this wallet will remove it from your list of wallets. You can always restore it later."}
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          {appWallet.isArchived ? (
            <Button 
              onClick={() => archiveWallet(false)} 
              variant="default"
              className="w-full sm:w-auto"
            >
              Restore Wallet
            </Button>
          ) : (
            <Button 
              onClick={() => archiveWallet(true)} 
              variant="destructive"
              className="w-full sm:w-auto"
            >
              Archive Wallet
            </Button>
          )}
        </div>
      </div>
    </CardUI>
  );
}
