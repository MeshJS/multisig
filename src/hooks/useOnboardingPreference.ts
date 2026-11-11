import { useEffect, useState } from "react";
import { createOnboardingPreferences } from "@/lib/onboarding-preference";

// The callback is only invoked from effects or user events, never during SSR.
const preferences = createOnboardingPreferences(() => window.localStorage);

export default function useOnboardingPreference(address?: string | null) {
  const [choice, setChoice] = useState<{
    address: string;
    dismissed: boolean;
  } | null>(null);
  useEffect(() => {
    setChoice(
      address ? { address, dismissed: preferences.read(address) } : null,
    );
  }, [address]);
  const ready = !!address && choice?.address === address;
  return {
    ready,
    dismissed: ready ? choice.dismissed : false,
    setDismissed: (dismissed: boolean) => {
      if (!address || !ready) return;
      preferences.write(address, dismissed);
      setChoice({ address, dismissed });
    },
  };
}
