/**
 * useWalletFlowState Hook
 * Consolidates ALL shared state management for new-wallet-flow pages
 * Eliminates 300-400 lines of duplicate code from save/create pages
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/router";
import { resolvePaymentKeyHash, resolveStakeKeyHash, resolveRewardAddress } from "@meshsdk/core";
import type { MultisigKey } from "@/utils/multisigSDK";
import { MultisigWallet } from "@/utils/multisigSDK";

import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { useToast } from "@/hooks/use-toast";
import useUser from "@/hooks/useUser";

export interface WalletFlowState {
  // Core wallet data
  name: string;
  setName: React.Dispatch<React.SetStateAction<string>>;
  description: string;
  setDescription: React.Dispatch<React.SetStateAction<string>>;
  
  // Signers management
  signersAddresses: string[];
  setSignerAddresses: React.Dispatch<React.SetStateAction<string[]>>;
  signersDescriptions: string[];
  setSignerDescriptions: React.Dispatch<React.SetStateAction<string[]>>;
  signersStakeKeys: string[];
  setSignerStakeKeys: React.Dispatch<React.SetStateAction<string[]>>;
  signersDRepKeys: string[];
  setSignerDRepKeys: React.Dispatch<React.SetStateAction<string[]>>;
  addSigner: () => void;
  removeSigner: (index: number) => void;
  
  // Signature rules
  numRequiredSigners: number;
  setNumRequiredSigners: React.Dispatch<React.SetStateAction<number>>;
  nativeScriptType: "all" | "any" | "atLeast";
  setNativeScriptType: React.Dispatch<React.SetStateAction<"all" | "any" | "atLeast">>;
  
  // Advanced options
  stakeKey: string;
  setStakeKey: React.Dispatch<React.SetStateAction<string>>;
  removeExternalStakeAndBackfill: () => void;
  
  // UI state
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Computed values
  multisigWallet?: MultisigWallet;
  isValidForSave: boolean;
  isValidForCreate: boolean;
  
  // Router info
  router: ReturnType<typeof useRouter>;
  pathIsWalletInvite: boolean;
  walletInviteId?: string;
  
  // Dependencies
  user: ReturnType<typeof useUser>['user'];
  userAddress?: string;
  network: number;
  toast: ReturnType<typeof useToast>['toast'];
  
  // Data
  walletInvite: any;
  
  // Actions
  handleCreateNewWallet: () => Promise<void>;
  handleSaveWallet: () => Promise<void>;
  createNativeScript: () => void;
  
  // Mutations
  mutations: {
    deleteWalletInvite: any;
    createWallet: any;
    createNewWallet: any;
    updateNewWallet: any;
    saveToBackend: any;
  };
  
  // Save callbacks for create page
  handleSaveWalletInfo: (newName: string, newDescription: string) => void;
  handleSaveSigners: (newAddresses: string[], newDescriptions: string[], newStakeKeys: string[], newDRepKeys: string[]) => void;
  handleSaveSignatureRules: (numRequired: number) => void;
  handleSaveAdvanced: (newStakeKey: string, scriptType: "all" | "any" | "atLeast") => void;
}

export function useWalletFlowState(): WalletFlowState {
  const router = useRouter();
  const [signersAddresses, setSignerAddresses] = useState<string[]>([]);
  const [signersDescriptions, setSignerDescriptions] = useState<string[]>([]);
  const [signersStakeKeys, setSignerStakeKeys] = useState<string[]>([]);
  const [signersDRepKeys, setSignerDRepKeys] = useState<string[]>([]);
  const [numRequiredSigners, setNumRequiredSigners] = useState<number>(1);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [nativeScriptType, setNativeScriptType] = useState<"all" | "any" | "atLeast">("atLeast");
  const [stakeKey, setStakeKey] = useState<string>("");
  
  // Dependencies
  const userAddress = useUserStore((state) => state.userAddress);
  const { user } = useUser();
  const network = useSiteStore((state) => state.network);
  const { toast } = useToast();
  
  // Router logic
  const pathIsWalletInvite = router.pathname == "/wallets/new-wallet/[id]" || router.pathname == "/wallets/review/[id]" || router.pathname == "/wallets/new-wallet-flow/create/[id]";
  const walletInviteId = pathIsWalletInvite ? (router.query.id as string) : undefined;

  // MultisigWallet computation (identical from both pages)
  const multisigWallet = useMemo(() => {
    const keys: MultisigKey[] = [];
    if (signersAddresses.length === 0) return;

    if (signersAddresses.length > 0) {
      signersAddresses.forEach((addr, i) => {
        if (addr) {
          try {
            const paymentHash = resolvePaymentKeyHash(addr);
            keys.push({
              keyHash: paymentHash,
              role: 0,
              name: signersDescriptions[i] ?? "",
            });
          } catch {
            // Invalid payment address at index
          }
        }
      });
    }

    // Only add individual signer stake keys if no external stake credential
    if (!stakeKey && signersStakeKeys.length > 0) {
      signersStakeKeys.forEach((stakeKey, i) => {
        if (stakeKey) {
          try {
            const stakeKeyHash = resolveStakeKeyHash(stakeKey);
            keys.push({
              keyHash: stakeKeyHash,
              role: 2,
              name: signersDescriptions[i] ?? "",
            });
          } catch {
            // Invalid stake address at index
          }
        }
      });
    }

    // Add DRep keys
    if (signersDRepKeys.length > 0) {
      signersDRepKeys.forEach((drepKey, i) => {
        if (drepKey) {
          try {
            // DRep keys are already key hashes, so we can use them directly
            keys.push({
              keyHash: drepKey,
              role: 3,
              name: signersDescriptions[i] ?? "",
            });
          } catch {
            // Invalid DRep key at index
          }
        }
      });
    }
    
    if (keys.length === 0) return;
    return new MultisigWallet(
      name,
      keys,
      description,
      numRequiredSigners,
      network,
      stakeKey || undefined,
      nativeScriptType,
    );
  }, [
    name,
    description,
    signersAddresses,
    signersStakeKeys,
    signersDRepKeys,
    signersDescriptions,
    numRequiredSigners,
    network,
    stakeKey,
    nativeScriptType,
  ]);

  // API Mutations
  const { mutate: deleteWalletInvite } = api.wallet.deleteNewWallet.useMutation({
    onError: (e) => {
      // Handle error silently
    },
  });

  const { mutate: createWallet } = api.wallet.createWallet.useMutation({
    onSuccess: (data) => {
      if (pathIsWalletInvite) {
        deleteWalletInvite({ walletId: walletInviteId || (Array.isArray(router.query.id) ? router.query.id[0] : router.query.id)! });
      }
      setLoading(false);
      // Redirect to success page instead of wallets list
      void router.push(`/wallets/new-wallet-flow/ready/${data.id}`);
    },
    onError: (e) => {
      setLoading(false);
      // Handle error silently
    },
  });

  const { mutate: createNewWallet } = api.wallet.createNewWallet.useMutation({
    onSuccess: (data) => {
      setLoading(false);
      void router.push(`/wallets/new-wallet-flow/create/${data.id}`);
      void navigator.clipboard.writeText(
        `https://multisig.meshjs.dev/wallets/invite/${data.id}`,
      );
      toast({
        title: "Wallet Saved and invite link copied",
        description:
          "Your wallet has been saved and invite link copied in clipboard",
        duration: 5000,
      });
    },
    onError: (e) => {
      setLoading(false);
      // Handle error silently
    },
  });

  const { mutate: updateNewWallet } = api.wallet.updateNewWallet.useMutation({
    onSuccess: () => {
      setLoading(false);
      toast({
        title: "Wallet Info Updated",
        description: "Your wallet has been saved",
        duration: 5000,
      });
      void router.push("/wallets");
    },
    onError: (e) => {
      setLoading(false);
      // Handle error silently
    },
  });
  
  // Mutation for saving from cards without redirect
  const { mutate: saveToBackend } = api.wallet.updateNewWallet.useMutation({
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Changes saved successfully",
        duration: 2000,
      });
    },
    onError: (e) => {
      // Handle error with toast
      toast({
        title: "Error",
        description: "Failed to save changes",
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  // Data query
  const { data: walletInvite } = api.wallet.getNewWallet.useQuery(
    { walletId: (walletInviteId || router.query.id) as string },
    {
      enabled: Boolean(walletInviteId || router.query.id),
    },
  );

  // Initialize first signer with current user (only when not loading from wallet invite)
  useEffect(() => {
    if (!user) return;
    
    // For new wallets, initialize everything
    if (!pathIsWalletInvite) {
      setSignerAddresses([user.address]);
      setSignerDescriptions([""]);
      // Only import stake key if no external stake credential is set
      setSignerStakeKeys([stakeKey ? "" : user.stakeAddress]);
      // Import DRep key from user data
      setSignerDRepKeys([(user as any).drepKeyHash || ""]);
    }
  }, [user, stakeKey, pathIsWalletInvite]);

  // Separate effect for populating DRep keys in wallet invites
  const drepKeyPopulatedRef = useRef(false);
  useEffect(() => {
    console.log("DRep key population effect:", {
      hasUser: !!user,
      isWalletInvite: pathIsWalletInvite,
      alreadyPopulated: drepKeyPopulatedRef.current,
      userDrepKey: (user as any)?.drepKeyHash,
      signersDRepKeysLength: signersDRepKeys.length,
      firstDRepKey: signersDRepKeys[0],
      hasWalletInvite: !!walletInvite
    });
    
    if (!user || !pathIsWalletInvite || !walletInvite || drepKeyPopulatedRef.current) return;
    
    // For wallet invites, only populate DRep key if it's empty and user has one
    const userDrepKey = (user as any).drepKeyHash;
    if (userDrepKey && signersDRepKeys.length > 0 && (!signersDRepKeys[0] || signersDRepKeys[0] === "")) {
      console.log("Populating DRep key:", userDrepKey);
      const updatedDRepKeys = [...signersDRepKeys];
      updatedDRepKeys[0] = userDrepKey;
      setSignerDRepKeys(updatedDRepKeys);
      drepKeyPopulatedRef.current = true;
    }
  }, [user, pathIsWalletInvite, walletInvite, signersDRepKeys.length]);

  // Adjust numRequiredSigners if it exceeds the number of signers
  useEffect(() => {
    if (numRequiredSigners > signersAddresses.length && signersAddresses.length > 0) {
      setNumRequiredSigners(signersAddresses.length);
    }
  }, [signersAddresses.length, numRequiredSigners]);

  // Load wallet invite data
  useEffect(() => {
    if (pathIsWalletInvite && walletInvite) {
      console.log("Loading wallet invite data:", walletInvite);
      setName(walletInvite.name);
      setDescription(walletInvite.description ?? "");
      setSignerAddresses(walletInvite.signersAddresses);
      setSignerDescriptions(walletInvite.signersDescriptions);
      setSignerStakeKeys(walletInvite.signersStakeKeys);
      setSignerDRepKeys((walletInvite as any).signersDRepKeys ?? []);
      setNumRequiredSigners(walletInvite.numRequiredSigners!);
      setStakeKey((walletInvite as any).stakeCredentialHash ?? "");
      setNativeScriptType((walletInvite as any).scriptType ?? "atLeast");
    }
  }, [pathIsWalletInvite, walletInvite]);

  // Utility functions
  function addSigner() {
    setSignerAddresses([...signersAddresses, ""]);
    setSignerDescriptions([...signersDescriptions, ""]);
    // Always add empty stake key when external stake credential is set, otherwise add empty string
    setSignerStakeKeys([...signersStakeKeys, stakeKey ? "" : ""]);
    setSignerDRepKeys([...signersDRepKeys, ""]);
  }

  function removeSigner(index: number) {
    const updatedAddresses = [...signersAddresses];
    updatedAddresses.splice(index, 1);
    setSignerAddresses(updatedAddresses);

    const updatedDescriptions = [...signersDescriptions];
    updatedDescriptions.splice(index, 1);
    setSignerDescriptions(updatedDescriptions);

    const updatedStakeKeys = [...signersStakeKeys];
    updatedStakeKeys.splice(index, 1);
    setSignerStakeKeys(updatedStakeKeys);

    const updatedDRepKeys = [...signersDRepKeys];
    updatedDRepKeys.splice(index, 1);
    setSignerDRepKeys(updatedDRepKeys);
  }

  function createNativeScript() {
    setLoading(true);

    if (!multisigWallet) {
      setLoading(false);
      throw new Error("Multisig wallet could not be built.");
    }

    const { scriptCbor } = multisigWallet.getScript();
    if (!scriptCbor) {
      setLoading(false);
      throw new Error("scriptCbor is undefined");
    }

    createWallet({
      name: name,
      description: description,
      signersAddresses: signersAddresses,
      signersDescriptions: signersDescriptions,
      signersStakeKeys: signersStakeKeys,
      signersDRepKeys: signersDRepKeys,
      numRequiredSigners: numRequiredSigners,
      scriptCbor: scriptCbor,
      stakeCredentialHash: stakeKey.length > 0 ? stakeKey : undefined,
      type: nativeScriptType,
    });
  }

  async function handleCreateNewWallet() {
    if (router.pathname == "/wallets/new-wallet-flow/save") {
      setLoading(true);
      createNewWallet({
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        signersDRepKeys: signersDRepKeys,
        ownerAddress: userAddress!,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType,
      });
    }
  }

  async function handleSaveWallet() {
    if (pathIsWalletInvite) {
      setLoading(true);
      updateNewWallet({
        walletId: walletInviteId || (Array.isArray(router.query.id) ? router.query.id[0] : router.query.id)!,
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        signersDRepKeys: signersDRepKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType,
      });
    }
  }

  // Save callbacks for create page
  const handleSaveWalletInfo = useCallback((newName: string, newDescription: string) => {
    if (walletInviteId || router.query.id) {
      saveToBackend({
        walletId: (walletInviteId || router.query.id) as string,
        name: newName,
        description: newDescription,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        signersDRepKeys: signersDRepKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType,
      });
    }
  }, [walletInviteId, router.query.id, signersAddresses, 
      signersDescriptions, signersStakeKeys, signersDRepKeys, numRequiredSigners, saveToBackend, stakeKey, nativeScriptType]);

  const handleSaveSigners = useCallback((newAddresses: string[], newDescriptions: string[], newStakeKeys: string[], newDRepKeys: string[]) => {
    if (walletInviteId || router.query.id) {
      saveToBackend({
        walletId: (walletInviteId || router.query.id) as string,
        name: name,
        description: description,
        signersAddresses: newAddresses,
        signersDescriptions: newDescriptions,
        signersStakeKeys: newStakeKeys,
        signersDRepKeys: newDRepKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType,
      });
    }
  }, [walletInviteId, router.query.id, name, description, numRequiredSigners, saveToBackend, stakeKey, nativeScriptType]);

  const handleSaveSignatureRules = useCallback((numRequired: number) => {
    // Save signature rules
    if (walletInviteId || router.query.id) {
      saveToBackend({
        walletId: (walletInviteId || router.query.id) as string,
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        signersDRepKeys: signersDRepKeys,
        numRequiredSigners: numRequired,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType,
      });
    }
  }, [walletInviteId, router.query.id, name, description, signersAddresses, 
      signersDescriptions, signersStakeKeys, signersDRepKeys, saveToBackend, stakeKey, nativeScriptType]);

  const handleSaveAdvanced = useCallback((newStakeKey: string, scriptType: "all" | "any" | "atLeast") => {
    // Update local state
    setStakeKey(newStakeKey);
    setNativeScriptType(scriptType);
    
    // If external stake credential is set, clear all signer stake keys
    const updatedSignerStakeKeys = newStakeKey ? 
      signersStakeKeys.map(() => "") : 
      signersStakeKeys;
    
    // Update signer stake keys if external credential is set
    if (newStakeKey) {
      setSignerStakeKeys(updatedSignerStakeKeys);
    }
    
    if (walletInviteId || router.query.id) {
      saveToBackend({
        walletId: (walletInviteId || router.query.id) as string,
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: updatedSignerStakeKeys,
        signersDRepKeys: signersDRepKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: newStakeKey || undefined,
        scriptType: scriptType,
      });
    }
  }, [walletInviteId, router.query.id, name, description, signersAddresses, 
      signersDescriptions, signersStakeKeys, signersDRepKeys, numRequiredSigners, saveToBackend, 
      setStakeKey, setNativeScriptType, setSignerStakeKeys]);

  // Remove external stake credential and try to backfill stake keys from addresses
  const removeExternalStakeAndBackfill = useCallback(() => {
    // Clear external stake credential
    setStakeKey("");

    // Attempt to resolve stake keys from existing addresses
    const backfilledStakeKeys = signersAddresses.map((addr, idx) => {
      try {
        // Try to derive stake reward address from payment address
        const rewardAddress = resolveRewardAddress(addr);
        return rewardAddress || signersStakeKeys[idx] || "";
      } catch {
        return signersStakeKeys[idx] || "";
      }
    });

    setSignerStakeKeys(backfilledStakeKeys);

    // Persist to backend if in an existing flow
    if (walletInviteId || router.query.id) {
      saveToBackend({
        walletId: (walletInviteId || router.query.id) as string,
        name,
        description,
        signersAddresses,
        signersDescriptions,
        signersStakeKeys: backfilledStakeKeys,
        signersDRepKeys,
        numRequiredSigners,
        stakeCredentialHash: null,
        scriptType: nativeScriptType,
      });
    }

    toast({
      title: "External stake removed",
      description: "Stake keys were backfilled from addresses where possible.",
      duration: 3000,
    });
  }, [signersAddresses, signersStakeKeys, signersDRepKeys, walletInviteId, router.query.id, name, description, signersDescriptions, numRequiredSigners, nativeScriptType, saveToBackend, toast]);

  // Validation
  const isValidForSave = !loading && !!name.trim();
  const isValidForCreate = signersAddresses.length > 0 &&
    !signersAddresses.some((signer) => !signer || signer.length === 0) &&
    (nativeScriptType !== "atLeast" || numRequiredSigners > 0) &&
    name.length > 0 &&
    !loading;

  return {
    // Core wallet data
    name,
    setName,
    description,
    setDescription,
    
    // Signers management
    signersAddresses,
    setSignerAddresses,
    signersDescriptions,
    setSignerDescriptions,
    signersStakeKeys,
    setSignerStakeKeys,
    signersDRepKeys,
    setSignerDRepKeys,
    addSigner,
    removeSigner,
    
    // Signature rules
    numRequiredSigners,
    setNumRequiredSigners,
    nativeScriptType,
    setNativeScriptType,
    
    // Advanced options
    stakeKey,
    setStakeKey,
    removeExternalStakeAndBackfill,
    
    // UI state
    loading,
    setLoading,
    
    // Computed values
    multisigWallet,
    isValidForSave,
    isValidForCreate,
    
    // Router info
    router,
    pathIsWalletInvite,
    walletInviteId,
    
    // Dependencies
    user,
    userAddress,
    network,
    toast,
    
    // Data
    walletInvite,
    
    // Actions
    handleCreateNewWallet,
    handleSaveWallet,
    createNativeScript,
    
    // Mutations
    mutations: {
      deleteWalletInvite,
      createWallet,
      createNewWallet,
      updateNewWallet,
      saveToBackend,
    },
    
    // Save callbacks
    handleSaveWalletInfo,
    handleSaveSigners,
    handleSaveSignatureRules,
    handleSaveAdvanced,
  };
}