import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SiteState {
  network: number;
  setNetwork: (network: number) => void;
}

export const useSiteStore = create<SiteState>()(
  persist(
    (set) => ({
      network: 0,
      setNetwork: (network: number) => set({ network }),
    }),
    { name: "msig-site" },
  ),
);
