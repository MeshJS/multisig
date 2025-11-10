import { CircleUser, Copy, Unlink, LogOut, User } from "lucide-react";
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
import useUTXOS from "@/hooks/useUTXOS";

interface UserDropDownWrapperProps {
  mode: "button" | "menu-item";
  onAction?: () => void;
}

export default function UserDropDownWrapper({ 
  mode, 
  onAction 
}: UserDropDownWrapperProps) {
  const { wallet, connected, disconnect } = useWallet();
  const { wallet: utxosWallet, isEnabled: isUtxosEnabled, disable: disableUtxos } = useUTXOS();
  const { toast } = useToast();
  const router = useRouter();
  const setPastWallet = useUserStore((state) => state.setPastWallet);
  const setPastUtxosEnabled = useUserStore((state) => state.setPastUtxosEnabled);
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
    try {
      let address: string | undefined;
      
      // Use userAddress from store if available (works for both wallet types)
      if (userAddress) {
        address = userAddress;
      } else if (connected && wallet) {
        // Fallback to regular wallet if connected
        const usedAddresses = await wallet.getUsedAddresses();
        address = usedAddresses[0];
      } else if (isUtxosEnabled && utxosWallet) {
        // Fallback to UTXOS wallet if enabled
        const addresses = await utxosWallet.cardano.getUsedAddresses();
        address = addresses[0];
      }
      
      if (address) {
        unlinkDiscordMutation.mutate({ address });
        setOpen(false);
      } else {
        toast({
          title: "Error",
          description: "No wallet address available",
          variant: "destructive",
          duration: 3000,
        });
      }
    } catch (error) {
      console.error("Error getting wallet address for Discord unlink:", error);
      if (error instanceof Error && error.message.includes("account changed")) {
        console.log("Account changed during Discord unlink, aborting");
        return;
      }
      // Show error to user
      toast({
        title: "Error",
        description: "Failed to get wallet address",
        variant: "destructive",
        duration: 3000,
      });
    }
  }

  const { data: discordData } = api.user.getUserDiscordId.useQuery({
    address: userAddress ?? "",
  });

  async function handleCopyAddress() {
    try {
      let addressToCopy: string | undefined;
      
      // Use userAddress from store if available (works for both wallet types)
      if (userAddress) {
        addressToCopy = userAddress;
      } else if (connected && wallet) {
        // Fallback to regular wallet if connected
        try {
          const usedAddresses = await wallet.getUsedAddresses();
          addressToCopy = usedAddresses[0];
          if (!addressToCopy) {
            const unusedAddresses = await wallet.getUnusedAddresses();
            addressToCopy = unusedAddresses[0];
          }
        } catch (error) {
          if (error instanceof Error && error.message.includes("account changed")) {
            console.log("Account changed during address copy, aborting");
            return;
          }
          throw error;
        }
      } else if (isUtxosEnabled && utxosWallet) {
        // Fallback to UTXOS wallet if enabled
        try {
          const addresses = await utxosWallet.cardano.getUsedAddresses();
          addressToCopy = addresses[0];
          if (!addressToCopy) {
            const unusedAddresses = await utxosWallet.cardano.getUnusedAddresses();
            addressToCopy = unusedAddresses[0];
          }
        } catch (error) {
          console.error("Error getting UTXOS wallet address:", error);
          throw error;
        }
      }
      
      if (addressToCopy) {
        navigator.clipboard.writeText(addressToCopy);
        toast({
          title: "Copied",
          description: "Address copied to clipboard",
          duration: 5000,
        });
        setOpen(false);
        if (onAction) onAction();
      } else {
        toast({
          title: "Error",
          description: "No wallet address available",
          variant: "destructive",
          duration: 3000,
        });
      }
    } catch (error) {
      console.error("Error copying wallet address:", error);
      toast({
        title: "Error",
        description: "Failed to copy address",
        variant: "destructive",
        duration: 3000,
      });
    }
  }

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
        console.error("[UserDropdown] Error disabling UTXOS wallet:", error);
      }
    }
    
    setPastWallet(undefined);
    router.push("/");
    setTimeout(() => {
      router.reload();
    }, 1000);
    setOpen(false);
    if (onAction) onAction();
  }

  function handleUserProfile() {
    router.push("/user");
    setOpen(false);
    if (onAction) onAction();
  }

  const menuContent = (
    <>
      <DropdownMenuItem onClick={handleUserProfile}>
        <User className="h-4 w-4 mr-2" />
        User Profile
      </DropdownMenuItem>
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
          onClick={handleUserProfile}
        >
          <User className="h-4 w-4" />
          <span>User Profile</span>
        </div>
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