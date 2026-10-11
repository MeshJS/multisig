import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { BackgroundPreset } from "@/components/ui/background";

/**
 * How much of the animated background the user wants.
 *
 * `auto` (the default) hands the decision to hardware detection — see
 * `@/lib/graphics-tier` — so weak devices get a static gradient and capable
 * ones get the full aurora + WebGL surfaces without anybody touching a switch.
 * The other three are explicit overrides for people who disagree with it.
 */
export type BackgroundMode = "auto" | "full" | "reduced" | "off";

export const BACKGROUND_MODES = [
  {
    id: "auto",
    label: "Auto",
    description: "Match your device's graphics capability",
  },
  {
    id: "full",
    label: "Full",
    description: "Aurora plus WebGL surfaces",
  },
  {
    id: "reduced",
    label: "Reduced",
    description: "Aurora only, no WebGL",
  },
  { id: "off", label: "Off", description: "No background effects" },
] as const satisfies readonly { id: BackgroundMode; label: string; description: string }[];

interface AppearanceState {
  /** How much background effect to render. */
  backgroundMode: BackgroundMode;
  setBackgroundMode: (mode: BackgroundMode) => void;
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
      backgroundMode: "auto",
      setBackgroundMode: (backgroundMode) => set({ backgroundMode }),
      backgroundPreset: "aurora",
      setBackgroundPreset: (backgroundPreset) => set({ backgroundPreset }),
    }),
    {
      name: "appearance-settings",
      storage: createJSONStorage(() => localStorage),
      version: 2,
      // v1 stored a plain on/off switch. "On" becomes `auto` rather than
      // `full`: the whole point of this migration is that the old blanket
      // "on" was too heavy for some of the devices that had it.
      migrate: (persisted, version) => {
        if (version >= 2) return persisted as AppearanceState;
        const legacy = persisted as Partial<{
          backgroundEnabled: boolean;
          backgroundPreset: BackgroundPreset;
        }> | null;
        return {
          backgroundMode: legacy?.backgroundEnabled === false ? "off" : "auto",
          backgroundPreset: legacy?.backgroundPreset ?? "aurora",
        } as AppearanceState;
      },
    },
  ),
);
