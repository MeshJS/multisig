import { useMemo } from "react";
import { useWallet } from "@meshsdk/react";
import { checkSignature, generateNonce } from "@meshsdk/core";
import { getFirstAndLast } from "@/utils/strings";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { Check, X } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import DiscordIcon from "@/components/common/discordIcon";
import DiscordImage from "@/components/common/discordImage";
import RowLabelInfo from "@/components/common/row-label-info";
import { Button } from "@/components/ui/button";
import { Wallet } from "@/types/wallet";

interface ShowSignersProps {
  appWallet: Wallet;
}

export default function ShowSigners({ appWallet }: ShowSignersProps) {
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const { toast } = useToast();
  const ctx = api.useUtils();

  const { mutate: updateWalletVerifiedList } =
    api.wallet.updateWalletVerifiedList.useMutation({
      onSuccess: async () => {
        toast({
          title: "Wallet verified",
          description: "You have successfully verified this wallet",
          duration: 5000,
        });
        void ctx.wallet.getWallet.invalidate({
          address: userAddress,
          walletId: appWallet.id,
        });
      },
      onError: (e) => {
        console.error(e);
      },
    });

  const { data: discordIds, isLoading: isLoadingDiscordIds } =
    api.user.getDiscordIds.useQuery({
      addresses: appWallet.signersAddresses,
    });

  const signersList = useMemo(() => {
    async function signVerify() {
      if (!userAddress) throw new Error("User address not found");
      if (!connected) throw new Error("Wallet not connected");

      const userRewardAddress = (await wallet.getRewardAddresses())[0];
      const nonce = generateNonce("Verify this wallet: ");
      const signature = await wallet.signData(nonce, userRewardAddress);
      const result = await checkSignature(nonce, signature);

      if (result) {
        const _verified = appWallet.verified;
        _verified.push(userAddress);

        updateWalletVerifiedList({
          walletId: appWallet.id,
          verified: _verified,
        });
      }
    }

    function handleConnectDiscord() {
      const DISCORD_CLIENT_ID = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
      const redirectUri = encodeURIComponent(
        `${window.location.origin}/api/auth/discord/callback`
      );
      const scope = encodeURIComponent("identify");
      const state = encodeURIComponent(userAddress || "");

      const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;

      window.location.href = url;
    }

    return appWallet.signersAddresses.map((address, index) => {
      const discordId = discordIds?.[address];
      return (
        <RowLabelInfo
          label={
            appWallet.signersDescriptions[index] &&
            appWallet.signersDescriptions[index].length > 0
              ? appWallet.signersDescriptions[index]
              : `Signer ${index + 1}`
          }
          value={getFirstAndLast(address)}
          copyString={address}
          key={address}
        >
          <>
            {appWallet.verified.includes(address) ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <Check className="h-4 w-4 text-green-400" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>This address has been verified.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : (
              <>
                {userAddress && address === userAddress ? (
                  <Button size="sm" onClick={() => signVerify()}>
                    Verify
                  </Button>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger>
                        <X className="h-4 w-4 text-red-400" />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>This address has not been verified.</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </>
            )}
          </>
          {discordId ? (
            <DiscordImage discordId={discordId} />
          ) : !isLoadingDiscordIds && userAddress && address === userAddress ? (
            <Button size="sm" onClick={() => handleConnectDiscord()}>
              Connect Discord
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger className="text-gray-500">
                  <DiscordIcon />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Discord not connected</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </RowLabelInfo>
      );
    });
  }, [
    appWallet,
    discordIds,
    userAddress,
    connected,
    wallet,
    updateWalletVerifiedList,
    isLoadingDiscordIds,
  ]);

  return <>{signersList}</>;
}
