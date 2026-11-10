import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import { useUserStore } from "@/lib/zustand/user";
import useOnboardingPreference from "@/hooks/useOnboardingPreference";

export default function RestoreOnboarding() {
  const address = useUserStore((state) => state.userAddress);
  const { ready, setDismissed } = useOnboardingPreference(address);
  const router = useRouter();
  if (!ready) return null;
  return (
    <Button
      variant="outline"
      onClick={() => {
        setDismissed(false);
        void router.push("/wallets");
      }}
    >
      Show guide on My wallets
    </Button>
  );
}
