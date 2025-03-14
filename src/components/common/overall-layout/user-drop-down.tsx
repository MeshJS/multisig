import { CircleUser } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  // DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet } from "@meshsdk/react";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/router";
import { useUserStore } from "@/lib/zustand/user";
import { api } from "@/utils/api";

export default function UserDropDown() {
  const { wallet, disconnect } = useWallet();
  const { toast } = useToast();
  const router = useRouter();
  const setPastWallet = useUserStore((state) => state.setPastWallet);
  const userAddress = useUserStore((state) => state.userAddress);

  const unlinkDiscordMutation = api.user.unlinkDiscord.useMutation({
    onSuccess: () => {
      toast({
        title: "Success",
        description: "Discord disconnected",
        variant: "default",
        duration: 5000,
      });
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
  }

  const { data: discordData } = api.user.getUserDiscordId.useQuery({
    address: userAddress ?? "",
  });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="icon" className="rounded-full">
          <CircleUser className="h-5 w-5" />
          <span className="sr-only">Toggle user menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* <DropdownMenuLabel>My Account</DropdownMenuLabel> */}
        {/* <DropdownMenuSeparator /> */}
        <DropdownMenuItem
          onClick={async () => {
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
          }}
        >
          Copy my address
        </DropdownMenuItem>
        {discordData && (
          <DropdownMenuItem onClick={unlinkDiscord}>
            Unlink Discord
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => {
            disconnect();
            setPastWallet(undefined);
            router.push("/");
            setTimeout(() => {
              router.reload();
            }, 1000);
          }}
        >
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
