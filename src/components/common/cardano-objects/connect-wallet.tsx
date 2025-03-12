import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWallet, useWalletList } from "@meshsdk/react";
import { useSiteStore } from "@/lib/zustand/site";
import { useEffect } from "react";
import useUser from "@/hooks/useUser";
import { useUserStore } from "@/lib/zustand/user";
import { getProvider } from "./get-provider";
import { Asset } from "@meshsdk/core";

export default function ConnectWallet() {
  const setNetwork = useSiteStore((state) => state.setNetwork);
  const pastWallet = useUserStore((state) => state.pastWallet);
  const setPastWallet = useUserStore((state) => state.setPastWallet);
  const setUserAssets = useUserStore((state) => state.setUserAssets);
  const setUserAssetMetadata = useUserStore(
    (state) => state.setUserAssetMetadata,
  );
  const { user } = useUser();

  const wallets = useWalletList();
  const { connect, connected, wallet, name } = useWallet();

  async function connectWallet(walletId: string) {
    setPastWallet(walletId);
    await connect(walletId);
  }

  /**
   * Try to connect the wallet when the user loads the application, if user had connected before,
   */
  useEffect(() => {
    async function handleAutoWalletConnect() {
      if (pastWallet && !connected) {
        try {
          await connect(pastWallet);
        } catch (e) {
          setPastWallet(undefined);
        }
      }
    }
    handleAutoWalletConnect();
  }, [pastWallet, connected]);

  useEffect(() => {
    async function lookupWalletAssets() {
      if (!wallet) return;
      try {
        const assets = await wallet.getAssets();
        const provider = getProvider(1);
        if (assets) {
          setUserAssets(assets);
          for (const asset of assets) {
            const assetInfo = await provider.get(`/assets/${asset.unit}`);
            setUserAssetMetadata(
              asset.policyId,
              assetInfo?.metadata?.name ||
                assetInfo?.onchain_metadata?.name ||
                asset.unit,
              assetInfo?.metadata?.decimals || 0,
            );
          }
        }
      } catch (error) {
        console.error("Error looking up wallet assets:", error);
      }
    }
    async function handleNetworkChange() {
      if (connected) {
        setNetwork(await wallet.getNetworkId());
      }
    }
    async function getWalletAssets() {
      if (wallet && connected) {
        await lookupWalletAssets();
      }
    }
    handleNetworkChange();
    getWalletAssets();
  }, [connected, wallet, setNetwork]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="rounded-full">
          <Wallet className="mr-2 h-5 w-5" />
          {!user && connected && "Connecting..."}
          {!user && !connected && "Connect"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Select Wallet</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {wallets.map((wallet, i) => {
          return (
            <DropdownMenuItem key={i} onClick={() => connectWallet(wallet.id)}>
              {wallet.name}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
