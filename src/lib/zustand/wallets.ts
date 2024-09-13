import { create } from "zustand";
import { UTxO } from "@meshsdk/core";

interface WalletsState {
  walletsUtxos: { [walletId: string]: UTxO[] };
  setWalletsUtxos: (walletId: string, utxos: UTxO[]) => void;
}

export const useWalletsStore = create<WalletsState>()((set, get) => ({
  walletsUtxos: {},
  setWalletsUtxos: (walletId, utxos) =>
    set({ walletsUtxos: { ...get().walletsUtxos, [walletId]: utxos } }),
}));
