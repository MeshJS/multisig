/**
 * useWalletFlowState Hook
 * Consolidates ALL shared state management for new-wallet-flow pages
 * Eliminates 300-400 lines of duplicate code from save/create pages
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { useRouter } from "next/router";
import { resolvePaymentKeyHash, resolveStakeKeyHash } from "@meshsdk/core";
import type { MultisigKey } from "@/utils/multisigSDK";
import { MultisigWallet, stakeKeyHash } from "@/utils/multisigSDK";

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
  handleSaveSigners: (newAddresses: string[], newDescriptions: string[], newStakeKeys: string[]) => void;
  handleSaveSignatureRules: (numRequired: number) => void;
  handleSaveAdvanced: (newStakeKey: string, scriptType: "all" | "any" | "atLeast") => void;
}

export function useWalletFlowState(): WalletFlowState {
  const router = useRouter();
  const [signersAddresses, setSignerAddresses] = useState<string[]>([]);
  const [signersDescriptions, setSignerDescriptions] = useState<string[]>([]);
  const [signersStakeKeys, setSignerStakeKeys] = useState<string[]>([]);
  const [numRequiredSigners, setNumRequiredSigners] = useState<number>(1);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [nativeScriptType, setNativeScriptType] = useState<"all" | "any" | "atLeast">("atLeast");
  const [stakeKey, setStakeKey] = useState<string>("");
  
  // Effect to clear signer stake keys when global stake key is set
  useEffect(() => {
    if (stakeKey && stakeKey.trim() !== "") {
      // Clear all signer stake keys when global stake key is set
      setSignerStakeKeys(new Array(signersAddresses.length).fill(""));
    }
  }, [stakeKey, signersAddresses.length]);
  
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

    if (signersStakeKeys.length > 0) {
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
    if (keys.length === 0) return;
    // Convert stake key to hash if it's an address
    let stakeCredentialHash: string | undefined = undefined;
    if (stakeKey && stakeKey.trim() !== "") {
      try {
        // Check if it's already a hash (56 characters) or an address (64+ characters)
        if (stakeKey.length === 56) {
          stakeCredentialHash = stakeKey;
        } else {
          // It's likely a stake address, convert to hash
          stakeCredentialHash = stakeKeyHash(stakeKey);
        }
      } catch (error) {
        console.error("Error converting stake key to hash:", error);
        // If conversion fails, try to use it as-is (might be a valid hash)
        stakeCredentialHash = stakeKey;
      }
    }

    return new MultisigWallet(
      name,
      keys,
      description,
      numRequiredSigners,
      network,
      stakeCredentialHash,
    );
  }, [
    name,
    description,
    signersAddresses,
    signersStakeKeys,
    signersDescriptions,
    numRequiredSigners,
    network,
    stakeKey,
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
  
  // Mutations for saving specific fields
  const { mutate: saveWalletInfo } = api.wallet.updateNewWalletInfo.useMutation({
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Wallet info saved successfully",
        duration: 2000,
      });
    },
    onError: (e) => {
      toast({
        title: "Error",
        description: "Failed to save wallet info",
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  const { mutate: saveSignatureRules } = api.wallet.updateNewWalletSignatureRules.useMutation({
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Signature rules saved successfully",
        duration: 2000,
      });
    },
    onError: (e) => {
      toast({
        title: "Error",
        description: "Failed to save signature rules",
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  const { mutate: saveAdvanced } = api.wallet.updateNewWalletAdvanced.useMutation({
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Advanced settings saved successfully",
        duration: 2000,
      });
    },
    onError: (e) => {
      toast({
        title: "Error",
        description: "Failed to save advanced settings",
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  // Mutation for signer changes only
  const { mutate: saveSignersOnly } = api.wallet.updateNewWalletSignersOnly.useMutation({
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Signers saved successfully",
        duration: 2000,
      });
    },
    onError: (e) => {
      toast({
        title: "Error",
        description: "Failed to save signers",
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  // Keep the full update mutation for other cases
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

  // Initialize first signer with current user (only when not loading from existing wallet)
  useEffect(() => {
    if (!user || pathIsWalletInvite) return;
    setSignerAddresses([user.address]);
    setSignerDescriptions([""]);
    // Don't set stake key if global stake key is already set
    setSignerStakeKeys([stakeKey && stakeKey.trim() !== "" ? "" : user.stakeAddress]);
  }, [user, stakeKey, pathIsWalletInvite]);

  // Adjust numRequiredSigners if it exceeds the number of signers
  useEffect(() => {
    if (numRequiredSigners > signersAddresses.length && signersAddresses.length > 0) {
      setNumRequiredSigners(signersAddresses.length);
    }
  }, [signersAddresses.length, numRequiredSigners]);

  // Auto-set numRequiredSigners based on nativeScriptType
  useEffect(() => {
    if (nativeScriptType === "all" && signersAddresses.length > 0) {
      setNumRequiredSigners(signersAddresses.length);
    } else if (nativeScriptType === "any" && signersAddresses.length > 0) {
      setNumRequiredSigners(1);
    }
    // For "atLeast", keep the current value
  }, [nativeScriptType, signersAddresses.length]);

  // Load wallet invite data
  useEffect(() => {
    if (pathIsWalletInvite && walletInvite) {
      setName(walletInvite.name);
      setDescription(walletInvite.description ?? "");
      setSignerAddresses(walletInvite.signersAddresses);
      setSignerDescriptions(walletInvite.signersDescriptions);
      setSignerStakeKeys(walletInvite.signersStakeKeys);
      setNumRequiredSigners(walletInvite.numRequiredSigners!);
      // Load global stake key if it exists
      if ((walletInvite as any).stakeCredentialHash) {
        setStakeKey((walletInvite as any).stakeCredentialHash);
      }
    }
  }, [pathIsWalletInvite, walletInvite]);

  // Utility functions
  function addSigner() {
    setSignerAddresses([...signersAddresses, ""]);
    setSignerDescriptions([...signersDescriptions, ""]);
    // Don't add stake key if global stake key is set
    setSignerStakeKeys([...signersStakeKeys, stakeKey && stakeKey.trim() !== "" ? "" : ""]);
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

    // Convert stake key to hash before creating wallet
    let stakeCredentialHash: string | undefined = undefined;
    if (stakeKey.length > 0) {
      try {
        // Check if it's already a hash (56 characters) or an address (64+ characters)
        if (stakeKey.length === 56) {
          stakeCredentialHash = stakeKey;
        } else {
          // It's likely a stake address, convert to hash
          stakeCredentialHash = stakeKeyHash(stakeKey);
        }
      } catch (error) {
        console.error("Error converting stake key to hash:", error);
        stakeCredentialHash = stakeKey; // Fallback
      }
    }

    createWallet({
      name: name,
      description: description,
      signersAddresses: signersAddresses,
      signersDescriptions: signersDescriptions,
      signersStakeKeys: signersStakeKeys,
      numRequiredSigners: numRequiredSigners,
      scriptCbor: scriptCbor,
      stakeCredentialHash,
      type: nativeScriptType,
    });
  }

  async function handleCreateNewWallet() {
    if (router.pathname == "/wallets/new-wallet-flow/save") {
      setLoading(true);
      // Convert stake key to hash before creating wallet
      let stakeCredentialHash: string | undefined = undefined;
      if (stakeKey.length > 0) {
        try {
          // Check if it's already a hash (56 characters) or an address (64+ characters)
          if (stakeKey.length === 56) {
            stakeCredentialHash = stakeKey;
          } else {
            // It's likely a stake address, convert to hash
            stakeCredentialHash = stakeKeyHash(stakeKey);
          }
        } catch (error) {
          console.error("Error converting stake key to hash:", error);
          stakeCredentialHash = stakeKey; // Fallback
        }
      }

      createNewWallet({
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        ownerAddress: userAddress!,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash,
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
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: stakeKey.length > 0 ? stakeKey : undefined,
      });
    }
  }

  // Save callbacks for create page
  const handleSaveWalletInfo = useCallback((newName: string, newDescription: string) => {
    if (walletInviteId || router.query.id) {
      saveWalletInfo({
        walletId: (walletInviteId || router.query.id) as string,
        name: newName,
        description: newDescription,
      });
    }
  }, [walletInviteId, router.query.id, saveWalletInfo]);

  const handleSaveSigners = useCallback((newAddresses: string[], newDescriptions: string[], newStakeKeys: string[]) => {
    if (walletInviteId || router.query.id) {
      saveSignersOnly({
        walletId: (walletInviteId || router.query.id) as string,
        signersAddresses: newAddresses,
        signersDescriptions: newDescriptions,
        signersStakeKeys: newStakeKeys,
      });
    }
  }, [walletInviteId, router.query.id, saveSignersOnly]);

  const handleSaveSignatureRules = useCallback((numRequired: number) => {
    // Save signature rules
    if (walletInviteId || router.query.id) {
      saveSignatureRules({
        walletId: (walletInviteId || router.query.id) as string,
        numRequiredSigners: numRequired,
      });
    }
  }, [walletInviteId, router.query.id, saveSignatureRules]);

  const handleSaveAdvanced = useCallback((newStakeKey: string, scriptType: "all" | "any" | "atLeast") => {
    // Update local state
    setStakeKey(newStakeKey);
    setNativeScriptType(scriptType);
    
    if (walletInviteId || router.query.id) {
      // Convert to hash before saving
      let stakeCredentialHash: string | undefined = undefined;
      if (newStakeKey.length > 0) {
        try {
          // Check if it's already a hash (56 characters) or an address (64+ characters)
          if (newStakeKey.length === 56) {
            stakeCredentialHash = newStakeKey;
          } else {
            // It's likely a stake address, convert to hash
            stakeCredentialHash = stakeKeyHash(newStakeKey);
          }
        } catch (error) {
          console.error("Error converting stake key to hash:", error);
          stakeCredentialHash = newStakeKey; // Fallback
        }
      }
      
      saveAdvanced({
        walletId: (walletInviteId || router.query.id) as string,
        stakeCredentialHash,
      });
    }
  }, [walletInviteId, router.query.id, saveAdvanced, setStakeKey, setNativeScriptType]);

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