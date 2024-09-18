import { User } from "@prisma/client";
import { create } from "zustand";

interface UserState {
  userAddress: string | undefined;
  setUserAddress: (address: string | undefined) => void;
  user: User | undefined;
  setUser: (user: User | undefined) => void;
}

export const useUserStore = create<UserState>()((set, get) => ({
  userAddress: undefined,
  setUserAddress: (address) => set({ userAddress: address }),
  user: undefined,
  setUser: (user) => set({ user }),
}));
