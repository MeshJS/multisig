import { CircleUser, Copy, Unlink, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet } from "@meshsdk/react";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/router";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";
import { useState } from "react";

interface UserDropDownWrapperProps {
  mode: "button" | "menu-item";
  onAction?: () => void;
}

export default function UserDropDownWrapper({ 
  mode, 
  onAction 
}: UserDropDownWrapperProps) {
  const { wallet, disconnect } = useWallet();
  const { toast } = useToast();
  const router = useRouter();
  const setPastWallet = useUserStore((state) => state.setPastWallet);
  const userAddress = useUserStore((state) => state.userAddress);
  const [open, setOpen] = useState(false);

  const unlinkDiscordMutation = api.user.unlinkDiscord.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Discord disconnected",
        variant: "default",
        duration: 5000,
      });
      if (onAction) onAction();
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: "Failed to unlink Discord account",
        variant: "destructive",
        duration: 5000,
      });
    },
  });

  async function unlinkDiscord(): Promise<void> {
    const address = (await wallet.getUsedAddresses())[0];
    unlinkDiscordMutation.mutate({ address: address ?? "" });
    setOpen(false);
  }

  const { data: discordData } = api.user.getUserDiscordId.useQuery({
    address: userAddress ?? "",
  });

  async function handleCopyAddress() {
    let userAddress = (await wallet.getUsedAddresses())[0];
    if (userAddress === undefined) {
      userAddress = (await wallet.getUnusedAddresses())[0];
    }
    navigator.clipboard.writeText(userAddress!);
    toast({
      title: "Copied",
      description: "Address copied to clipboard",
      duration: 5000,
    });
    setOpen(false);
    if (onAction) onAction();
  }

  function handleLogout() {
    disconnect();
    setPastWallet(undefined);
    router.push("/");
    setTimeout(() => {
      router.reload();
    }, 1000);
    setOpen(false);
    if (onAction) onAction();
  }

  const menuContent = (
    <>
      <DropdownMenuItem onClick={handleCopyAddress}>
        <Copy className="h-4 w-4 mr-2" />
        Copy my address
      </DropdownMenuItem>
      {discordData && (
        <DropdownMenuItem onClick={unlinkDiscord}>
          <Unlink className="h-4 w-4 mr-2" />
          Unlink Discord
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={handleLogout}>
        <LogOut className="h-4 w-4 mr-2" />
        Logout
      </DropdownMenuItem>
    </>
  );

  if (mode === "button") {
    return (
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="secondary" size="icon" className="rounded-full">
            <CircleUser className="h-5 w-5" />
            <span className="sr-only">Toggle user menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {menuContent}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Menu item mode - render each item separately
  if (mode === "menu-item") {
    return (
      <>
        <div 
          className="flex items-center gap-2 cursor-pointer"
          onClick={handleCopyAddress}
        >
          <Copy className="h-4 w-4" />
          <span>Copy my address</span>
        </div>
        {discordData && (
          <div 
            className="flex items-center gap-2 cursor-pointer"
            onClick={unlinkDiscord}
          >
            <Unlink className="h-4 w-4" />
            <span>Unlink Discord</span>
          </div>
        )}
      </>
    );
  }
}