import { Wallet } from "@/types/wallet";
import { useWalletsStore } from "@/lib/zustand/wallets";
import Retire from "./drep/retire";
import Link from "next/link";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Info, ExternalLink, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useToast } from "@/hooks/use-toast";
import { useProxy } from "@/hooks/useProxy";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { useSiteStore } from "@/lib/zustand/site";
import { api } from "@/utils/api";
import { useState, useEffect } from "react";
import { UTxO } from "@meshsdk/core";

export default function CardInfo({ appWallet, manualUtxos }: { appWallet: Wallet; manualUtxos: UTxO[] }) {
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const { multisigWallet } = useMultisigWallet();
  const { toast } = useToast();
  const { isProxyEnabled, selectedProxyId } = useProxy();
  const network = useSiteStore((state) => state.network);
  
  // Proxy DRep state
  const [proxyDrepInfo, setProxyDrepInfo] = useState<any>(null);
  const [proxyDrepId, setProxyDrepId] = useState<string | null>(null);
  const [loadingProxyDrep, setLoadingProxyDrep] = useState(false);

  // Get proxies for the current wallet
  const { data: proxies } = api.proxy.getProxiesByUserOrWallet.useQuery(
    { 
      walletId: appWallet?.id || undefined,
    },
    { enabled: !!(appWallet?.id && isProxyEnabled) }
  );
  
  // Fetch proxy DRep information when proxy mode is enabled
  useEffect(() => {
    const fetchProxyDrepInfo = async () => {
      if (!isProxyEnabled || !selectedProxyId || !proxies || !appWallet) {
        setProxyDrepInfo(null);
        setProxyDrepId(null);
        return;
      }

      try {
        setLoadingProxyDrep(true);
        
        // Get the selected proxy
        const proxy = proxies.find((p: any) => p.id === selectedProxyId);
        if (!proxy) {
          setProxyDrepInfo(null);
          setProxyDrepId(null);
          return;
        }

        // Create proxy contract instance
        const txBuilder = getTxBuilder(network);
        const proxyContract = new MeshProxyContract(
          {
            mesh: txBuilder,
            wallet: undefined, // We don't need wallet for getting DRep info
            networkId: network,
          },
          {
            paramUtxo: JSON.parse(proxy.paramUtxo),
          },
          appWallet.scriptCbor,
        );
        proxyContract.proxyAddress = proxy.proxyAddress;

        // Get DRep ID and status
        const drepId = proxyContract.getDrepId();
        setProxyDrepId(drepId);
        
        try {
          const drepStatus = await proxyContract.getDrepStatus();
          setProxyDrepInfo(drepStatus);
        } catch (error) {
          console.log("DRep not registered yet or error fetching status:", error);
          setProxyDrepInfo(null);
        }
      } catch (error) {
        console.error("Error fetching proxy DRep info:", error);
        setProxyDrepInfo(null);
        setProxyDrepId(null);
      } finally {
        setLoadingProxyDrep(false);
      }
    };

    fetchProxyDrepInfo();
  }, [isProxyEnabled, selectedProxyId, proxies, appWallet, network]);

  // Determine which DRep info to use
  const currentDrepId = isProxyEnabled && proxyDrepId ? proxyDrepId : 
    (multisigWallet?.getKeysByRole(3) ? multisigWallet?.getDRepId() : appWallet?.dRepId);
  
  const currentDrepInfo = isProxyEnabled ? proxyDrepInfo : drepInfo;
  
  if (!currentDrepId) {
    throw new Error("DRep not found");
  }
  
  // Check if DRep is actually registered (has info from Blockfrost)
  const isDRepRegistered = currentDrepInfo?.active === true;
  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
            <Info className="h-5 w-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              DRep Information
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {isProxyEnabled ? "Proxy DRep Management - Note: governance features are currently in alpha" : "Note: governance features are currently in alpha as Blockfrost and CIPs standards are work in progress."}
            </p>
          </div>
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger
            className="p-2 rounded-md hover:bg-zinc-100 focus:bg-zinc-100 dark:hover:bg-zinc-800 dark:focus:bg-zinc-800"
            aria-haspopup="true"
          >
            <MoreVertical className="h-4 w-4" />
            <span className="sr-only">Toggle menu</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link
                href={`https://gov.tools/drep_directory/${currentDrepId}`}
                className="flex items-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                gov.tools
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Proxy Mode Indicator */}
      {isProxyEnabled && (
        <div className="mb-4 p-3 rounded-lg border bg-blue-50/50 dark:bg-blue-950/20">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">
              Proxy Mode Active
            </span>
            <span className="text-xs text-blue-600 dark:text-blue-400">
              Using proxy DRep for governance operations
            </span>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {/* DRep ID */}
        <div className="space-y-2 md:col-span-2 lg:col-span-3">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {isProxyEnabled ? "Proxy DRep ID" : "DRep ID"}
          </label>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border">
            <div className="flex items-center gap-2">
              {loadingProxyDrep ? (
                <span className="text-sm text-gray-500">Loading proxy DRep ID...</span>
              ) : (
                <span className="text-sm font-mono text-gray-900 dark:text-gray-100 break-all">
                  {currentDrepId}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(currentDrepId);
                  toast({
                    title: "Copied",
                    description: `${isProxyEnabled ? "Proxy " : ""}DRep ID copied to clipboard`,
                    duration: 2000,
                  });
                }}
                className="h-6 w-6 p-0 flex-shrink-0"
                disabled={loadingProxyDrep}
              >
                <Copy className="h-3 w-3" />
              </Button>
            </div>
          </div>
        </div>

        {/* Status */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
            Status
          </label>
          <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${
                isDRepRegistered 
                  ? 'bg-green-500' 
                  : 'bg-yellow-500'
              }`} />
              <span className="text-sm font-medium">
                {isDRepRegistered ? "Registered" : "Not registered"}
              </span>
            </div>
          </div>
        </div>

        {/* Voting Power */}
        {isDRepRegistered && currentDrepInfo && (
          <div className="space-y-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Voting Power
            </label>
            <div className="p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border">
              <span className="text-lg font-semibold text-green-600 dark:text-green-400">
                {Math.round(Number(currentDrepInfo.amount) / 1000000)
                  .toString()
                  .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₳
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-6 flex flex-wrap gap-3">
        <Button 
          className="flex-1 sm:flex-initial" 
          disabled={isDRepRegistered}
          variant={isDRepRegistered ? "outline" : "default"}
        >
          <Link href={`/wallets/${appWallet.id}/governance/register`}>
            Register DRep
          </Link>
        </Button>
        <Button 
          className="flex-1 sm:flex-initial" 
          disabled={!isDRepRegistered}
          variant={!isDRepRegistered ? "outline" : "default"}
        >
          <Link href={`/wallets/${appWallet.id}/governance/update`}>
            Update DRep
          </Link>
        </Button>
        <Retire appWallet={appWallet} manualUtxos={manualUtxos} />
        <Link href={`/wallets/${appWallet.id}/governance/drep`}>
          <Button className="flex-1 sm:flex-initial" variant="outline">
            Find a DRep
          </Button>
        </Link>
      </div>
    </div>
  );
}
