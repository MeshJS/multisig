/**
 * useMigrationWalletFlowState Hook
 * Adapts the existing wallet flow state for migration purposes
 * Pre-populates data from the current wallet and handles migration-specific logic
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { resolvePaymentKeyHash, resolveStakeKeyHash } from "@meshsdk/core";
import type { MultisigKey } from "@/utils/multisigSDK";
import { MultisigWallet } from "@/utils/multisigSDK";
import { paymentKeyHash } from "@/utils/multisigSDK";

import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { useToast } from "@/hooks/use-toast";
import { Wallet } from "@/types/wallet";

export interface MigrationWalletFlowState {
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
  removeExternalStakeAndBackfill: () => void;
  
  // UI state
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  
  // Computed values
  multisigWallet?: MultisigWallet;
  isValidForCreate: boolean;
  
  // Dependencies
  userAddress?: string;
  network: number;
  toast: ReturnType<typeof useToast>['toast'];
  
  // Migration-specific
  appWallet: Wallet;
  newWalletId?: string;
  
  // Actions
  createMigrationWallet: () => Promise<void>;
  
  // Save callbacks for create page
  handleSaveWalletInfo: (newName: string, newDescription: string) => void;
  handleSaveSigners: (newAddresses: string[], newDescriptions: string[], newStakeKeys: string[]) => void;
  handleSaveSignatureRules: (numRequired: number) => void;
  handleSaveAdvanced: (newStakeKey: string, scriptType: "all" | "any" | "atLeast") => void;
}

export function useMigrationWalletFlowState(appWallet: Wallet): MigrationWalletFlowState {
  const [signersAddresses, setSignerAddresses] = useState<string[]>([]);
  const [signersDescriptions, setSignerDescriptions] = useState<string[]>([]);
  const [signersStakeKeys, setSignerStakeKeys] = useState<string[]>([]);
  const [numRequiredSigners, setNumRequiredSigners] = useState<number>(1);
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [nativeScriptType, setNativeScriptType] = useState<"all" | "any" | "atLeast">("atLeast");
  const [stakeKey, setStakeKey] = useState<string>("");
  const [newWalletId, setNewWalletId] = useState<string | undefined>();
  
  // Dependencies
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);
  const { toast } = useToast();
  
  // Get complete wallet data from database
  const { data: walletData } = api.wallet.getWallet.useQuery(
    {
      address: userAddress!,
      walletId: appWallet.id,
    },
    {
      enabled: !!userAddress && !!appWallet.id,
    }
  );

  // Get existing new wallet data if migration is in progress
  const { data: existingNewWallet } = api.wallet.getNewWallet.useQuery(
    {
      walletId: (appWallet as any).migrationTargetWalletId || "",
    },
    {
      enabled: !!(appWallet as any).migrationTargetWalletId,
    }
  );

  // Initialize data from current wallet
  useEffect(() => {
    if (walletData) {
      setName(`${walletData.name} - Migrated`);
      setDescription(walletData.description || "");
      setSignerAddresses(walletData.signersAddresses || []);
      setSignerDescriptions(walletData.signersDescriptions || []);
      setNumRequiredSigners(walletData.numRequiredSigners || 1);
      setNativeScriptType(walletData.type || "atLeast");
      setStakeKey(walletData.stakeCredentialHash || "");

      // Filter and process stake keys
      const validStakeKeys = (walletData.signersStakeKeys || []).filter((key: string) => {
        // Check if it's a valid 28-byte or 32-byte hex hash
        if (/^[0-9a-fA-F]{56}$/.test(key) || /^[0-9a-fA-F]{64}$/.test(key)) {
          return true;
        }
        // Check if it's a full stake address
        if (key.startsWith('stake1') || key.startsWith('stake_test1')) {
          return true;
        }
        return false;
      });

      setSignerStakeKeys(validStakeKeys);
    }
  }, [walletData]);

  // Load existing new wallet data if available
  useEffect(() => {
    if (existingNewWallet) {
      setNewWalletId(existingNewWallet.id);
      setName(existingNewWallet.name);
      setDescription(existingNewWallet.description || "");
      setSignerAddresses(existingNewWallet.signersAddresses || []);
      setSignerDescriptions(existingNewWallet.signersDescriptions || []);
      setSignerStakeKeys(existingNewWallet.signersStakeKeys || []);
      setNumRequiredSigners(existingNewWallet.numRequiredSigners || 1);
      setStakeKey(existingNewWallet.stakeCredentialHash || "");
      setNativeScriptType(existingNewWallet.scriptType || "atLeast");
    }
  }, [existingNewWallet]);

  // MultisigWallet computation
  const multisigWallet = useMemo(() => {
    const keys: MultisigKey[] = [];
    if (signersAddresses.length === 0) return;

    if (signersAddresses.length > 0) {
      signersAddresses.forEach((addr, i) => {
        if (addr) {
          try {
            const paymentHash = paymentKeyHash(addr);
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
    signersDescriptions,
    numRequiredSigners,
    network,
    stakeKey,
    nativeScriptType,
  ]);

  // API Mutations
  const { mutate: createNewWallet } = api.wallet.createNewWallet.useMutation({
    onSuccess: (data) => {
      setNewWalletId(data.id);
      setLoading(false);
      toast({
        title: "Wallet Created",
        description: "New wallet configuration created successfully",
        duration: 3000,
      });
    },
    onError: (e) => {
      setLoading(false);
      toast({
        title: "Error",
        description: "Failed to create new wallet configuration",
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  const { mutate: updateNewWallet } = api.wallet.updateNewWallet.useMutation({
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Changes saved successfully",
        duration: 2000,
      });
    },
    onError: (e) => {
      toast({
        title: "Error",
        description: "Failed to save changes",
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  const { mutate: createWallet } = api.wallet.createWallet.useMutation({
    onSuccess: (data) => {
      console.log("Wallet created successfully:", data);
      
      // Set migration target after successful wallet creation
      setMigrationTarget({
        walletId: appWallet.id,
        newWalletId: data.id,
      });
      
      setNewWalletId(data.id);
      setLoading(false);
      toast({
        title: "Success",
        description: "New wallet created successfully!",
        duration: 3000,
      });
    },
    onError: (e) => {
      console.error("Failed to create wallet:", e);
      setLoading(false);
      toast({
        title: "Error",
        description: "Failed to create new wallet",
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  const { mutate: setMigrationTarget } = api.wallet.setMigrationTarget.useMutation({
    onSuccess: () => {
      // Migration target set successfully - no need for additional toast since wallet creation already shows success
    },
    onError: (e) => {
      console.error("Failed to set migration target:", e);
      toast({
        title: "Warning",
        description: "Wallet created but migration target not set. Please try again.",
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  // Utility functions
  function addSigner() {
    setSignerAddresses([...signersAddresses, ""]);
    setSignerDescriptions([...signersDescriptions, ""]);
    setSignerStakeKeys([...signersStakeKeys, ""]);
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

  // Adjust numRequiredSigners if it exceeds the number of signers
  useEffect(() => {
    if (numRequiredSigners > signersAddresses.length && signersAddresses.length > 0) {
      setNumRequiredSigners(signersAddresses.length);
    }
  }, [signersAddresses.length, numRequiredSigners]);

  // Create migration wallet
  async function createMigrationWallet() {
    console.log("createMigrationWallet called", { multisigWallet, name, signersAddresses });
    
    if (!multisigWallet) {
      toast({
        title: "Error",
        description: "Invalid wallet configuration. Please check your settings.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { scriptCbor } = multisigWallet.getScript();
      if (!scriptCbor) {
        throw new Error("Failed to generate script CBOR");
      }

      console.log("Creating wallet with data:", {
        name,
        description,
        signersAddresses,
        signersDescriptions,
        signersStakeKeys,
        numRequiredSigners,
        stakeCredentialHash: stakeKey || undefined,
        type: nativeScriptType,
      });

      // Create the new wallet directly
      createWallet({
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        numRequiredSigners: numRequiredSigners,
        scriptCbor: scriptCbor,
        stakeCredentialHash: stakeKey || undefined,
        type: nativeScriptType,
      });

    } catch (error) {
      console.error("Failed to create wallet:", error);
      setLoading(false);
      toast({
        title: "Error",
        description: "Failed to create new wallet. Please try again.",
        variant: "destructive",
      });
    }
  }

  // Save callbacks for create page
  const handleSaveWalletInfo = useCallback((newName: string, newDescription: string) => {
    setName(newName);
    setDescription(newDescription);
    
    if (newWalletId) {
      updateNewWallet({
        walletId: newWalletId,
        name: newName,
        description: newDescription,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType,
      });
    }
  }, [newWalletId, signersAddresses, signersDescriptions, signersStakeKeys, numRequiredSigners, stakeKey, nativeScriptType, updateNewWallet]);

  const handleSaveSigners = useCallback((newAddresses: string[], newDescriptions: string[], newStakeKeys: string[]) => {
    setSignerAddresses(newAddresses);
    setSignerDescriptions(newDescriptions);
    setSignerStakeKeys(newStakeKeys);
    
    if (newWalletId) {
      updateNewWallet({
        walletId: newWalletId,
        name: name,
        description: description,
        signersAddresses: newAddresses,
        signersDescriptions: newDescriptions,
        signersStakeKeys: newStakeKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType,
      });
    }
  }, [newWalletId, name, description, numRequiredSigners, stakeKey, nativeScriptType, updateNewWallet]);

  const handleSaveSignatureRules = useCallback((numRequired: number) => {
    setNumRequiredSigners(numRequired);
    
    if (newWalletId) {
      updateNewWallet({
        walletId: newWalletId,
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        numRequiredSigners: numRequired,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType,
      });
    }
  }, [newWalletId, name, description, signersAddresses, signersDescriptions, signersStakeKeys, stakeKey, nativeScriptType, updateNewWallet]);

  const handleSaveAdvanced = useCallback((newStakeKey: string, scriptType: "all" | "any" | "atLeast") => {
    setStakeKey(newStakeKey);
    setNativeScriptType(scriptType);
    
    // If external stake credential is set, clear all signer stake keys
    const updatedSignerStakeKeys = newStakeKey ? 
      signersStakeKeys.map(() => "") : 
      signersStakeKeys;
    
    if (newStakeKey) {
      setSignerStakeKeys(updatedSignerStakeKeys);
    }
    
    if (newWalletId) {
      updateNewWallet({
        walletId: newWalletId,
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: updatedSignerStakeKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: newStakeKey || undefined,
        scriptType: scriptType,
      });
    }
  }, [newWalletId, name, description, signersAddresses, signersDescriptions, signersStakeKeys, numRequiredSigners, updateNewWallet]);

  // Remove external stake credential and try to backfill stake keys from addresses
  const removeExternalStakeAndBackfill = useCallback(() => {
    setStakeKey("");
    setSignerStakeKeys(signersStakeKeys);
    
    if (newWalletId) {
      updateNewWallet({
        walletId: newWalletId,
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: null,
        scriptType: nativeScriptType,
      });
    }

    toast({
      title: "External stake removed",
      description: "External stake credential has been removed.",
      duration: 3000,
    });
  }, [signersAddresses, signersStakeKeys, newWalletId, name, description, signersDescriptions, numRequiredSigners, nativeScriptType, updateNewWallet, toast]);

  // Validation
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
    removeExternalStakeAndBackfill,
    
    // UI state
    loading,
    setLoading,
    
    // Computed values
    multisigWallet,
    isValidForCreate,
    
    // Dependencies
    userAddress,
    network,
    toast,
    
    // Migration-specific
    appWallet,
    newWalletId,
    
    // Actions
    createMigrationWallet,
    
    // Save callbacks
    handleSaveWalletInfo,
    handleSaveSigners,
    handleSaveSignatureRules,
    handleSaveAdvanced,
  };
}
