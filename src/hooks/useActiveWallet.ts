import { useCallback, useMemo } from "react";
import { useWallet } from "@meshsdk/react";
import useUTXOS from "./useUTXOS";
import { useUserStore } from "@/lib/zustand/user";
import type { IWallet } from "@meshsdk/core";

/**
 * useActiveWallet Hook
 * 
 * Centralized hook for managing active wallet connections across the application.
 * Provides a unified interface for both regular Mesh wallets and UTXOS wallets.
 * 
 * @returns {Object} Wallet connection state and utilities
 */
export default function useActiveWallet() {
  // Get wallet instances from both wallet types
  const { wallet, connected } = useWallet(); // Regular Mesh wallet (browser extension)
  const { wallet: utxosWallet, isEnabled: isUtxosEnabled } = useUTXOS(); // UTXOS wallet (Wallet-as-a-Service)
  const userAddress = useUserStore((state) => state.userAddress);

  /**
   * Get the active wallet instance for signing/submitting transactions
   * 
   * Priority:
   * 1. Regular wallet if connected
   * 2. UTXOS wallet.cardano interface if enabled
   * 3. null if neither is available
   * 
   * @returns {IWallet | null} Active wallet instance or null
   */
  const getActiveWallet = useCallback((): IWallet | null => {
    // Check regular wallet - must be both connected AND have wallet instance
    if (connected && wallet) {
      return wallet;
    }
    
    // Check UTXOS wallet - must be both enabled AND have wallet instance with cardano property
    if (isUtxosEnabled && utxosWallet && utxosWallet.cardano) {
      return utxosWallet.cardano;
    }
    
    return null;
  }, [connected, wallet, isUtxosEnabled, utxosWallet]);

  /**
   * Memoized active wallet instance
   * Only recalculates when wallet state actually changes
   */
  const activeWallet = useMemo(() => getActiveWallet(), [getActiveWallet]);

  /**
   * Check if any wallet is connected (lenient check for UI)
   * 
   * Returns true if:
   * - Regular wallet is connected, OR
   * - UTXOS wallet is enabled, OR
   * - User address exists (from previous session)
   * 
   * Note: For operations requiring wallet interaction, use activeWallet !== null
   */
  const isAnyWalletConnected = useMemo(
    () => connected || isUtxosEnabled || !!userAddress,
    [connected, isUtxosEnabled, userAddress]
  );

  /**
   * Check if wallet is ready for operations (strict check)
   * 
   * Returns true only if:
   * - Active wallet instance exists, AND
   * - User address is set
   * 
   * Use this for operations that require actual wallet interaction.
   */
  const isWalletReady = useMemo(
    () => activeWallet !== null && !!userAddress,
    [activeWallet, userAddress]
  );

  /**
   * Get wallet connection type
   * 
   * According to UTXOS docs, after Web3Wallet.enable(), the wallet has a cardano property
   * We check for both the wallet instance and the cardano property to ensure it's fully initialized
   * 
   * @returns {'regular' | 'utxos' | 'none'} Current wallet type
   */
  const walletType = useMemo<'regular' | 'utxos' | 'none'>(() => {
    if (connected && wallet) return 'regular';
    // Check for UTXOS wallet - must have both wallet instance and cardano property
    if (isUtxosEnabled && utxosWallet && utxosWallet.cardano) return 'utxos';
    return 'none';
  }, [connected, wallet, isUtxosEnabled, utxosWallet]);

  /**
   * Check for stale wallet states
   * 
   * Detects cases where wallet objects exist but connection state is invalid
   * 
   * @returns {Object} Stale state information
   */
  const staleState = useMemo(() => {
    const hasStaleRegular = wallet && !connected;
    const hasStaleUtxos = utxosWallet && !isUtxosEnabled;
    return {
      hasStaleRegular,
      hasStaleUtxos,
      hasAnyStale: hasStaleRegular || hasStaleUtxos,
    };
  }, [wallet, connected, utxosWallet, isUtxosEnabled]);

  return {
    // Wallet instances
    wallet,
    utxosWallet,
    activeWallet,
    
    // Connection states
    connected,
    isUtxosEnabled,
    isAnyWalletConnected,
    isWalletReady,
    walletType,
    
    // Utilities
    getActiveWallet,
    staleState,
    
    // User data
    userAddress,
  };
}

