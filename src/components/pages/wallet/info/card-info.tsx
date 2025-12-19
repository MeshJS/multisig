import { useState, useEffect } from "react";
import { Wallet } from "@/types/wallet";
import { MoreVertical, Users, Archive, User } from "lucide-react";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import useAppWallet from "@/hooks/useAppWallet";
import { deserializeAddress } from "@meshsdk/core";
import { getBalanceFromUtxos } from "@/utils/getBalance";
import { useWalletsStore } from "@/lib/zustand/wallets";
import ImgDragAndDrop from "@/components/common/ImgDragAndDrop";
import IPFSImage from "@/components/common/ipfs-image";
import Image from "next/image";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import CardUI from "@/components/ui/card-content";
import RowLabelInfo from "@/components/ui/row-label-info";
import RowLabelInfoCommon from "@/components/common/row-label-info";
import { NativeScriptSection } from "./inspect-script";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ChevronDown, ChevronUp, Code2, Sparkles } from "lucide-react";
import Code from "@/components/ui/code";
import { Carousel } from "@/components/ui/carousel";
import { type MultisigWallet } from "@/utils/multisigSDK";
import { getFirstAndLast } from "@/utils/strings";
import { getWalletType } from "@/utils/common";

export default function CardInfo({ appWallet }: { appWallet: Wallet }) {
  const [showEdit, setShowEdit] = useState(false);
  
  // Check if this is a legacy wallet using the centralized detection
  const walletType = getWalletType(appWallet);
  const isLegacyWallet = walletType === 'legacy';

  return (
    <CardUI
      title={appWallet.name}
      description={appWallet.description}
      profileImage={
        appWallet.profileImageIpfsUrl ? (
          <div className="relative aspect-square w-12 sm:w-14 rounded-lg overflow-hidden border border-border/50 shadow-sm">
            <IPFSImage
              src={appWallet.profileImageIpfsUrl}
              alt="Wallet Profile"
              fill
              className="object-cover object-center"
            />
          </div>
        ) : undefined
      }
      headerDom={
        <div className="flex items-center gap-2">
          {isLegacyWallet && (
            <Badge 
              variant="outline" 
              className="text-xs bg-orange-400/10 border-orange-400/30 text-orange-600 dark:text-orange-300"
            >
              <Archive className="h-3 w-3 mr-1" />
              Legacy
            </Badge>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-haspopup="true" size="icon" variant="ghost">
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Toggle menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setShowEdit(!showEdit)}>
                {showEdit ? "Close Edit" : "Edit Wallet"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      }
      cardClassName="col-span-2"
    >
      {showEdit ? (
        <EditInfo appWallet={appWallet} setShowEdit={setShowEdit} />
      ) : (
        <ShowInfo appWallet={appWallet} />
      )}
    </CardUI>
  );
}

function EditInfo({
  appWallet,
  setShowEdit,
}: {
  appWallet: Wallet;
  setShowEdit: (show: boolean) => void;
}) {
  const [name, setName] = useState<string>(appWallet.name);
  const [description, setDescription] = useState<string>(
    appWallet.description ?? "",
  );
  const [isArchived, setIsArchived] = useState<boolean>(appWallet.isArchived);
  const [profileImageIpfsUrl, setProfileImageIpfsUrl] = useState<string | null>(
    appWallet.profileImageIpfsUrl ?? null,
  );
  const [loading, setLoading] = useState<boolean>(false);
  const ctx = api.useUtils();
  const { toast } = useToast();
  const userAddress = useUserStore((state) => state.userAddress);

  const { mutate: updateWalletMetadata } = api.wallet.updateWallet.useMutation({
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

  async function editWallet() {
    setLoading(true);
    updateWalletMetadata({
      walletId: appWallet.id,
      name,
      description,
      isArchived,
      profileImageIpfsUrl: profileImageIpfsUrl || null,
    });
  }
  return (
    <fieldset className="grid gap-4 sm:gap-6">
      <div className="grid gap-2 sm:gap-3">
        <Label htmlFor="name">Name</Label>
        <Input
          id="name"
          type="text"
          className="w-full"
          placeholder="Fund12 Project X"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="grid gap-2 sm:gap-3">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          className="min-h-24 sm:min-h-32"
          placeholder="For managing Fund12 Project X catalyst fund / dRep for team X / Company X main spending wallet"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="grid gap-2 sm:gap-3">
        <Label htmlFor="profileImage">Profile Image</Label>
        <ImgDragAndDrop
          onImageUpload={(url) => setProfileImageIpfsUrl(url)}
          initialUrl={profileImageIpfsUrl}
        />
        <p className="text-xs text-muted-foreground">
          <strong>Note:</strong> Images will be stored on public IPFS (InterPlanetary File System). 
          Once uploaded, the image will be publicly accessible and cannot be removed from IPFS.
        </p>
      </div>
      <div className="grid gap-2 sm:gap-3">
        <Label htmlFor="type" className="text-sm">
          Archive Status
        </Label>
        <Select
          value={isArchived ? "true" : "false"}
          onValueChange={(value) =>
            setIsArchived(value === "true" ? true : false)
          }
          defaultValue={"false"}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="false">
                Show this wallet in the wallet list
              </SelectItem>
              <SelectItem value="true">Archive this wallet</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Archiving will remove it from your wallet list, but you can restore it later.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3 pt-2">
        <Button
          onClick={() => editWallet()}
          disabled={
            loading ||
            (appWallet.name === name && 
             appWallet.description === description && 
             appWallet.isArchived === isArchived &&
             appWallet.profileImageIpfsUrl === profileImageIpfsUrl)
          }
          className="flex-1 sm:flex-initial"
        >
          {loading ? "Updating Wallet..." : "Update"}
        </Button>
        <Button 
          onClick={() => setShowEdit(false)} 
          variant="outline"
          className="flex-1 sm:flex-initial"
        >
          Cancel
        </Button>
      </div>
    </fieldset>
  );
}

function MultisigScriptSection({ mWallet }: { mWallet: MultisigWallet }) {
  const [isOpen, setIsOpen] = useState(false);
  const { appWallet } = useAppWallet();
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const [balance, setBalance] = useState<number>(0);
  
  useEffect(() => {
    if (!appWallet) return;
    const utxos = walletsUtxos[appWallet.id];
    if (!utxos) return;
    const balance = getBalanceFromUtxos(utxos);
    if (!balance) return;
    setBalance(balance);
  }, [appWallet, walletsUtxos]);

  const dSAddr = deserializeAddress(mWallet.getScript().address);

  const slides: React.ReactNode[] = [
    <div key="meta" className="w-full space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 w-full">
        <div className="text-xs sm:text-sm font-medium text-muted-foreground min-w-0 sm:min-w-20 flex-shrink-0">1854:</div>
        <div className="flex-1 min-w-0 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <Code className="block text-xs sm:text-sm whitespace-pre">{JSON.stringify(mWallet?.getJsonMetadata(), null, 2)}</Code>
        </div>
      </div>
      
      {/* Register Wallet Section */}
      <div className="pt-3 border-t border-border/30">
        <div className="mb-2">
          <div className="text-xs sm:text-sm font-medium text-muted-foreground">Register Wallet</div>
          <div className="text-xs text-muted-foreground/70 mt-0.5">Register your Wallet through a CIP-0146 registration transaction.</div>
        </div>
        <div className="p-4 bg-muted/50 rounded-lg border border-border/30">
          <p className="text-sm text-muted-foreground">Coming soon.</p>
        </div>
      </div>
    </div>,
    <div key="payment" className="w-full space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 w-full">
        <div className="text-xs sm:text-sm font-medium text-muted-foreground min-w-0 sm:min-w-20 flex-shrink-0">payment:</div>
        <div className="flex-1 min-w-0 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <Code className="block text-xs sm:text-sm whitespace-pre">{JSON.stringify(mWallet?.buildScript(0), null, 2)}</Code>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 w-full">
        <div className="text-xs sm:text-sm font-medium text-muted-foreground min-w-0 sm:min-w-20 flex-shrink-0">Keyhash</div>
        <div className="flex-1 min-w-0 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <Code className="block text-xs sm:text-sm break-all">{dSAddr.scriptHash}</Code>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 w-full">
        <div className="text-xs sm:text-sm font-medium text-muted-foreground min-w-0 sm:min-w-20 flex-shrink-0">CBOR</div>
        <div className="flex-1 min-w-0 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
          <Code className="block text-xs sm:text-sm break-all">{mWallet.getPaymentScript()}</Code>
        </div>
      </div>
      {appWallet?.stakeCredentialHash && (
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 w-full">
          <div className="text-xs sm:text-sm font-medium text-muted-foreground min-w-0 sm:min-w-20 flex-shrink-0">Stake Credential Hash</div>
          <div className="flex-1 min-w-0 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <Code className="block text-xs sm:text-sm break-all">{appWallet?.stakeCredentialHash}</Code>
          </div>
        </div>
      )}
    </div>,
  ];

  if (mWallet?.buildScript(2) !== undefined && mWallet.stakingEnabled()) {
    slides.push(
      <div key="stake-2" className="w-full space-y-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 w-full">
          <div className="text-xs sm:text-sm font-medium text-muted-foreground min-w-0 sm:min-w-20 flex-shrink-0">stake:</div>
          <div className="flex-1 min-w-0 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <Code className="block text-xs sm:text-sm whitespace-pre">{JSON.stringify(mWallet.buildScript(2), null, 2)}</Code>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 w-full">
          <div className="text-xs sm:text-sm font-medium text-muted-foreground min-w-0 sm:min-w-20 flex-shrink-0">Keyhash</div>
          <div className="flex-1 min-w-0 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <Code className="block text-xs sm:text-sm break-all">{dSAddr.stakeScriptCredentialHash}</Code>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 w-full">
          <div className="text-xs sm:text-sm font-medium text-muted-foreground min-w-0 sm:min-w-20 flex-shrink-0">CBOR</div>
          <div className="flex-1 min-w-0 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <Code className="block text-xs sm:text-sm break-all">{mWallet.getStakingScript()}</Code>
          </div>
        </div>
      </div>,
    );
  }

  if (mWallet?.buildScript(3) !== undefined && mWallet.isGovernanceEnabled()) {
    slides.push(
      <div key="drep-3" className="w-full space-y-3">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 w-full">
          <div className="text-xs sm:text-sm font-medium text-muted-foreground min-w-0 sm:min-w-20 flex-shrink-0">drep:</div>
          <div className="flex-1 min-w-0 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <Code className="block text-xs sm:text-sm whitespace-pre">{JSON.stringify(mWallet.buildScript(3), null, 2)}</Code>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 w-full">
          <div className="text-xs sm:text-sm font-medium text-muted-foreground min-w-0 sm:min-w-20 flex-shrink-0">DRep Script CBOR</div>
          <div className="flex-1 min-w-0 overflow-x-auto -mx-4 sm:mx-0 px-4 sm:px-0">
            <Code className="block text-xs sm:text-sm break-all">{mWallet.getDRepScript()}</Code>
          </div>
        </div>
      </div>,
    );
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger className="flex items-center justify-between w-full p-3 rounded-lg border border-border/30 bg-muted/30 hover:bg-muted/50 transition-colors">
        <div className="flex items-center gap-2">
          <Code2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Advanced Script Details</span>
        </div>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3">
        {/* Carousel for script details */}
        <Carousel slides={slides} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function ShowInfo({ appWallet }: { appWallet: Wallet }) {
  const { multisigWallet } = useMultisigWallet();
  const walletsUtxos = useWalletsStore((state) => state.walletsUtxos);
  const [balance, setBalance] = useState<number>(0);
  
  useEffect(() => {
    if (!appWallet) return;
    const utxos = walletsUtxos[appWallet.id];
    if (!utxos) return;
    const balance = getBalanceFromUtxos(utxos);
    if (!balance) return;
    setBalance(balance);
  }, [appWallet, walletsUtxos]);

  // Check if this is a legacy wallet using the centralized detection
  const walletType = getWalletType(appWallet);
  const isLegacyWallet = walletType === 'legacy';
  
  // For legacy wallets, multisigWallet will be undefined, so use appWallet.address
  // For SDK wallets, prefer the address from multisigWallet if staking is enabled
  const address = multisigWallet?.getKeysByRole(2) ? multisigWallet?.getScript().address : appWallet.address;
  
  // Get DRep ID from multisig wallet if available (it handles no DRep keys by using payment script),
  // otherwise fallback to appWallet (for legacy wallets without multisigWallet)
  const dRepId = multisigWallet ? multisigWallet.getDRepId() : appWallet?.dRepId;
  
  // For rawImportBodies wallets, dRepId may not be available
  const showDRepId = dRepId && dRepId.length > 0;
  
  // Calculate signers info
  const signersCount = appWallet.signersAddresses.length;
  const requiredSigners = appWallet.numRequiredSigners ?? signersCount;
  const getSignersText = () => {
    if (appWallet.type === 'all') {
      return `All ${signersCount} signers required`;
    } else if (appWallet.type === 'any') {
      return `Any of ${signersCount} signers`;
    } else {
      return `${requiredSigners} of ${signersCount} signers`;
    }
  };
  
  // Get the number of required signers for visualization
  const getRequiredCount = () => {
    if (appWallet.type === 'all') {
      return signersCount;
    } else if (appWallet.type === 'any') {
      return 1;
    } else {
      return requiredSigners;
    }
  };
  
  const requiredCount = getRequiredCount();
  
  return (
    <div className="space-y-6">
      {/* Top Section: Key Info */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
          {/* Signing Threshold */}
          <div className="flex items-center gap-3 p-4 bg-muted/40 rounded-lg border border-border/40">
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {Array.from({ length: signersCount }).map((_, index) => (
                <User
                  key={index}
                  className={`h-4 w-4 sm:h-5 sm:w-5 ${
                    index < requiredCount
                      ? "text-foreground opacity-100"
                      : "text-muted-foreground opacity-30"
                  }`}
                />
              ))}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-muted-foreground mb-0.5">Signing Threshold</div>
              <div className="text-sm font-semibold">{getSignersText()}</div>
            </div>
          </div>
          
          {/* Balance */}
          <div className="flex flex-col justify-center p-4 bg-muted/40 rounded-lg border border-border/40">
            <div className="text-xs font-medium text-muted-foreground mb-1">Balance</div>
            <div className="text-2xl sm:text-3xl font-bold">{balance} ₳</div>
          </div>
      </div>
      
      {/* Addresses Section */}
      <div className="space-y-3 pt-2 border-t border-border/30">
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Wallet Details</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* Address */}
          <RowLabelInfo
            label="Address"
            value={getFirstAndLast(address, 20, 15)}
            copyString={address}
            allowOverflow={false}
          />
          
          {/* Stake Address - Show if staking is enabled */}
          {multisigWallet && multisigWallet.stakingEnabled() && (() => {
            const stakeAddress = multisigWallet.getStakeAddress();
            return stakeAddress ? (
              <RowLabelInfo
                label="Stake Key"
                value={getFirstAndLast(stakeAddress, 20, 15)}
                copyString={stakeAddress}
                allowOverflow={false}
              />
            ) : null;
          })()}
          
          {/* External Stake Key Hash - Always show if available */}
          {appWallet?.stakeCredentialHash && (
            <RowLabelInfo
              label="External Stake Key Hash"
              value={getFirstAndLast(appWallet.stakeCredentialHash, 20, 15)}
              copyString={appWallet.stakeCredentialHash}
              allowOverflow={false}
            />
          )}
          
          {/* DRep ID */}
          {showDRepId && dRepId ? (
            <RowLabelInfo
              label="DRep ID"
              value={getFirstAndLast(dRepId ?? "", 20, 15)}
              copyString={dRepId ?? ""}
              allowOverflow={false}
            />
          ) : isLegacyWallet ? (
            <RowLabelInfo
              label="DRep ID"
              value="Not available for legacy wallets"
              copyString=""
            />
          ) : null}
        </div>
      </div>
      
      {/* Native Script - Collapsible Pro Feature */}
      <div className="pt-2 border-t border-border/30">
        {multisigWallet && multisigWallet.stakingEnabled() ? (
          <MultisigScriptSection mWallet={multisigWallet} />
        ) : (
          <NativeScriptSection appWallet={appWallet} />
        )}
      </div>
    </div>
  );
}
