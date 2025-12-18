/**
 * useMigrationWalletFlowState Hook
 * Adapts the existing wallet flow state for migration purposes
 * Pre-populates data from the current wallet and handles migration-specific logic
 */

import { useState, useEffect, useMemo, useCallback } from "react";
import { resolveStakeKeyHash } from "@meshsdk/core";
import type { MultisigKey } from "@/utils/multisigSDK";
import { MultisigWallet } from "@/utils/multisigSDK";
import { paymentKeyHash } from "@/utils/multisigSDK";

import { api } from "@/utils/api";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { useToast } from "@/hooks/use-toast";
import type { Wallet } from "@/types/wallet";

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
  isValidForCreate: boolean;
  
  // Dependencies
  userAddress?: string;
  network: number;
  toast: ReturnType<typeof useToast>['toast'];
  
  // Migration-specific
  appWallet: Wallet;
  newWalletId?: string;
  
  // Actions
  createTemporaryWallet: () => Promise<void>;
  createMigrationWallet: () => Promise<string | null>;
  
  // Save callbacks for create page
  handleSaveWalletInfo: (newName: string, newDescription: string) => void;
  handleSaveSigners: (newAddresses: string[], newDescriptions: string[], newStakeKeys: string[], newDRepKeys: string[]) => Promise<void>;
  handleSaveSignatureRules: (numRequired: number) => Promise<void>;
  handleSaveAdvanced: (newStakeKey: string, scriptType: "all" | "any" | "atLeast") => Promise<void>;
}

export function useMigrationWalletFlowState(appWallet: Wallet): MigrationWalletFlowState {
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
  type WalletWithMigration = { migrationTargetWalletId?: string };
  const { data: existingNewWallet } = api.wallet.getNewWallet.useQuery(
    {
      walletId: ((appWallet as unknown as WalletWithMigration).migrationTargetWalletId) ?? "",
    },
    {
      enabled: Boolean((appWallet as unknown as WalletWithMigration).migrationTargetWalletId),
    }
  );

  // Initialize data from current wallet
  useEffect(() => {
    if (walletData) {
      setName(`${walletData.name} - Migrated`);
      setDescription(walletData.description ?? "");
      setSignerAddresses(walletData.signersAddresses ?? []);
      setSignerDescriptions(walletData.signersDescriptions ?? []);
      setNumRequiredSigners(walletData.numRequiredSigners ?? 1);
      setNativeScriptType((walletData.type as "atLeast" | "all" | "any") ?? "atLeast");
      setStakeKey(walletData.stakeCredentialHash ?? "");

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
      
      // Initialize DRep keys (empty for now, can be added later)
      setSignerDRepKeys(
        Array.isArray((walletData as unknown as { signersDRepKeys?: string[] }).signersDRepKeys)
          ? (walletData as unknown as { signersDRepKeys?: string[] }).signersDRepKeys!
          : [],
      );
    }
  }, [walletData]);

  // Load existing new wallet data if available
  useEffect(() => {
    if (existingNewWallet) {
      setNewWalletId(existingNewWallet.id);
      setName(existingNewWallet.name);
      setDescription(existingNewWallet.description ?? "");
      setSignerAddresses(existingNewWallet.signersAddresses ?? []);
      setSignerDescriptions(existingNewWallet.signersDescriptions ?? []);
      setSignerStakeKeys(existingNewWallet.signersStakeKeys ?? []);
      setSignerDRepKeys(
        Array.isArray((existingNewWallet as unknown as { signersDRepKeys?: string[] }).signersDRepKeys)
          ? (existingNewWallet as unknown as { signersDRepKeys?: string[] }).signersDRepKeys!
          : [],
      );
      setNumRequiredSigners(existingNewWallet.numRequiredSigners ?? 1);
      setStakeKey(existingNewWallet.stakeCredentialHash ?? "");
      setNativeScriptType((existingNewWallet.scriptType as "atLeast" | "all" | "any") ?? "atLeast");
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
    onError: (_e) => {
      setLoading(false);
      toast({
        title: "Error",
        description: "Failed to create new wallet configuration",
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  const { mutateAsync: updateNewWallet } = api.wallet.updateNewWallet.useMutation({
    onSuccess: () => {
      toast({
        title: "Saved",
        description: "Changes saved successfully",
        duration: 2000,
      });
    },
    onError: (_e) => {
      toast({
        title: "Error",
        description: "Failed to save changes",
        variant: "destructive",
        duration: 3000,
      });
    },
  });

  const { mutate: createWallet } = api.wallet.createWallet.useMutation();
  const { mutateAsync: deleteNewWallet } = api.wallet.deleteNewWallet.useMutation();

  const { mutate: setMigrationTarget } = api.wallet.setMigrationTarget.useMutation({
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

  // Adjust numRequiredSigners if it exceeds the number of signers
  useEffect(() => {
    if (numRequiredSigners > signersAddresses.length && signersAddresses.length > 0) {
      setNumRequiredSigners(signersAddresses.length);
    }
  }, [signersAddresses.length, numRequiredSigners]);

  // Create temporary wallet for invite link (if not already created)
  const createTemporaryWallet = useCallback(async () => {
    if (newWalletId) {
      return; // Already created
    }

    
    if (!name || signersAddresses.length === 0) {
      toast({
        title: "Error",
        description: "Please provide wallet name and at least one signer before creating invite link.",
        variant: "destructive",
      });
      return;
    }

    if (!userAddress) {
      toast({
        title: "Error",
        description: "Please connect your wallet before creating a wallet invite link.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const walletData = {
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        signersDRepKeys: signersDRepKeys,
        numRequiredSigners: numRequiredSigners,
        ownerAddress: userAddress,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType || undefined,
      };
      
      
      // Create temporary wallet for invite link
      createNewWallet(walletData);
    } catch (error) {
      console.error("Failed to create temporary wallet:", error);
      setLoading(false);
      toast({
        title: "Error",
        description: "Failed to create temporary wallet. Please try again.",
        variant: "destructive",
      });
    }
  }, [newWalletId, name, signersAddresses, description, signersDescriptions, signersStakeKeys, signersDRepKeys, numRequiredSigners, stakeKey, nativeScriptType, createNewWallet, toast, userAddress]);

  // Create final migration wallet
  async function createMigrationWallet(): Promise<string | null> {
    
    if (!multisigWallet) {
      toast({
        title: "Error",
        description: "Invalid wallet configuration. Please check your settings.",
        variant: "destructive",
      });
      return null;
    }

    if (!newWalletId) {
      toast({
        title: "Error",
        description: "Please create the temporary wallet first to generate invite link.",
        variant: "destructive",
      });
      return null;
    }

    // Check if final wallet has already been created
    if ((appWallet as unknown as WalletWithMigration).migrationTargetWalletId) {
      toast({
        title: "Error",
        description: "Final wallet has already been created for this migration. You can only create one new wallet per migration.",
        variant: "destructive",
      });
      return null;
    }

    setLoading(true);
    try {
      const { scriptCbor } = multisigWallet.getScript();
      if (!scriptCbor) {
        throw new Error("Failed to generate script CBOR");
      }


      // Create the final wallet using the mutation
      return new Promise((resolve, reject) => {
        createWallet({
          name: name,
          description: description,
          signersAddresses: signersAddresses,
          signersDescriptions: signersDescriptions,
          signersStakeKeys: signersStakeKeys,
          signersDRepKeys: signersDRepKeys,
          numRequiredSigners: numRequiredSigners,
          scriptCbor: scriptCbor,
          stakeCredentialHash: stakeKey || undefined,
          type: nativeScriptType,
        }, {
          onSuccess: (data) => {
            
            // Set migration target after successful wallet creation
            setMigrationTarget({
              walletId: appWallet.id,
              migrationTargetWalletId: data.id,
            });
            
            // Clean up the temporary NewWallet
            if (newWalletId && newWalletId !== data.id) {
              void deleteNewWallet({ walletId: newWalletId }).catch((err) => {
                console.warn("Failed to delete temporary new wallet:", err);
              });
            }
            
            setNewWalletId(data.id);
            setLoading(false);
            toast({
              title: "Success",
              description: "New wallet created successfully!",
              duration: 3000,
            });
            resolve(data.id);
          },
          onError: (error) => {
            console.error("Failed to create wallet:", error);
            setLoading(false);
            toast({
              title: "Error",
              description: "Failed to create new wallet",
              variant: "destructive",
              duration: 3000,
            });
            reject(error instanceof Error ? error : new Error(error?.message ?? 'Unknown error'));
          }
        });
      });

    } catch (error) {
      console.error("Failed to create wallet:", error);
      setLoading(false);
      toast({
        title: "Error",
        description: "Failed to create new wallet. Please try again.",
        variant: "destructive",
      });
      return null;
    }
  }

  // Save callbacks for create page
  const handleSaveWalletInfo = useCallback((newName: string, newDescription: string) => {
    setName(newName);
    setDescription(newDescription);
    
    if (newWalletId) {
      void updateNewWallet({
        walletId: newWalletId,
        name: newName,
        description: newDescription,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        signersDRepKeys: signersDRepKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType || undefined,
      });
    }
  }, [newWalletId, signersAddresses, signersDescriptions, signersStakeKeys, signersDRepKeys, numRequiredSigners, stakeKey, nativeScriptType, updateNewWallet]);

  const handleSaveSigners = useCallback(async (newAddresses: string[], newDescriptions: string[], newStakeKeys: string[], newDRepKeys: string[]) => {
    // Ensure all arrays are defined and filter out undefined values
    const safeAddresses = (newAddresses || []).filter(addr => addr !== undefined);
    const safeDescriptions = (newDescriptions || []).filter(desc => desc !== undefined);
    const safeStakeKeys = (newStakeKeys || []).filter(key => key !== undefined);
    const safeDRepKeys = (newDRepKeys || []).filter(key => key !== undefined);
    
    // Ensure all arrays have the same length
    const maxLength = Math.max(safeAddresses.length, safeDescriptions.length, safeStakeKeys.length, safeDRepKeys.length);
    
    const paddedAddresses = [...safeAddresses];
    const paddedDescriptions = [...safeDescriptions];
    const paddedStakeKeys = [...safeStakeKeys];
    const paddedDRepKeys = [...safeDRepKeys];
    
    // Pad arrays to same length with empty strings
    while (paddedAddresses.length < maxLength) paddedAddresses.push("");
    while (paddedDescriptions.length < maxLength) paddedDescriptions.push("");
    while (paddedStakeKeys.length < maxLength) paddedStakeKeys.push("");
    while (paddedDRepKeys.length < maxLength) paddedDRepKeys.push("");
    
    setSignerAddresses(paddedAddresses);
    setSignerDescriptions(paddedDescriptions);
    setSignerStakeKeys(paddedStakeKeys);
    setSignerDRepKeys(paddedDRepKeys);
    
    if (newWalletId) {
      const updateData = {
        walletId: newWalletId,
        name: name,
        description: description,
        signersAddresses: paddedAddresses,
        signersDescriptions: paddedDescriptions,
        signersStakeKeys: paddedStakeKeys,
        signersDRepKeys: paddedDRepKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: stakeKey || undefined,
        scriptType: nativeScriptType || undefined,
      };
      
      // Validate data before sending
      if (!updateData.walletId || !updateData.name) {
        toast({
          title: "Error",
          description: "Invalid wallet data. Please try again.",
          variant: "destructive",
        });
        return;
      }
      
      // Ensure all arrays contain only strings
      const validatedData = {
        ...updateData,
        signersAddresses: paddedAddresses.map(addr => String(addr || "")),
        signersDescriptions: paddedDescriptions.map(desc => String(desc || "")),
        signersStakeKeys: paddedStakeKeys.map(key => String(key || "")),
        signersDRepKeys: paddedDRepKeys.map(key => String(key || "")),
      };
      
      
      try {
        await updateNewWallet(validatedData);
      } catch (error) {
        console.error("Failed to update new wallet:", error);
      }
    }
  }, [newWalletId, name, description, numRequiredSigners, stakeKey, nativeScriptType, updateNewWallet, toast]);

  const handleSaveSignatureRules = useCallback(async (numRequired: number) => {
    setNumRequiredSigners(numRequired);
    
    if (newWalletId) {
      try {
        await updateNewWallet({
          walletId: newWalletId,
          name: name,
          description: description,
          signersAddresses: signersAddresses,
          signersDescriptions: signersDescriptions,
          signersStakeKeys: signersStakeKeys,
          signersDRepKeys: signersDRepKeys,
          numRequiredSigners: numRequired,
          stakeCredentialHash: stakeKey || undefined,
          scriptType: nativeScriptType || undefined,
        });
      } catch (error) {
        console.error("Failed to update signature rules:", error);
      }
    }
  }, [newWalletId, name, description, signersAddresses, signersDescriptions, signersStakeKeys, signersDRepKeys, stakeKey, nativeScriptType, updateNewWallet]);

  const handleSaveAdvanced = useCallback(async (newStakeKey: string, scriptType: "all" | "any" | "atLeast") => {
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
      try {
        await updateNewWallet({
          walletId: newWalletId,
          name: name,
          description: description,
          signersAddresses: signersAddresses,
          signersDescriptions: signersDescriptions,
          signersStakeKeys: updatedSignerStakeKeys,
          signersDRepKeys: signersDRepKeys,
          numRequiredSigners: numRequiredSigners,
          stakeCredentialHash: newStakeKey || null,
          scriptType: scriptType,
        });
      } catch (error) {
        console.error("Failed to update advanced settings:", error);
      }
    }
  }, [newWalletId, name, description, signersAddresses, signersDescriptions, signersStakeKeys, signersDRepKeys, numRequiredSigners, updateNewWallet]);

  // Remove external stake credential and try to backfill stake keys from addresses
  const removeExternalStakeAndBackfill = useCallback(() => {
    setStakeKey("");
    setSignerStakeKeys(signersStakeKeys);
    
    if (newWalletId) {
      void updateNewWallet({
        walletId: newWalletId,
        name: name,
        description: description,
        signersAddresses: signersAddresses,
        signersDescriptions: signersDescriptions,
        signersStakeKeys: signersStakeKeys,
        signersDRepKeys: signersDRepKeys,
        numRequiredSigners: numRequiredSigners,
        stakeCredentialHash: null,
        scriptType: nativeScriptType || undefined,
      });
    }

    toast({
      title: "External stake removed",
      description: "External stake credential has been removed.",
      duration: 3000,
    });
  }, [signersAddresses, signersStakeKeys, signersDRepKeys, newWalletId, name, description, signersDescriptions, numRequiredSigners, nativeScriptType, updateNewWallet, toast]);

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
    isValidForCreate,
    
    // Dependencies
    userAddress,
    network,
    toast,
    
    // Migration-specific
    appWallet,
    newWalletId,
    
    // Actions
    createTemporaryWallet,
    createMigrationWallet,
    
    // Save callbacks
    handleSaveWalletInfo,
    handleSaveSigners,
    handleSaveSignatureRules,
    handleSaveAdvanced,
  };
}
