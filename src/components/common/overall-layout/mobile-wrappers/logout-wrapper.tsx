import { LogOut } from "lucide-react";
import { useWallet } from "@meshsdk/react";
import { useRouter } from "next/router";
import { useUserStore } from "@/lib/zustand/user";

interface LogoutWrapperProps {
  mode: "button" | "menu-item";
  onAction?: () => void;
}

export default function LogoutWrapper({ mode, onAction }: LogoutWrapperProps) {
  const { disconnect } = useWallet();
  const router = useRouter();
  const setPastWallet = useUserStore((state) => state.setPastWallet);

  function handleLogout() {
    disconnect();
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