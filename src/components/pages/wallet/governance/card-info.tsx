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
import { MoreVertical, Info, ExternalLink, Copy, X, UserCheck, CheckCircle, Hash, Activity, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useToast } from "@/hooks/use-toast";
import { useProxy } from "@/hooks/useProxy";
import { useSiteStore } from "@/lib/zustand/site";
import { UTxO } from "@meshsdk/core";
import { useProxyData } from "@/lib/zustand/proxy";
import { useState, useEffect } from "react";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function CardInfo({ appWallet, manualUtxos }: { appWallet: Wallet; manualUtxos: UTxO[] }) {
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const { multisigWallet } = useMultisigWallet();
  const { toast } = useToast();
  const { isProxyEnabled, selectedProxyId, setSelectedProxy, clearSelectedProxy } = useProxy();
  const network = useSiteStore((state) => state.network);
  const { proxies } = useProxyData(appWallet?.id);
  
  // Proxy DRep state
  const [proxyDrepInfo, setProxyDrepInfo] = useState<any>(null);
  const [proxyDrepId, setProxyDrepId] = useState<string | null>(null);
  const [loadingProxyDrep, setLoadingProxyDrep] = useState(false);
  const [proxyDrepError, setProxyDrepError] = useState<string | null>(null);
  const [proxyDelegatorsInfo, setProxyDelegatorsInfo] = useState<{
    delegators: Array<{ address: string; amount: string }>;
    totalDelegation: string;
    totalDelegationADA: number;
    count: number;
  } | null>(null);
  
  // Get DRep info for standard mode
  const currentDrepId = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getDRepId() : appWallet?.dRepId;
  const currentDrepInfo = drepInfo;
  
  
  
  // Fetch proxy DRep info when proxy is enabled and selected
  useEffect(() => {
    const fetchProxyDrepInfo = async () => {
      
      
      // Only fetch proxy DRep info if proxy is enabled, has a selected proxy, proxies exist, and the selected proxy is found
      const hasValidProxy = isProxyEnabled && selectedProxyId && proxies.length > 0;
      const selectedProxy = hasValidProxy ? proxies.find(p => p.id === selectedProxyId) : null;
      
      if (hasValidProxy && selectedProxy && appWallet?.scriptCbor) {
        setLoadingProxyDrep(true);
        setProxyDrepError(null);
        
        // Set a timeout to prevent infinite loading
        const timeoutId = setTimeout(() => {
          setLoadingProxyDrep(false);
          setProxyDrepError("Timeout: Could not fetch proxy DRep information");
        }, 10000); // 10 second timeout
        
        try {
          const txBuilder = getTxBuilder(network);
          const proxyContract = new MeshProxyContract(
            {
              mesh: txBuilder,
              wallet: undefined,
              networkId: network,
            },
            {
              paramUtxo: JSON.parse(selectedProxy.paramUtxo || '{}'),
            },
            appWallet.scriptCbor,
          );
          proxyContract.proxyAddress = selectedProxy.proxyAddress;
          
          // Get DRep ID
          const drepId = proxyContract.getDrepId();
          
          setProxyDrepId(drepId);
          
          // Get DRep status (now with caching and proper error handling)
          const status = await proxyContract.getDrepStatus(true);
          setProxyDrepInfo(status);

          // Get DRep delegators (force refresh on manual view)
          try {
            const delegators = await proxyContract.getDrepDelegators(true);
            setProxyDelegatorsInfo(delegators as {
              delegators: Array<{ address: string; amount: string }>;
              totalDelegation: string;
              totalDelegationADA: number;
              count: number;
            });
          } catch {
            // ignore, leave as null
            setProxyDelegatorsInfo(null);
          }
          
          clearTimeout(timeoutId);
        } catch (error) {
          // Only log unexpected errors, not 404s which are handled in offchain
          console.error("Unexpected error in fetchProxyDrepInfo:", error);
          setProxyDrepError("Failed to fetch proxy DRep information");
          clearTimeout(timeoutId);
        } finally {
          setLoadingProxyDrep(false);
        }
      } else {
        // Clear proxy state when no valid proxy is available - fall back to old logic
        setProxyDrepId(null);
        setProxyDrepInfo(null);
        setProxyDrepError(null);
        setProxyDelegatorsInfo(null);
      }
    };
    
    fetchProxyDrepInfo();
  }, [isProxyEnabled, selectedProxyId, appWallet?.scriptCbor, network, proxies]);
  
  // Use proxy DRep info only if proxy is enabled AND we have valid proxy data, otherwise use standard DRep info
  const hasValidProxyData = !!(isProxyEnabled && proxyDrepId && proxies.length > 0 && proxies.find(p => p.id === selectedProxyId));
  const displayDrepId = hasValidProxyData ? proxyDrepId : currentDrepId;
  const displayDrepInfo = hasValidProxyData ? proxyDrepInfo : currentDrepInfo;
  
  
  
  // Show loading or error state if no DRep ID
  if (!displayDrepId) {
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
                {hasValidProxyData ? "Proxy DRep Information" : "DRep Information"}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Note: governance features are currently in alpha as Blockfrost and CIPs standards are work in progress.
              </p>
            </div>
          </div>
        </div>

        {/* Loading or Error State */}
        <div className="p-4 rounded-lg border bg-gray-50 dark:bg-gray-800/50">
          {loadingProxyDrep ? (
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin"></div>
              <p className="text-gray-600 dark:text-gray-400">
                Loading proxy DRep information...
              </p>
            </div>
          ) : proxyDrepError ? (
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-red-500"></div>
              <div>
                <p className="text-red-600 dark:text-red-400 font-medium">Error loading proxy DRep</p>
                <p className="text-sm text-red-500 dark:text-red-400">{proxyDrepError}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-gray-400"></div>
              <p className="text-gray-600 dark:text-gray-400">
                {hasValidProxyData ? "No proxy DRep information available" : "No DRep information available"}
              </p>
            </div>
          )}
        </div>
      </div>
    );
  }
  
  // Check if DRep is actually registered (has info from Blockfrost)
  const isDRepRegistered = displayDrepInfo?.active === true;
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
              {hasValidProxyData ? "Proxy DRep Information" : "DRep Information"}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Note: governance features are currently in alpha as Blockfrost and CIPs standards are work in progress.
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
                href={`https://gov.tools/drep_directory/${displayDrepId}`}
                className="flex items-center gap-2"
              >
                <ExternalLink className="h-4 w-4" />
                gov.tools
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Minimal DRep & Proxy Management Card */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Info className="h-5 w-5 text-gray-600 dark:text-gray-400" />
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                  {hasValidProxyData ? "Proxy DRep Management" : "DRep Information"}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {hasValidProxyData ? "Using proxy for governance operations" : "Standard DRep governance mode"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Global Proxy Toggle - Only show when proxies exist */}
              {proxies && proxies.length > 0 && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Proxy Mode:</span>
                    <button
                      onClick={() => {
                        if (isProxyEnabled) {
                          clearSelectedProxy();
                          toast({
                            title: "Proxy Mode Disabled",
                            description: "Proxy mode has been turned off.",
                          });
                        } else {
                          toast({
                            title: "Proxy Mode Enabled",
                            description: "Select a proxy to use for governance operations.",
                          });
                        }
                      }}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        isProxyEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          isProxyEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  
                  <div className="flex items-center gap-2">
                    <Select value={selectedProxyId || undefined} onValueChange={(value) => {
                      setSelectedProxy(value);
                      toast({
                        title: "Proxy Selected",
                        description: "Proxy mode enabled for governance operations.",
                      });
                    }}>
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder="Select a proxy..." />
                      </SelectTrigger>
                      <SelectContent>
                        {proxies.map((proxy) => (
                          <SelectItem key={proxy.id} value={proxy.id}>
                            <div className="flex flex-col">
                              <span className="font-medium">{proxy.description || `Proxy ${proxy.id.slice(-8)}`}</span>
                              <span className="text-xs text-gray-500">{proxy.proxyAddress.slice(0, 20)}...</span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedProxyId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          clearSelectedProxy();
                          toast({
                            title: "Proxy Unselected",
                            description: "Proxy mode has been disabled. Using standard DRep mode.",
                          });
                        }}
                        className="text-gray-600 hover:text-gray-700"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">


          {/* DRep Information - Single Row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* DRep ID */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">DRep ID</span>
              </div>
              <div className="space-y-2">
                <div className="bg-gray-50 dark:bg-gray-800 rounded p-2">
                  <code className="text-xs font-mono text-gray-800 dark:text-gray-200 break-all block">
                    {loadingProxyDrep ? "..." : displayDrepId}
                  </code>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (displayDrepId) {
                      navigator.clipboard.writeText(displayDrepId);
                      toast({
                        title: "Copied!",
                        description: "DRep ID copied to clipboard",
                      });
                    }
                  }}
                  disabled={!displayDrepId}
                  className="w-full text-xs"
                >
                  <Copy className="h-3 w-3 mr-1" />
                  Copy ID
                </Button>
              </div>
            </div>

            {/* DRep Status */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</span>
              </div>
              <div className="flex items-center gap-2">
                {loadingProxyDrep ? (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin"></div>
                    <span className="text-sm text-gray-500">Loading...</span>
                  </div>
                ) : (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="w-3 h-3 rounded-full cursor-help" 
                             style={{ 
                               backgroundColor: displayDrepInfo?.active ? '#10b981' : '#6b7280' 
                             }}></div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{displayDrepInfo?.active ? 'Active' : 'Inactive'}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {loadingProxyDrep ? "Loading..." : (displayDrepInfo?.active ? "Active" : "Inactive")}
                </span>
              </div>
            </div>

            {/* Voting Power */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Voting Power</span>
              </div>
              <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                {proxyDelegatorsInfo?.totalDelegationADA !== undefined
                  ? proxyDelegatorsInfo.totalDelegationADA.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
                  : displayDrepInfo?.deposit
                  ? (parseInt(displayDrepInfo.deposit) / 1000000).toFixed(2)
                  : displayDrepInfo?.amount
                  ? (parseInt(displayDrepInfo.amount) / 1000000).toFixed(2)
                  : "0.00"} ADA
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">
                {loadingProxyDrep
                  ? "Loading..."
                  : proxyDelegatorsInfo
                  ? `${proxyDelegatorsInfo.count} delegator${proxyDelegatorsInfo.count !== 1 ? 's' : ''}`
                  : "Deposit amount"}
              </div>
            </div>
          </div>
        </div>
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
