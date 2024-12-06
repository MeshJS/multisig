import { User } from "@prisma/client";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface UserState {
  userAddress: string | undefined;
  setUserAddress: (address: string | undefined) => void;
  user: User | undefined;
  setUser: (user: User | undefined) => void;
  pastWallet: string | undefined;
  setPastWallet: (pastWallet: string | undefined) => void;
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
    }),
    {
      name: "persisted-state",
      partialize: (state) => ({
        pastWallet: state.pastWallet,
      }),
    },
  ),
);
