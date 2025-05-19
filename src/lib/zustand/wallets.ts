import { create } from "zustand";
import { Asset, UTxO } from "@meshsdk/core";
import { OnChainTransaction } from "@/types/transaction";
import { BlockfrostDrepInfo } from "@/types/governance";
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
    [unit: string]: {
      assetName: string;
      decimals: number;
      image: string;
      ticker: string;
      policyId: string;
    };
  };
  setWalletAssetMetadata: (
    unit: string,
    assetName: string,
    decimals: number,
    image: string,
    ticker: string,
    policyId: string,
  ) => void;

  drepInfo: BlockfrostDrepInfo | undefined;
  setDrepInfo: (drepInfo: BlockfrostDrepInfo | undefined) => void;

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
      setWalletAssetMetadata: (
        unit,
        assetName,
        decimals,
        image,
        ticker,
        policyId,
      ) =>
        set((state) => ({
          walletAssetMetadata: {
            ...state.walletAssetMetadata,
            [unit]: { assetName, decimals, image, ticker, policyId },
          },
        })),

      drepInfo: undefined,
      setDrepInfo: (drepInfo) => set({ drepInfo }),


    }),
    {
      name: "multisig-wallets",
      storage: createJSONStorage(() => zustandStorage),
    },
  ),
);
