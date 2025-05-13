import { useState, useMemo } from "react";
import { useWallet } from "@meshsdk/react";
import {
  checkSignature,
  generateNonce,
  resolvePaymentKeyHash,
} from "@meshsdk/core";

import { Wallet } from "@/types/wallet";
import { getFirstAndLast } from "@/lib/strings";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";

import { Check, MoreVertical, X } from "lucide-react";
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
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import DiscordIcon from "@/components/common/discordIcon";
import DiscordImage from "@/components/common/discordImage";
import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/common/row-label-info";
import { Button } from "@/components/ui/button";

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
        `${process.env.NODE_ENV === "production" ? "https://multisig.meshjs.dev" : "http://localhost:3000"}/api/auth/discord/callback`,
      );
      const scope = encodeURIComponent("identify");
      const state = encodeURIComponent(userAddress || "");

      const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;
      console.log("discord request url", url);
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
            <DiscordImage discordId={discordId} />
          ) : !isLoadingDiscordIds && userAddress && address == userAddress ? (
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
