import { LogOut } from "lucide-react";
import { useWallet } from "@meshsdk/react";
import { useRouter } from "next/router";
import { useUserStore } from "@/lib/zustand/user";
import useUTXOS from "@/hooks/useUTXOS";

interface LogoutWrapperProps {
  mode: "button" | "menu-item";
  onAction?: () => void;
}

export default function LogoutWrapper({ mode, onAction }: LogoutWrapperProps) {
  const { connected, disconnect } = useWallet();
  const { isEnabled: isUtxosEnabled, disable: disableUtxos } = useUTXOS();
  const router = useRouter();
  const setPastWallet = useUserStore((state) => state.setPastWallet);
  const setPastUtxosEnabled = useUserStore((state) => state.setPastUtxosEnabled);

  async function handleLogout() {
    // Disconnect regular wallet if connected
    if (connected) {
      disconnect();
    }
    
    // Disconnect UTXOS wallet if enabled with cleanup
    if (isUtxosEnabled) {
      try {
        await disableUtxos();
        setPastUtxosEnabled(false);
      } catch (error) {
        console.error("[Logout] Error disabling UTXOS wallet:", error);
      }
    }
    
    setPastWallet(undefined);
    router.push("/");
    setTimeout(() => {
      router.reload();
    }, 1000);
    if (onAction) onAction();
  }

  // For now, only menu-item mode is implemented
  if (mode === "menu-item") {
    return (
      <div 
        className="flex items-center gap-2 cursor-pointer"
        onClick={handleLogout}
      >
        <LogOut className="h-4 w-4" />
        <span>Logout</span>
      </div>
    );
  }

  return null;
}