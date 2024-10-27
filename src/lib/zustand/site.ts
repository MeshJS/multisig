import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SiteState {
  network: number;
  setNetwork: (network: number) => void;
  randomState: number;
  setRandomState: () => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

export const useSiteStore = create<SiteState>()(
  persist(
    (set) => ({
      network: 0,
      setNetwork: (network: number) => set({ network }),
      randomState: 0,
      setRandomState: () => set({ randomState: Math.random() }),
      loading: false,
      setLoading: (loading: boolean) => set({ loading }),
    }),
    { name: "msig-site" },
  ),
);
