import { useContext } from "react";
import { WalletContext } from "@meshsdk/react";

/**
 * WalletState enum matching MeshJS implementation
 */
export enum WalletState {
  NOT_CONNECTED = "NOT_CONNECTED",
  CONNECTING = "CONNECTING",
  CONNECTED = "CONNECTED",
}

/**
 * Custom hook to access MeshJS WalletContext directly
 * Provides access to internal state like WalletState enum, connectingWallet, and error
 */
export function useWalletContext() {
  const context = useContext(WalletContext);

  if (!context) {
    throw new Error(
      "useWalletContext must be used within a MeshProvider",
    );
  }

  return {
    ...context,
    // Expose WalletState enum for convenience
    WalletState,
  };
}

