import { Asset } from "@meshsdk/core";
import { User } from "@prisma/client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface UserState {
  userAddress: string | undefined;
  setUserAddress: (address: string | undefined) => void;
  userAssets: Asset[];
  setUserAssets: (assets: Asset[]) => void;
  userAssetMetadata: {
    [policyId: string]: {
      assetName: string;
      decimals: number;
    };
  };
  setUserAssetMetadata: (
    policyId: string,
    assetName: string,
    decimals: number,
  ) => void;
  user: User | undefined;
  setUser: (user: User | undefined) => void;
  pastWallet: string | undefined;
  setPastWallet: (pastWallet: string | undefined) => void;
  pastUtxosEnabled: boolean;
  setPastUtxosEnabled: (enabled: boolean | ((prev: boolean) => boolean)) => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      userAddress: undefined,
      setUserAddress: (address) => set({ userAddress: address }),
      user: undefined,
      setUser: (user) => set({ user }),
      pastWallet: undefined,
      setPastWallet: (wallet) => set({ pastWallet: wallet }),
      pastUtxosEnabled: false,
      setPastUtxosEnabled: (enabled) => {
        const newValue = typeof enabled === "function" ? enabled(get().pastUtxosEnabled) : enabled;
        set({ pastUtxosEnabled: newValue });
      },
      userAssets: [],
      setUserAssets: (assets) => set({ userAssets: assets }),
      userAssetMetadata: {},
      setUserAssetMetadata: (policyId, assetName, decimals) =>
        set((state) => ({
          userAssetMetadata: {
            ...state.userAssetMetadata,
            [policyId]: { assetName, decimals },
          },
        })),
    }),
    {
      name: "persisted-state",
      partialize: (state) => ({
        pastWallet: state.pastWallet,
        pastUtxosEnabled: state.pastUtxosEnabled,
        // Note: userAddress is NOT persisted because it should be set fresh when wallet connects
        // This ensures the address is always current and matches the connected wallet
      }),
    },
  ),
);
