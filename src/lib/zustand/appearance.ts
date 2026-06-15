import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { BackgroundPreset } from "@/components/ui/background";

interface AppearanceState {
  /** Master toggle for the animated app background. */
  backgroundEnabled: boolean;
  setBackgroundEnabled: (enabled: boolean) => void;
  /** Which colour theme the background uses. */
  backgroundPreset: BackgroundPreset;
  setBackgroundPreset: (preset: BackgroundPreset) => void;
}

/**
 * Per-device appearance preferences, persisted to localStorage. Kept separate
 * from account data so it applies instantly without a round-trip; the profile
 * page is just the UI surface for it.
 */
export const useAppearanceStore = create<AppearanceState>()(
  persist(
    (set) => ({
      backgroundEnabled: true,
      setBackgroundEnabled: (backgroundEnabled) => set({ backgroundEnabled }),
      backgroundPreset: "aurora",
      setBackgroundPreset: (backgroundPreset) => set({ backgroundPreset }),
    }),
    {
      name: "appearance-settings",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
