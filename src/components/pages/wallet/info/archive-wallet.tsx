import Button from "@/components/common/button";
import CardUI from "@/components/common/card-content";
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
      description="Archive this wallet"
      cardClassName="col-span-2"
    >
      <p>
        Archiving this wallet will remove it from your list of wallets. You can
        always restore it later.
      </p>
      <div>
        {appWallet.isArchived ? (
          <Button onClick={() => archiveWallet(false)} variant="default">
            Restore Wallet
          </Button>
        ) : (
          <Button onClick={() => archiveWallet(true)} variant="destructive">
            Archive Wallet
          </Button>
        )}
      </div>
    </CardUI>
  );
}
