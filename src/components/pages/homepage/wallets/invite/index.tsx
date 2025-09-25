import { useState, useEffect } from "react";
import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useRouter } from "next/router";
import { useToast } from "@/hooks/use-toast";
import useUser from "@/hooks/useUser";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import GlassMorphismPageWrapper from "@/components/pages/homepage/wallets/new-wallet-flow/shared/GlassMorphismPageWrapper";
import WalletInfoCard from "./WalletInfoCard";
import JoinAsSignerCard from "./JoinAsSignerCard";
import ManageSignerCard from "./ManageSignerCard";
import { serializeRewardAddress, deserializeAddress } from "@meshsdk/core";

export default function PageNewWalletInvite() {
  const router = useRouter();
  const [loading, setLoading] = useState<boolean>(false);
  const [signersDescription, setSignerDescription] = useState<string>("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [localSignerName, setLocalSignerName] = useState<string>("");
  const [showNotFound, setShowNotFound] = useState(false);
  const userAddress = useUserStore((state) => state.userAddress);
  const { user } = useUser();
  const { toast } = useToast();

  const pathIsNewWallet = router.pathname == "/wallets/invite/[id]";
  const newWalletId = pathIsNewWallet ? (router.query.id as string) : undefined;

  const utils = api.useUtils();

  const { data: newWallet } = api.wallet.getNewWallet.useQuery(
    { walletId: newWalletId! },
    {
      enabled: pathIsNewWallet && newWalletId !== undefined,
    },
  );

  useEffect(() => {
    if (!newWallet) {
      setShowNotFound(false);
      const timer = setTimeout(() => {
        setShowNotFound(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [newWallet]);

  // Calculate user role once (after newWallet is loaded)
  const isOwner = newWallet?.ownerAddress === userAddress;
  const isAlreadySigner =
    newWallet?.signersAddresses.includes(userAddress || "") || false;

  // Set initial signer name when wallet data loads
  useEffect(() => {
    if (newWallet && userAddress) {
      const signerIndex = newWallet.signersAddresses.findIndex(
        (addr) => addr === userAddress,
      );
      if (signerIndex !== -1) {
        setLocalSignerName(newWallet.signersDescriptions[signerIndex] || "");
      }
    }
  }, [newWallet, userAddress]);

  const { mutate: updateNewWalletSigners } =
    api.wallet.updateNewWalletSigners.useMutation({
      onSuccess: async () => {
        setLoading(false);
        // Clear the name input after successful addition
        setSignerDescription("");
        toast({
          title: "Success",
          description: "You have been added as a signer",
          duration: 5000,
        });
        // No reload - just refetch the wallet data
        void utils.wallet.getNewWallet.invalidate({ walletId: newWalletId! });
      },
      onError: (error) => {
        setLoading(false);
        toast({
          title: "Page No Longer Available",
          variant: "destructive",
          duration: 5000,
        });
      },
    });

  const updateNewWalletSignersDescriptionsMutation =
    api.wallet.updateNewWalletSignersDescriptions.useMutation({
      onSuccess: async (data, variables) => {
        // Update local state with new name
        const userIndex = newWallet?.signersAddresses.findIndex(
          (item) => item === userAddress,
        );
        if (userIndex !== -1 && userIndex !== undefined) {
          setLocalSignerName(variables.signersDescriptions[userIndex] || "");
        }

        toast({
          title: "Name Updated",
          description: "Your name has been updated",
          duration: 3000,
        });
      },
      onError: (error) => {
        toast({
          title: "Update Failed",
          description: "Failed to update name",
          variant: "destructive",
          duration: 5000,
        });
      },
    });
  const updateNewWalletSignersDescriptions =
    updateNewWalletSignersDescriptionsMutation.mutate;
  const isUpdatingName =
    updateNewWalletSignersDescriptionsMutation.status === "pending";

  async function addSigner() {
    if (newWallet === undefined || newWallet === null)
      throw new Error("Wallet invite is undefined");
    if (userAddress === undefined) throw new Error("User address is undefined");
    const dsAddr = deserializeAddress(userAddress);
    console.log("User stake address:", dsAddr);
    if (!user?.stakeAddress) throw new Error("User stake address is undefined");

    setLoading(true);

    // Only import stake key if no external stake credential is set
    const stakeKeyToAdd = newWallet.stakeCredentialHash ? "" : user.stakeAddress;

    updateNewWalletSigners({
      walletId: newWalletId!,
      signersAddresses: [...newWallet.signersAddresses, userAddress],
      signersStakeKeys: [...newWallet.signersStakeKeys, stakeKeyToAdd],
      signersDescriptions: [
        ...newWallet.signersDescriptions,
        signersDescription,
      ],
    });
  }

  async function handleNameChange(newName: string) {
    if (newWallet === undefined || newWallet === null)
      throw new Error("Wallet invite is undefined");
    if (userAddress === undefined) throw new Error("User address is undefined");

    const userIndex = newWallet.signersAddresses.findIndex(
      (item) => item === userAddress,
    );
    if (userIndex === -1) throw new Error("User index is not found");

    const updatedDescriptions = [...newWallet.signersDescriptions];
    updatedDescriptions[userIndex] = newName;

    updateNewWalletSignersDescriptions({
      walletId: newWalletId!,
      signersDescriptions: updatedDescriptions,
    });
  }

  async function handleRemoveClick() {
    setDeleteDialogOpen(true);
  }

  async function confirmRemove() {
    if (newWallet === undefined || newWallet === null)
      throw new Error("Wallet invite is undefined");
    if (userAddress === undefined) throw new Error("User address is undefined");

    const userIndex = newWallet.signersAddresses.findIndex(
      (item) => item === userAddress,
    );
    if (userIndex === -1) throw new Error("User index is not found");

    setLoading(true);
    setDeleteDialogOpen(false);

    // Clear local name when removing - user is completely out
    setLocalSignerName("");

    const updatedAddresses = newWallet.signersAddresses.filter(
      (_, i) => i !== userIndex,
    );
    const updatedStakeKeys = newWallet.signersStakeKeys.filter(
      (_, i) => i !== userIndex,
    );
    const updatedDescriptions = newWallet.signersDescriptions.filter(
      (_, i) => i !== userIndex,
    );

    updateNewWalletSigners({
      walletId: newWalletId!,
      signersAddresses: updatedAddresses,
      signersStakeKeys: updatedStakeKeys,
      signersDescriptions: updatedDescriptions,
    });
  }
  function getStakeAddress(addr: string | undefined): string {
    if (!addr) return "";
    try {
      // Deserialize the address to get the stake credential hash
      const stakeHash = deserializeAddress(addr).stakeCredentialHash;
      // Determine network based on address type
      const network = addr.includes("test") ? 0 : 1;
      // Serialize the stake address
      const stakeAddress = serializeRewardAddress(stakeHash, false, network);
      return stakeAddress || "";
    } catch (e) {
      return "";
    }
  }

  return (
    <GlassMorphismPageWrapper>
      <div className="min-h-screen w-full overflow-x-hidden px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto w-full max-w-4xl">
          {/* Main Title */}
          <div className="mb-4 sm:mb-6">
            <h1 className="text-xl font-bold text-foreground sm:text-2xl">
              {newWallet
                ? isOwner || isAlreadySigner
                  ? "New Wallet"
                  : "Join New Wallet"
                : ""}
            </h1>
          </div>

          {/* Content Wrapper */}
          <div className="space-y-4 sm:space-y-6">
            {!newWallet && !showNotFound && (
              <div className="flex h-32 items-center justify-center">
                <div className="loader">Loading...</div>
              </div>
            )}
            {!newWallet && showNotFound && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle>Page Not Found</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="mb-4 text-muted-foreground">
                      This page is no longer available.
                    </p>
                  </CardContent>
                </Card>
                <div className="mt-6 flex sm:mt-8 sm:justify-end">
                  <Button
                    onClick={() => router.push("/wallets")}
                    className="w-full sm:w-auto"
                    size="lg"
                  >
                    Go to Wallets
                  </Button>
                </div>
              </>
            )}
            {newWallet && (
              <div className="space-y-4 sm:space-y-6">
                <WalletInfoCard
                  walletName={newWallet.name}
                  walletDescription={newWallet.description || undefined}
                  currentSignersCount={newWallet.signersAddresses.length}
                  requiredSignatures={newWallet.numRequiredSigners || 2}
                  stakeCredentialHash={(newWallet as any).stakeCredentialHash}
                  scriptType={(newWallet as any).scriptType}
                />

                {/* Owner or Already Signer - Show ManageSignerCard */}
                {(isOwner || isAlreadySigner) && (
                  <ManageSignerCard
                    userAddress={userAddress || ""}
                    stakeAddress={user?.stakeAddress ?? ""}
                    signerName={localSignerName}
                    onNameChange={handleNameChange}
                    loading={isUpdatingName}
                    walletId={newWalletId}
                    isCreator={isOwner}
                    hasExternalStakeCredential={!!(newWallet as any).stakeCredentialHash}
                  />
                )}

                {/* Only Signers (not owner) get Remove button */}
                {isAlreadySigner && !isOwner && (
                  <div className="mt-6 flex justify-end sm:mt-8">
                    <Button
                      onClick={handleRemoveClick}
                      disabled={loading}
                      variant="destructive"
                      className="w-full sm:w-auto"
                      size="lg"
                    >
                      {loading ? "Removing..." : "Remove me from wallet"}
                    </Button>
                  </div>
                )}

                {/* Not a signer yet - Show Join card */}
                {!isOwner && !isAlreadySigner && (
                  <>
                    <JoinAsSignerCard
                      userAddress={userAddress || ""}
                      stakeAddress={getStakeAddress(userAddress) ?? ""}
                      signerName={signersDescription}
                      setSignerName={setSignerDescription}
                      onJoin={addSigner}
                      loading={loading}
                      hasExternalStakeCredential={!!(newWallet as any).stakeCredentialHash}
                    />

                    <div className="mt-6 flex justify-end sm:mt-8">
                      <Button
                        onClick={addSigner}
                        disabled={loading}
                        className="w-full sm:w-auto"
                        size="lg"
                      >
                        {loading ? "Adding..." : "Add me as signer"}
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Remove Confirmation Dialog - same style as Create page */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="border-gray-200 bg-gray-50 shadow-xl dark:border-neutral-700 dark:bg-neutral-800 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove from Wallet</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove yourself from this wallet?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmRemove}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GlassMorphismPageWrapper>
  );
}
