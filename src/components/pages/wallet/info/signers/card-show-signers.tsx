import { useMemo, useState, useEffect } from "react";
import { useWallet } from "@meshsdk/react";
import { checkSignature, generateNonce } from "@meshsdk/core";
import { getFirstAndLast } from "@/utils/strings";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { Check, X, Copy, User } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import DiscordIcon from "@/components/common/discordIcon";
import { Button } from "@/components/ui/button";
import { Wallet } from "@/types/wallet";
import Image from "next/image";
import getDiscordAvatar from "@/lib/discord/getDiscordAvatar";

interface ShowSignersProps {
  appWallet: Wallet;
}

export default function ShowSigners({ appWallet }: ShowSignersProps) {
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const { toast } = useToast();
  const ctx = api.useUtils();
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());

  const copyToClipboard = async (text: string, itemId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedItems(prev => new Set(prev).add(itemId));
      
      toast({
        title: "Copied to clipboard",
        description: text,
        duration: 3000,
      });
      
      setTimeout(() => {
        setCopiedItems(prev => {
          const newSet = new Set(prev);
          newSet.delete(itemId);
          return newSet;
        });
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      toast({
        title: "Copy failed",
        description: "Failed to copy to clipboard",
        variant: "destructive",
        duration: 3000,
      });
    }
  };

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

  const { data: currentUserDiscordId } = api.user.getUserDiscordId.useQuery({
    address: userAddress ?? "",
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
      console.log({
        endpoint: "https://discord.com/api/oauth2/token",
        client_id: process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID,
        client_secret_set: !!process.env.DISCORD_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      });
      window.location.href = url;
    }

    return appWallet.signersAddresses.map((address, index) => {
      const discordId = discordIds?.[address];
      const signerName = appWallet.signersDescriptions[index] && 
        appWallet.signersDescriptions[index].length > 0
          ? appWallet.signersDescriptions[index]
          : `Signer ${index + 1}`;
      const isVerified = appWallet.verified.includes(address);
      const isCurrentUser = userAddress && address === userAddress;

      return (
        <SignerProfilePicture
          key={address}
          discordId={discordId}
          address={address}
          signerName={signerName}
          isVerified={isVerified}
          isCurrentUser={isCurrentUser}
          index={index}
          appWallet={appWallet}
          userAddress={userAddress}
          connected={connected}
          wallet={wallet}
          updateWalletVerifiedList={updateWalletVerifiedList}
          isLoadingDiscordIds={isLoadingDiscordIds}
          currentUserDiscordId={currentUserDiscordId}
          copyToClipboard={copyToClipboard}
          copiedItems={copiedItems}
          signVerify={async () => {
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
          }}
          handleConnectDiscord={() => {
            const DISCORD_CLIENT_ID = process.env.NEXT_PUBLIC_DISCORD_CLIENT_ID;
            const redirectUri = encodeURIComponent(
              `${process.env.NODE_ENV === "production" ? "https://multisig.meshjs.dev" : "http://localhost:3000"}/api/auth/discord/callback`,
            );
            const scope = encodeURIComponent("identify");
            const state = encodeURIComponent(userAddress || "");

            const url = `https://discord.com/api/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&state=${state}`;
            window.location.href = url;
          }}
        />
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
    currentUserDiscordId,
    copiedItems,
  ]);

  return (
    <div className="space-y-4 sm:space-y-6">
      {signersList}
    </div>
  );
}

interface SignerProfilePictureProps {
  discordId?: string;
  address: string;
  signerName: string;
  isVerified: boolean;
  isCurrentUser: boolean;
  index: number;
  appWallet: Wallet;
  userAddress: string | null;
  connected: boolean;
  wallet: any;
  updateWalletVerifiedList: any;
  isLoadingDiscordIds: boolean;
  currentUserDiscordId?: string;
  copyToClipboard: (text: string, itemId: string) => Promise<void>;
  copiedItems: Set<string>;
  signVerify: () => Promise<void>;
  handleConnectDiscord: () => void;
}

function SignerProfilePicture({
  discordId,
  address,
  signerName,
  isVerified,
  isCurrentUser,
  index,
  appWallet,
  userAddress,
  connected,
  wallet,
  updateWalletVerifiedList,
  isLoadingDiscordIds,
  currentUserDiscordId,
  copyToClipboard,
  copiedItems,
  signVerify,
  handleConnectDiscord,
}: SignerProfilePictureProps) {
  const [discordAvatarUrl, setDiscordAvatarUrl] = useState<string | null>(null);
  const [isLoadingAvatar, setIsLoadingAvatar] = useState(false);

  useEffect(() => {
    if (discordId) {
      setIsLoadingAvatar(true);
      getDiscordAvatar(discordId)
        .then((url) => {
          setDiscordAvatarUrl(url);
          setIsLoadingAvatar(false);
        })
        .catch(() => {
          setIsLoadingAvatar(false);
        });
    } else {
      setDiscordAvatarUrl(null);
    }
  }, [discordId]);

  const ProfileIcon = () => {
    if (discordAvatarUrl && !isLoadingAvatar) {
      return (
        <div className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 overflow-hidden">
          <Image
            src={discordAvatarUrl}
            width={24}
            height={24}
            alt={signerName}
            className="rounded-full"
          />
        </div>
      );
    }
    return (
      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <User className="w-3 h-3 text-primary" />
      </div>
    );
  };

  const DesktopProfileIcon = () => {
    if (discordAvatarUrl && !isLoadingAvatar) {
      return (
        <div className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center overflow-hidden">
          <Image
            src={discordAvatarUrl}
            width={28}
            height={28}
            alt={signerName}
            className="rounded-full"
          />
        </div>
      );
    }
    return (
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center">
        <User className="w-3.5 h-3.5 text-primary" />
      </div>
    );
  };

  return (
    <div className="p-3 sm:p-4 border rounded-lg bg-card">
      {/* Mobile Layout */}
      <div className="flex flex-col gap-3 sm:hidden">
        {/* Header */}
        <div className="flex items-center gap-2">
          <ProfileIcon />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium truncate">{signerName}</h3>
          </div>
          {/* Verification Status */}
          {isVerified ? (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Verified</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger>
                  <X className="h-4 w-4 text-red-400 flex-shrink-0" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>Not verified</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>

        {/* Address */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono flex-1 min-w-0 break-all">
            {getFirstAndLast(address)}
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => copyToClipboard(address, `addr-${index}`)}
            className="h-7 w-7 p-0 flex-shrink-0"
          >
            {copiedItems.has(`addr-${index}`) ? (
              <Check className="w-3.5 h-3.5 text-green-600" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {!isVerified && isCurrentUser && (
            <Button size="sm" onClick={() => signVerify()} className="h-8 px-3 text-xs flex-1">
              Verify
            </Button>
          )}
          {!discordId && !isLoadingDiscordIds && isCurrentUser ? (
            <Button size="sm" onClick={() => handleConnectDiscord()} className="h-8 px-3 text-xs flex-1">
              Connect Discord
            </Button>
          ) : currentUserDiscordId && !discordId ? (
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
          ) : null}
        </div>
      </div>

      {/* Desktop Layout */}
      <div className="hidden sm:flex items-center justify-between">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* User Icon */}
          <DesktopProfileIcon />
          
          {/* Signer Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-base font-medium truncate">{signerName}</h3>
              {/* Verification Status */}
              {isVerified ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Verified</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <X className="h-4 w-4 text-red-400 flex-shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Not verified</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-sm text-muted-foreground font-mono">
                {getFirstAndLast(address)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(address, `addr-${index}`)}
                className="h-7 w-7 p-0"
              >
                {copiedItems.has(`addr-${index}`) ? (
                  <Check className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Verification Button */}
          {!isVerified && isCurrentUser && (
            <Button size="sm" onClick={() => signVerify()} className="h-8 px-3 text-sm">
              Verify
            </Button>
          )}

          {/* Discord Status */}
          {!discordId && !isLoadingDiscordIds && isCurrentUser ? (
            <Button size="sm" onClick={() => handleConnectDiscord()} className="h-8 px-3 text-sm">
              Connect Discord
            </Button>
          ) : currentUserDiscordId && !discordId ? (
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
          ) : null}
        </div>
      </div>
    </div>
  );
}
