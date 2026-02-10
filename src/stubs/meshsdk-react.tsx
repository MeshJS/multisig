import React, { createContext } from "react";

type WalletContextValue = {
  state: string;
  connectingWallet: string | null;
  connectedWalletName: string | null;
  connectWallet: (walletName: string, persist?: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  setPersist: (persist: boolean) => void;
  error: Error | null;
  connectedWalletInstance: Record<string, unknown>;
  wallet: unknown;
};

const noopAsync = async () => {};
const noop = () => {};

const defaultWalletContext: WalletContextValue = {
  state: "NOT_CONNECTED",
  connectingWallet: null,
  connectedWalletName: null,
  connectWallet: noopAsync,
  disconnect: noopAsync,
  setPersist: noop,
  error: null,
  connectedWalletInstance: {},
  wallet: null,
};

export const WalletContext = createContext<WalletContextValue>(
  defaultWalletContext,
);

export const MeshProvider = ({ children }: { children: React.ReactNode }) => {
  return <>{children}</>;
};

export const useWallet = () => ({
  wallet: null,
  connected: false,
  disconnect: noopAsync,
  connectWallet: noopAsync,
});

export const useAddress = () => undefined;

export const useWalletList = () => [];

export const useNetwork = () => undefined;

export const useAssets = () => [];
