import { create } from "zustand";

const configuredDefaultNetwork = Number(
  process.env.NEXT_PUBLIC_DEFAULT_NETWORK ?? "1",
);
const defaultNetwork = configuredDefaultNetwork === 0 ? 0 : 1;

interface SiteState {
  network: number;
  setNetwork: (network: number) => void;
  randomState: number;
  setRandomState: () => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  alert: string;
  setAlert: (alert: string) => void;
}

export const useSiteStore = create<SiteState>((set) => ({
  // Default to mainnet (1). Testnet/preprod is 0.
  network: defaultNetwork,
  setNetwork: (network: number) => set({ network }),
  randomState: 0,
  setRandomState: () => set({ randomState: Math.random() }),
  loading: false,
  setLoading: (loading: boolean) => set({ loading }),
  alert: "",
  setAlert: (alert: string) => set({ alert }),
}));
