import { useMemo, useState } from "react";
import { api } from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { useUserStore } from "@/lib/zustand/user";
import { useWalletsStore } from "@/lib/zustand/wallets";
import { checkValidAddress, checkValidStakeKey } from "@/utils/multisigSDK";
import { getFirstAndLast } from "@/utils/strings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Wallet } from "@/types/wallet";
import useUser from "@/hooks/useUser";
import { User, Copy, Check } from "lucide-react";

interface EditSignersProps {
  appWallet: Wallet;
  setShowEdit: (show: boolean) => void;
}

export default function EditSigners({
  appWallet,
  setShowEdit,
}: EditSignersProps) {
  const signersAddresses = appWallet.signersAddresses;
  const signersStakeKeys = appWallet.signersStakeKeys ?? [];
  const [signersDescriptions, setSignerDescription] = useState<string[]>(
    appWallet.signersDescriptions,
  );
  const [loading, setLoading] = useState<boolean>(false);
  const [copiedItems, setCopiedItems] = useState<Set<string>>(new Set());
  const ctx = api.useUtils();
  const { toast } = useToast();
  const userAddress = useUserStore((state) => state.userAddress);
  const { user } = useUser();
  const drepInfo = useWalletsStore((state) => state.drepInfo);

  const copyToClipboard = async (text: string, itemId: string, itemType: string) => {
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

  const { mutate: updateWalletSignersDescriptions } =
    api.wallet.updateWalletSignersDescriptions.useMutation({
      onSuccess: async () => {
        toast({
          title: "Wallet Info Updated",
          description: "The wallet's metadata has been updated",
          duration: 5000,
        });
        setLoading(false);
        await ctx.wallet.getWallet.invalidate({
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

  function update() {
    // Prevent DRep key updates if DRep is registered
    if (drepInfo?.active) {
      toast({
        title: "Cannot Update DRep Keys",
        description: "DRep is currently registered. You must deregister the DRep before updating DRep keys.",
        variant: "destructive",
        duration: 5000,
      });
      return;
    }
    
    setLoading(true);
    updateWalletSignersDescriptions({
      walletId: appWallet.id,
      signersDescriptions: signersDescriptions,
      signersStakeKeys: updatedStakeKeys,
      signersDRepKeys: updatedDRepKeys,
    });
  }

  const updatedStakeKeys = useMemo(() => {
    const skList: string[] = Array(signersAddresses.length).fill("");
    for (let i = 0; i < signersAddresses.length; i++) {
      const stakeAddr = user?.stakeAddress;
      if (
        signersAddresses[i] === userAddress &&
        stakeAddr !== undefined &&
        !signersStakeKeys?.[i]
      ) {
        skList[i] = stakeAddr;
      } else {
        skList[i] = signersStakeKeys[i] ?? "";
      }
    }
    return skList;
  }, [signersAddresses, signersStakeKeys, userAddress, user?.stakeAddress]);

  const updatedDRepKeys = useMemo(() => {
    const dkList: string[] = Array(signersAddresses.length).fill("");
    for (let i = 0; i < signersAddresses.length; i++) {
      const drepKey = (user as any)?.drepKeyHash;
      if (
        signersAddresses[i] === userAddress &&
        drepKey !== undefined &&
        !(appWallet as any).signersDRepKeys?.[i]
      ) {
        dkList[i] = drepKey;
      } else {
        dkList[i] = (appWallet as any).signersDRepKeys?.[i] ?? "";
      }
    }
    return dkList;
  }, [signersAddresses, appWallet, userAddress, user]);

  const newStakekey = (index: number) => {
    const stakeAddr = user?.stakeAddress;
    return (
      signersAddresses[index] === userAddress &&
      stakeAddr !== undefined &&
      signersStakeKeys[index] !== stakeAddr
    );
  };

  const newDRepKey = (index: number) => {
    const drepKey = (user as any)?.drepKeyHash;
    return (
      signersAddresses[index] === userAddress &&
      drepKey !== undefined &&
      (appWallet as any).signersDRepKeys?.[index] !== drepKey &&
      !drepInfo?.active // Don't show as new if DRep is registered
    );
  };

  return (
    <>
      <div className="space-y-4 sm:space-y-6">
        {signersAddresses.map((signer, index) => {
          const stakeAddr = signersAddresses[index] === userAddress
            ? user?.stakeAddress ?? ""
            : signersStakeKeys[index] ?? "";
          const drepKey = signersAddresses[index] === userAddress
            ? (user as any)?.drepKeyHash ?? ""
            : (appWallet as any).signersDRepKeys?.[index] ?? "";

          return (
            <div key={index} className="border rounded-lg p-3 sm:p-4 bg-card">
              <div className="space-y-3 sm:space-y-4">
                {/* Signer's Name at the top with user icon */}
                <div className="flex items-center gap-2 sm:gap-3 pb-2 sm:pb-3 border-b">
                  <div className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <Input
                      className="border-0 p-0 h-auto text-sm sm:text-base font-medium bg-transparent focus-visible:ring-0"
                      value={signersDescriptions[index]}
                      onChange={(e) => {
                        const newSigners = [...signersDescriptions];
                        newSigners[index] = e.target.value;
                        setSignerDescription(newSigners);
                      }}
                      placeholder="Signer's name"
                    />
                  </div>
                </div>

                {/* Address Field */}
                <div className="space-y-2">
                  <Label className="text-xs sm:text-sm font-medium">Address</Label>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 p-2 sm:p-3 rounded-md border bg-muted/50 font-mono text-xs sm:text-sm break-all">
                      {signer ? getFirstAndLast(signer) : "No address"}
                    </div>
                    {signer && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(signer, `addr-${index}`, "Address")}
                        className="flex-shrink-0 h-8 w-8 p-0 sm:h-9 sm:w-9"
                      >
                        {copiedItems.has(`addr-${index}`) ? (
                          <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Stake Address Field */}
                <div className="space-y-2">
                  <Label className="text-xs sm:text-sm font-medium">Stake Address</Label>
                  <div className="flex items-start gap-2">
                    <div className={`flex-1 p-2 sm:p-3 rounded-md border font-mono text-xs sm:text-sm break-all ${
                      newStakekey(index) 
                        ? "bg-green-50 border-green-500 text-green-700" 
                        : "bg-muted/50"
                    }`}>
                      {stakeAddr ? getFirstAndLast(stakeAddr) : "No stake address"}
                    </div>
                    {stakeAddr && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(stakeAddr, `stake-${index}`, "Stake address")}
                        className="flex-shrink-0 h-8 w-8 p-0 sm:h-9 sm:w-9"
                      >
                        {copiedItems.has(`stake-${index}`) ? (
                          <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                  {newStakekey(index) && (
                    <p className="text-xs sm:text-sm text-green-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0"></span>
                      <span className="break-words">Click Update to add your stake key to the multisig wallet.</span>
                    </p>
                  )}
                </div>

                {/* DRep Key Field */}
                <div className="space-y-2">
                  <Label className="text-xs sm:text-sm font-medium">DRep Key</Label>
                  <div className="flex items-start gap-2">
                    <div className={`flex-1 p-2 sm:p-3 rounded-md border font-mono text-xs sm:text-sm break-all ${
                      newDRepKey(index) 
                        ? "bg-green-50 border-green-500 text-green-700" 
                        : "bg-muted/50"
                    }`}>
                      {drepKey ? getFirstAndLast(drepKey) : "No DRep key"}
                    </div>
                    {drepKey && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => copyToClipboard(drepKey, `drep-${index}`, "DRep key")}
                        className="flex-shrink-0 h-8 w-8 p-0 sm:h-9 sm:w-9"
                      >
                        {copiedItems.has(`drep-${index}`) ? (
                          <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
                        ) : (
                          <Copy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        )}
                      </Button>
                    )}
                  </div>
                  {newDRepKey(index) && (
                    <p className="text-xs sm:text-sm text-green-600 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-green-500 rounded-full flex-shrink-0"></span>
                      <span className="break-words">Click Update to add your DRep key to the multisig wallet.</span>
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {drepInfo?.active && (
        <div className="mt-4 sm:mt-6 p-3 sm:p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-start gap-2 sm:gap-3">
            <div className="flex-shrink-0 w-4 h-4 sm:w-5 sm:h-5 text-yellow-600 mt-0.5">
              ⚠️
            </div>
            <div className="min-w-0">
              <p className="text-xs sm:text-sm font-medium text-yellow-800 mb-1">
                DRep is currently registered
              </p>
              <p className="text-xs sm:text-sm text-yellow-700 break-words">
                You must deregister the DRep before updating DRep keys. Go to the Governance section to deregister your DRep first.
              </p>
            </div>
          </div>
        </div>
      )}
      
      <div className="mt-4 sm:mt-6 flex flex-col sm:flex-row gap-2 sm:gap-3">
        <Button 
          onClick={update} 
          disabled={loading}
          className="flex-1 sm:flex-initial h-10 sm:h-9"
        >
          {loading ? "Updating Wallet..." : "Update"}
        </Button>
        <Button 
          onClick={() => setShowEdit(false)} 
          variant="destructive"
          className="flex-1 sm:flex-initial h-10 sm:h-9"
        >
          Cancel
        </Button>
      </div>
    </>
  );
}
