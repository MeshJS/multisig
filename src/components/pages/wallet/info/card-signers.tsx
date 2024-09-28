import { Check, Key, X } from "lucide-react";
import { getFirstAndLast } from "@/lib/strings";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { Button } from "@/components/ui/button";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import { checkSignature, generateNonce } from "@meshsdk/core";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function CardSigners({ appWallet }: { appWallet: Wallet }) {
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

  async function signVerify() {
    if (!userAddress) throw new Error("User address not found");
    if (!connected) throw new Error("Wallet not connected");

    const userRewardAddress = (await wallet.getRewardAddresses())[0];
    const nonce = generateNonce("Verify this wallet: ");
    const signature = await wallet.signData(nonce, userRewardAddress);
    const result = checkSignature(nonce, signature);

    if (result) {
      const _verified = appWallet.verified;
      _verified.push(userAddress);

      updateWalletVerifiedList({
        walletId: appWallet.id,
        verified: _verified,
      });
    }
  }

  return (
    <CardUI
      title="Signers"
      description={
        <>
          This wallet requires{" "}
          <b className="text-white">{appWallet.numRequiredSigners}</b> signers
          to sign a transaction.
        </>
      }
      icon={Key}
      cardClassName="col-span-2"
    >
      {appWallet.signersAddresses.map((address, index) => (
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
                {userAddress && address == userAddress ? (
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
        </RowLabelInfo>
      ))}
    </CardUI>
  );
}
