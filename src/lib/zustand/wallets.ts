import { create } from "zustand";
import { Asset, UTxO } from "@meshsdk/core";
import { OnChainTransaction } from "@/types/transaction";
import { BlockfrostDrepInfo } from "@/types/governance";

// interface WalletsState {
//   walletsUtxos: { [walletId: string]: UTxO[] };
//   setWalletsUtxos: (walletId: string, utxos: UTxO[]) => void;
//   walletTransactions: { [walletId: string]: OnChainTransaction[] };
//   setWalletTransactions: (
//     walletId: string,
//     transactions: OnChainTransaction[],
//   ) => void;
//   drepInfo: BlockfrostDrepInfo | undefined;
//   setDrepInfo: (drepInfo: BlockfrostDrepInfo) => void;
//   drepRegistered: boolean;
// }

// export const useWalletsStore = create<WalletsState>()((set, get) => ({
//   walletsUtxos: {},
//   setWalletsUtxos: (walletId, utxos) =>
//     set({ walletsUtxos: { ...get().walletsUtxos, [walletId]: utxos } }),
//   walletTransactions: {},
//   setWalletTransactions: (walletId, transactions) =>
//     set({
//       walletTransactions: {
//         ...get().walletTransactions,
//         [walletId]: transactions,
//       },
//     }),
//   drepInfo: undefined,
//   setDrepInfo: (drepInfo) => set({ drepInfo }),
//   drepRegistered: get()?.drepInfo?.active ?? false,
// }));

import { persist, createJSONStorage } from "zustand/middleware";
import { zustandStorage } from "../indexeddb";

interface State {
  walletsUtxos: { [walletId: string]: UTxO[] };
  setWalletsUtxos: (walletId: string, utxos: UTxO[]) => void;
  walletTransactions: { [walletId: string]: OnChainTransaction[] };
  setWalletTransactions: (
    walletId: string,
    transactions: OnChainTransaction[],
  ) => void;
  walletLastUpdated: { [walletId: string]: number };
  setWalletLastUpdated: (walletId: string, timestamp: number) => void;
  walletAssets: Asset[];
  setWalletAssets: (assets: Asset[]) => void;
  walletAssetMetadata: {
    [policyId: string]: {
      assetName: string;
      decimals: number;
      image: string;
      ticker: string;
    };
  };
  setWalletAssetMetadata: (
    policyId: string,
    assetName: string,
    decimals: number,
    image: string,
    ticker: string,
  ) => void;
  drepInfo: BlockfrostDrepInfo | undefined;
  setDrepInfo: (drepInfo: BlockfrostDrepInfo) => void;
  drepRegistered: boolean;
}

export const useWalletsStore = create<State>()(
  persist(
    (set, get) => ({
      walletsUtxos: {},
      setWalletsUtxos: (walletId, utxos) =>
        set({ walletsUtxos: { ...get().walletsUtxos, [walletId]: utxos } }),
      walletTransactions: {},
      setWalletTransactions: (walletId, transactions) =>
        set({
          walletTransactions: {
            ...get().walletTransactions,
            [walletId]: transactions,
          },
        }),
      walletLastUpdated: {},
      setWalletLastUpdated: (walletId, timestamp) =>
        set({
          walletLastUpdated: {
            ...get().walletLastUpdated,
            [walletId]: timestamp,
          },
        }),
      walletAssets: [],
      setWalletAssets: (assets) => set({ walletAssets: assets }),
      walletAssetMetadata: {},
      setWalletAssetMetadata: (policyId, assetName, decimals, image, ticker) =>
        set((state) => ({
          walletAssetMetadata: {
            ...state.walletAssetMetadata,
            [policyId]: { assetName, decimals, image, ticker },
          },
        })),
      drepInfo: undefined,
      setDrepInfo: (drepInfo) => set({ drepInfo }),
      drepRegistered: get()?.drepInfo?.active ?? false,
    }),
    {
      name: "multisig-wallets",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
