import { Check, MoreVertical, X } from "lucide-react";
import { getFirstAndLast } from "@/lib/strings";
import { Wallet } from "@/types/wallet";
import CardUI from "@/components/common/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { Button } from "@/components/ui/button";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useWallet } from "@meshsdk/react";
import {
  checkSignature,
  generateNonce,
  resolvePaymentKeyHash,
} from "@meshsdk/core";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMemo } from "react";

// Add this SVG component
const DiscordIcon = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    fill="currentColor"
    viewBox="0 0 16 16"
  >
    <path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612" />
  </svg>
);

export default function CardSigners({ appWallet }: { appWallet: Wallet }) {
  const [showEdit, setShowEdit] = useState(false);

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
      headerDom={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-haspopup="true" size="icon" variant="ghost">
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setShowEdit(!showEdit)}>
              {showEdit ? "Close Edit" : "Edit Signer Descriptions"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
      cardClassName="col-span-2"
    >
      {showEdit ? (
        <EditSigners appWallet={appWallet} setShowEdit={setShowEdit} />
      ) : (
        <ShowSigners appWallet={appWallet} />
      )}
    </CardUI>
  );
}

function EditSigners({
  appWallet,
  setShowEdit,
}: {
  appWallet: Wallet;
  setShowEdit: (show: boolean) => void;
}) {
  const signersAddresses = appWallet.signersAddresses;
  const [signersDescriptions, setSignerDescription] = useState<string[]>(
    appWallet.signersDescriptions,
  );
  const [loading, setLoading] = useState<boolean>(false);
  const ctx = api.useUtils();
  const { toast } = useToast();
  const userAddress = useUserStore((state) => state.userAddress);

  const { mutate: updateWalletSignersDescriptions } =
    api.wallet.updateWalletSignersDescriptions.useMutation({
      onSuccess: async () => {
        toast({
          title: "Wallet Info Updated",
          description: "The wallet's metadata has been updated",
          duration: 5000,
        });
        setLoading(false);
        void ctx.wallet.getWallet.invalidate({
          address: userAddress,
          walletId: appWallet.id,
        });
        setShowEdit(false);
      },
      onError: (e) => {
        console.error(e);
        setLoading(false);
      },
    });

  function checkValidAddress(address: string) {
    try {
      resolvePaymentKeyHash(address);
      return true;
    } catch (e) {
      return false;
    }
  }

  function update() {
    setLoading(true);
    updateWalletSignersDescriptions({
      walletId: appWallet.id,
      signersDescriptions: signersDescriptions,
    });
  }

  return (
    <>
      <Table>
        <TableBody>
          {signersAddresses.map((signer, index) => (
            <TableRow key={index}>
              <TableCell>
                <div className="grid gap-4 py-4">
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Address</Label>
                    <Input
                      type="string"
                      placeholder="addr1..."
                      className={`col-span-3 ${
                        signersAddresses[index] != "" &&
                        !checkValidAddress(signersAddresses[index]!) &&
                        "text-red-500"
                      }`}
                      value={signer}
                      disabled={true}
                    />
                  </div>
                  <div className="grid grid-cols-4 items-center gap-4">
                    <Label className="text-right">Description</Label>
                    <Input
                      className="col-span-3"
                      value={signersDescriptions[index]}
                      onChange={(e) => {
                        const newSigners = [...signersDescriptions];
                        newSigners[index] = e.target.value;
                        setSignerDescription(newSigners);
                      }}
                      placeholder="optional name or description of this signer"
                    />
                  </div>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex gap-4">
        <Button onClick={update} disabled={loading}>
          {loading ? "Updating Wallet..." : "Update"}
        </Button>
        <Button onClick={() => setShowEdit(false)} variant="destructive">
          Cancel
        </Button>
      </div>
    </>
  );
}

function ShowSigners({ appWallet }: { appWallet: Wallet }) {
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
      // Discord OAuth2 URL with required scopes
      const DISCORD_CLIENT_ID = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
      const redirectUri = encodeURIComponent(
        `${window.location.origin}/api/auth/discord/callback`,
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
          {discordId ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <DiscordIcon />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Discord connected</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : !isLoadingDiscordIds && userAddress && address == userAddress ? (
            <Button size="sm" onClick={() => handleConnectDiscord()}>
              Connect Discord
            </Button>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger className="text-muted-foreground">
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
