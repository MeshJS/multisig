import { useState, useEffect, useRef, useMemo } from "react";
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
import { paymentKeyHash, stakeKeyHash } from "@/utils/multisigSDK";
import { getProvider } from "@/utils/get-provider";
import { useSiteStore } from "@/lib/zustand/site";

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

  const network = useSiteStore((state) => state.network);
  const blockchainProvider = useMemo(() => getProvider(network), [network]);

  const pathIsNewWallet = router.pathname == "/wallets/invite/[id]";
  const newWalletId = pathIsNewWallet ? (router.query.id as string) : undefined;

  const utils = api.useUtils();

  const { data: newWallet } = api.wallet.getNewWallet.useQuery(
    { walletId: newWalletId! },
    {
      enabled: pathIsNewWallet && newWalletId !== undefined,
    },
  );

  const ownerUpdateTriggered = useRef(false);

  const { mutate: updateNewWalletOwner } = api.wallet.updateNewWalletOwner.useMutation({
    onSuccess: async () => {
      void utils.wallet.getNewWallet.invalidate({ walletId: newWalletId! });
    },
  });

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

  // Prevent repeated normalization updates
  const normalizationTriggered = useRef(false);

  useEffect(() => {
    if (!newWallet) {
      setShowNotFound(false);
      const timer = setTimeout(() => {
        setShowNotFound(true);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [newWallet]);

  // Helper to detect native script key hash entries (28-byte hex)
  const isNativeKeyHash = (value: string | undefined): boolean =>
    !!value && /^[0-9a-fA-F]{56}$/.test(value);

  // Compare script CBORs if present
  const hasBothCbors = !!((newWallet as any)?.paymentCbor && (newWallet as any)?.stakeCbor);
  const paymentEqualsStake = !!(
    hasBothCbors && (newWallet as any)?.paymentCbor === (newWallet as any)?.stakeCbor
  );
  const paymentNotEqualsStake = !!(
    hasBothCbors && (newWallet as any)?.paymentCbor !== (newWallet as any)?.stakeCbor
  );

  const userPaymentHash = userAddress ? paymentKeyHash(userAddress) : "";
  const userStakeHash = user?.stakeAddress ? stakeKeyHash(user.stakeAddress) : "";

  // Fallback payment key hashes derived from user's stake address payment addresses
  const [stakePaymentHashes, setStakePaymentHashes] = useState<string[]>([]);
  const stakeFetchTriggered = useRef(false);

  // If user's own payment hash does not match any signer key-hash entries,
  // fetch first few payment addresses for the user's stake address and compare their hashes
  useEffect(() => {
    if (!user?.stakeAddress) return;
    if (!newWallet) return;
    if (!newWallet.signersAddresses?.some(isNativeKeyHash)) return;
    const userHashMatches = !!(
      userPaymentHash &&
      newWallet.signersAddresses.some(
        (addr) => isNativeKeyHash(addr) && addr.toLowerCase() === userPaymentHash.toLowerCase(),
      )
    );
    if (userHashMatches) return;
    if (stakeFetchTriggered.current) return;

    stakeFetchTriggered.current = true;
    const stakeAddr = user.stakeAddress;
    blockchainProvider
      .get(`/accounts/${stakeAddr}/addresses`)
      .then((data: any) => {
        const addresses: string[] = Array.isArray(data)
          ? data
              .map((d: any) => (typeof d === "string" ? d : d?.address))
              .filter((a: any) => typeof a === "string")
          : [];
        const firstFew = addresses.slice(0, 30);
        const hashes = firstFew
          .map((addr) => {
            try {
              return paymentKeyHash(addr);
            } catch (e) {
              return "";
            }
          })
          .filter((h) => !!h);
        setStakePaymentHashes(hashes);
      })
      .catch((err: any) => {
        console.error("[invite] failed fetching addresses by stake address", err);
      });
  }, [user?.stakeAddress, newWallet, userPaymentHash, blockchainProvider]);

  // Combined check: does any of the user's payment hashes (own or derived) match signer key-hash entries?
  const paymentHashMatchedInSigners = useMemo(() => {
    if (!newWallet) return false;
    const candidateHashes = [
      ...(userPaymentHash ? [userPaymentHash] : []),
      ...stakePaymentHashes,
    ].map((h) => h.toLowerCase());
    if (candidateHashes.length === 0) return false;
    return newWallet.signersAddresses?.some(
      (addr) => isNativeKeyHash(addr) && candidateHashes.includes(addr.toLowerCase()),
    );
  }, [newWallet, userPaymentHash, stakePaymentHashes]);

  // Calculate user role once (after newWallet is loaded)
  const isOwner = !!newWallet && (
    newWallet.ownerAddress === userAddress ||
    (newWallet.ownerAddress === "all" && (
      (user?.stakeAddress ? newWallet.signersStakeKeys?.includes(user.stakeAddress) : false) ||
      (userAddress ? newWallet.signersAddresses?.includes(userAddress) : false)
    ))
  );

  // If owner is set to "all" and the connected user qualifies, claim ownership
  useEffect(() => {
    if (!newWallet || !userAddress) return;
    if (ownerUpdateTriggered.current) return;

  const qualifiesByKeyHash = (() => {
      // Equal CBORs: only compare payment key hash against signersAddresses
      if (paymentEqualsStake) {
        if (!newWallet.signersAddresses?.some(isNativeKeyHash)) return false;
        return paymentHashMatchedInSigners;
      }
      // Not equal CBORs: require BOTH payment hash in signersAddresses AND stake hash in signersStakeKeys
      if (paymentNotEqualsStake) {
        const paymentMatch = paymentHashMatchedInSigners;
        const stakeMatch = !!(
          userStakeHash &&
          newWallet.signersStakeKeys?.some(
            (sk) => isNativeKeyHash(sk) && sk.toLowerCase() === userStakeHash.toLowerCase(),
          )
        );
        return paymentMatch && stakeMatch;
      }
      return false;
    })();

    const qualifies =
      newWallet.ownerAddress === "all" && (
        (user?.stakeAddress ? newWallet.signersStakeKeys?.includes(user.stakeAddress) : false) ||
        newWallet.signersAddresses?.includes(userAddress) ||
        qualifiesByKeyHash
      );

    if (qualifies) {
      ownerUpdateTriggered.current = true;
      updateNewWalletOwner({ walletId: newWallet.id, ownerAddress: userAddress });
    }
  }, [newWallet, userAddress, user, updateNewWalletOwner, paymentHashMatchedInSigners]);
  
  const isAlreadySigner = (() => {
    if (!newWallet) return false;
    if (userAddress && newWallet.signersAddresses.includes(userAddress)) return true;
    // If equal CBORs: allow payment key hash match in signersAddresses
    if (paymentEqualsStake) {
      if (!newWallet.signersAddresses.some(isNativeKeyHash)) return false;
      return paymentHashMatchedInSigners;
    }
    // If not equal CBORs: require BOTH payment key hash in signersAddresses AND stake key match (direct or hash)
    if (paymentNotEqualsStake) {
      const paymentMatch = paymentHashMatchedInSigners;
      const stakeDirectMatch = !!(
        user?.stakeAddress && newWallet.signersStakeKeys?.includes(user.stakeAddress)
      );
      const stakeHashMatch = !!(
        userStakeHash &&
        newWallet.signersStakeKeys?.some(
          (sk) => isNativeKeyHash(sk) && sk.toLowerCase() === userStakeHash.toLowerCase(),
        )
      );
      const stakeMatched = stakeDirectMatch || stakeHashMatch;
      return paymentMatch && stakeMatched;
    }
    return false;
  })();

  // Normalize any key-hash placeholders to actual addresses when we can identify the user
  useEffect(() => {
    if (!newWallet) return;
    if (normalizationTriggered.current) return;
    if (!userAddress && !user?.stakeAddress) return;

    let nextSignersAddresses = [...newWallet.signersAddresses];
    let nextSignersStakeKeys = [...newWallet.signersStakeKeys];
    let didChangeAddresses = false;
    let didChangeStake = false;

    // If CBORs differ, wait until both payment and stake data are present so we can update both sides together
    if (paymentNotEqualsStake) {
      if (!userAddress || !user?.stakeAddress || !userPaymentHash || !userStakeHash) {
        return;
      }
    }

    // Replace payment keyHash in signersAddresses with userAddress
    if (userAddress && userPaymentHash && newWallet.signersAddresses?.some(isNativeKeyHash)) {
      const replaced = nextSignersAddresses.map((addr) =>
        isNativeKeyHash(addr) && addr.toLowerCase() === userPaymentHash.toLowerCase()
          ? userAddress
          : addr,
      );
      if (replaced.some((v, i) => v !== nextSignersAddresses[i])) {
        nextSignersAddresses = replaced;
        didChangeAddresses = true;
      }
    }

    // Replace stake keyHash in signersStakeKeys with user's stake address
    if (user?.stakeAddress && userStakeHash && newWallet.signersStakeKeys?.some(isNativeKeyHash)) {
      const replacedStake = nextSignersStakeKeys.map((sk) =>
        isNativeKeyHash(sk) && sk.toLowerCase() === userStakeHash.toLowerCase()
          ? user.stakeAddress as string
          : sk,
      );
      if (replacedStake.some((v, i) => v !== nextSignersStakeKeys[i])) {
        nextSignersStakeKeys = replacedStake;
        didChangeStake = true;
      }
    }

    // If CBORs are equal: allow updating addresses-only.
    // If CBORs differ: require both sides to change in the same mutation to keep indices aligned.
    if (paymentEqualsStake) {
      if (!didChangeAddresses && !didChangeStake) return;
    } else if (paymentNotEqualsStake) {
      if (!(didChangeAddresses && didChangeStake)) return;
    } else {
      if (!didChangeAddresses && !didChangeStake) return;
    }

    normalizationTriggered.current = true;
    updateNewWalletSigners(
      {
        walletId: newWalletId!,
        signersAddresses: nextSignersAddresses,
        signersStakeKeys: nextSignersStakeKeys,
        signersDRepKeys: newWallet.signersDRepKeys || [],
        signersDescriptions: newWallet.signersDescriptions,
      },
      {
        onSuccess: async () => {
          // silent refresh
          void utils.wallet.getNewWallet.invalidate({ walletId: newWalletId! });
        },
        onError: () => {
          // allow retry on next render if it fails
          normalizationTriggered.current = false;
        },
      },
    );
  }, [newWallet, userAddress, user?.stakeAddress, userPaymentHash, userStakeHash, updateNewWalletSigners, utils, newWalletId]);

  // Set initial signer name when wallet data loads
  useEffect(() => {
    if (newWallet && userAddress) {
      let signerIndex = newWallet.signersAddresses.findIndex(
        (addr) => addr === userAddress,
      );
      // Equal CBORs: fallback to payment hash in signersAddresses
      if (signerIndex === -1 && paymentEqualsStake && userPaymentHash) {
        signerIndex = newWallet.signersAddresses.findIndex(
          (addr) => isNativeKeyHash(addr) && addr.toLowerCase() === userPaymentHash.toLowerCase(),
        );
      }
      // Not equal CBORs: only set name when BOTH indices match and align
      if (signerIndex === -1 && paymentNotEqualsStake) {
        const addrIdx = userPaymentHash
          ? newWallet.signersAddresses.findIndex(
              (addr) => isNativeKeyHash(addr) && addr.toLowerCase() === userPaymentHash.toLowerCase(),
            )
          : -1;
        const stakeIdx = userStakeHash
          ? newWallet.signersStakeKeys.findIndex(
              (sk) => isNativeKeyHash(sk) && sk.toLowerCase() === userStakeHash.toLowerCase(),
            )
          : -1;
        if (addrIdx !== -1 && stakeIdx !== -1 && addrIdx === stakeIdx) {
          signerIndex = addrIdx;
        }
      }
      if (signerIndex !== -1) {
        setLocalSignerName(newWallet.signersDescriptions[signerIndex] || "");
      }
    }
  }, [newWallet, userAddress, paymentEqualsStake, paymentNotEqualsStake, userPaymentHash, userStakeHash]);

  

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
    
    // Add DRep key if available
    const drepKeyToAdd = user?.drepKeyHash || "";

    updateNewWalletSigners({
      walletId: newWalletId!,
      signersAddresses: [...newWallet.signersAddresses, userAddress],
      signersStakeKeys: [...newWallet.signersStakeKeys, stakeKeyToAdd],
      signersDRepKeys: [...(newWallet.signersDRepKeys || []), drepKeyToAdd],
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
    const updatedDRepKeys = (newWallet.signersDRepKeys || []).filter(
      (_, i) => i !== userIndex,
    );
    const updatedDescriptions = newWallet.signersDescriptions.filter(
      (_, i) => i !== userIndex,
    );

    updateNewWalletSigners({
      walletId: newWalletId!,
      signersAddresses: updatedAddresses,
      signersStakeKeys: updatedStakeKeys,
      signersDRepKeys: updatedDRepKeys,
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
                    drepKeyHash={user?.drepKeyHash ?? ""}
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
                      drepKeyHash={user?.drepKeyHash ?? ""}
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
