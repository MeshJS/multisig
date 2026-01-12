import { Wallet } from "@/types/wallet";
import { useWalletsStore } from "@/lib/zustand/wallets";
import Retire from "./drep/retire";
import Link from "next/link";
import RegisterDrepModal from "./drep/RegisterDrepModal";
import UpdateDrepModal from "./drep/UpdateDrepModal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreVertical, Info, ExternalLink, Copy, X, UserCheck, CheckCircle, Hash, Activity, TrendingUp, ChevronDown, ChevronUp, UserPlus, Edit, Search } from "lucide-react";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import CardUI from "@/components/ui/card-content";

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
  // Use multisig wallet DRep ID if available (it handles no DRep keys by using payment script),
  // otherwise fallback to appWallet (for legacy wallets without multisigWallet)
  const currentDrepId = multisigWallet ? multisigWallet.getDRepId() : appWallet?.dRepId;
  const currentDrepInfo = drepInfo;
  
  
  
  // Fetch proxy DRep info when proxy is enabled and selected
  useEffect(() => {
    const fetchProxyDrepInfo = async () => {
      // Only fetch proxy DRep info if proxy is enabled, has a selected proxy, proxies exist, and the selected proxy is found
      const hasValidProxy = isProxyEnabled && selectedProxyId && proxies.length > 0;
      const selectedProxy = hasValidProxy ? proxies.find(p => p.id === selectedProxyId) : null;
      
      if (!hasValidProxy || !selectedProxy || !appWallet?.scriptCbor) {
        // Clear proxy state when no valid proxy is available - fall back to old logic
        setProxyDrepId(null);
        setProxyDrepInfo(null);
        setProxyDrepError(null);
        setProxyDelegatorsInfo(null);
        return;
      }

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

        // Get DRep delegators only if DRep is registered (force refresh on manual view)
        // getDrepDelegators now checks registration status internally, but we can skip if status is null
        if (status && status !== null) {
          try {
            const delegators = await proxyContract.getDrepDelegators(true);
            setProxyDelegatorsInfo(delegators as {
              delegators: Array<{ address: string; amount: string }>;
              totalDelegation: string;
              totalDelegationADA: number;
              count: number;
            });
          } catch {
            // If delegators fetch fails, set empty result
            setProxyDelegatorsInfo({
              delegators: [],
              totalDelegation: "0",
              totalDelegationADA: 0,
              count: 0
            });
          }
        } else {
          // DRep not registered, set empty delegators info
          setProxyDelegatorsInfo({
            delegators: [],
            totalDelegation: "0",
            totalDelegationADA: 0,
            count: 0
          });
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
      <CardUI
        title={hasValidProxyData ? "Proxy DRep Information" : "DRep Information"}
        description="Note: governance features are currently in alpha as Blockfrost and CIPs standards are work in progress."
        headerDom={
          <DropdownMenu>
            <DropdownMenuTrigger
              className="p-2 rounded-md hover:bg-gray-100 focus:bg-gray-100 dark:hover:bg-gray-800 dark:focus:bg-gray-800 flex-shrink-0 transition-colors"
              aria-haspopup="true"
            >
              <MoreVertical className="h-4 w-4" />
              <span className="sr-only">Toggle menu</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link
                  href={`https://gov.tools/drep_directory/${displayDrepId || ''}`}
                  className="flex items-center gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  gov.tools
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0A0A0B]">
          {loadingProxyDrep ? (
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-gray-300 dark:border-gray-500 border-t-gray-600 dark:border-t-gray-300 rounded-full animate-spin"></div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Loading proxy DRep information...
              </p>
            </div>
          ) : proxyDrepError ? (
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-red-500 dark:bg-red-400"></div>
              <div>
                <p className="text-sm font-medium text-red-600 dark:text-red-400">Error loading proxy DRep</p>
                <p className="text-xs text-red-500 dark:text-red-400">{proxyDrepError}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full bg-gray-400 dark:bg-gray-500"></div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {hasValidProxyData ? "No proxy DRep information available" : "No DRep information available"}
              </p>
            </div>
          )}
        </div>
      </CardUI>
    );
  }
  
  // Check if DRep is actually registered (has info from Blockfrost)
  const isDRepRegistered = displayDrepInfo?.active === true;
  const [isDRepManagementOpen, setIsDRepManagementOpen] = useState(false);
  const [showProxySelector, setShowProxySelector] = useState(!!selectedProxyId);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);
  
  // Sync showProxySelector when a proxy is selected
  useEffect(() => {
    if (selectedProxyId) {
      setShowProxySelector(true);
    }
  }, [selectedProxyId]);
  
  return (
    <CardUI
      title={hasValidProxyData ? "Proxy DRep Information" : "DRep Information"}
      description="Note: governance features are currently in alpha as Blockfrost and CIPs standards are work in progress."
      headerDom={
        <DropdownMenu>
          <DropdownMenuTrigger
            className="p-2 rounded-md hover:bg-gray-100 focus:bg-gray-100 dark:hover:bg-gray-800 dark:focus:bg-gray-800 flex-shrink-0 transition-colors"
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
      }
    >
      <div className="flex flex-col gap-4">
        {/* Proxy Control Section - Only show when proxies exist */}
        {proxies && proxies.length > 0 && (
          <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0A0A0B]">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3">
                {/* Toggle Row */}
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300">Proxy Mode</span>
                    {isProxyEnabled && selectedProxyId && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#0A0A0B]/50 text-gray-700 dark:text-gray-300">
                        Active
                      </span>
                    )}
                  </div>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (isProxyEnabled && selectedProxyId) {
                        // Turn OFF: clear selection and hide selector
                        clearSelectedProxy();
                        setShowProxySelector(false);
                        toast({
                          title: "Proxy Mode Disabled",
                          description: "Switched to standard DRep mode.",
                        });
                      } else {
                        // Turn ON: show selector so user can choose a proxy
                        setShowProxySelector(true);
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 ${
                      isProxyEnabled && selectedProxyId ? 'bg-gray-600 dark:bg-gray-500' : 'bg-gray-200 dark:bg-gray-800'
                    }`}
                    type="button"
                    aria-label={isProxyEnabled && selectedProxyId ? "Disable proxy mode" : "Enable proxy mode"}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                        isProxyEnabled && selectedProxyId ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                
                {/* Proxy Selector - Show when toggle is ON or when a proxy is selected */}
                {(showProxySelector || isProxyEnabled || selectedProxyId) && (
                  <div className="flex items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <Select 
                      value={selectedProxyId || undefined} 
                      onValueChange={(value) => {
                        setSelectedProxy(value);
                        setShowProxySelector(true);
                        toast({
                          title: "Proxy Selected",
                          description: "Proxy mode is now active for governance operations.",
                        });
                      }}
                    >
                      <SelectTrigger className="w-full text-xs sm:text-sm h-9">
                        <SelectValue placeholder="Choose a proxy contract..." />
                      </SelectTrigger>
                      <SelectContent>
                        {proxies.map((proxy) => (
                          <SelectItem key={proxy.id} value={proxy.id}>
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium text-xs sm:text-sm">
                                {proxy.description || `Proxy ${proxy.id.slice(-8)}`}
                              </span>
                              <span className="text-xs text-gray-500 font-mono">
                                {proxy.proxyAddress.slice(0, 24)}...
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {selectedProxyId && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          clearSelectedProxy();
                          setShowProxySelector(false);
                          toast({
                            title: "Proxy Cleared",
                            description: "Switched to standard DRep mode.",
                          });
                        }}
                        className="h-9 w-9 p-0 flex-shrink-0 hover:bg-red-50 dark:hover:bg-red-900/20"
                        type="button"
                        aria-label="Clear proxy selection"
                      >
                        <X className="h-4 w-4 text-gray-500 hover:text-red-600 dark:hover:text-red-400" />
                      </Button>
                    )}
                  </div>
                )}
                
                {/* Helper Text */}
                {!showProxySelector && !isProxyEnabled && !selectedProxyId && (
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Enable proxy mode to use a proxy contract for governance operations.
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* DRep Information Content */}
        <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0A0A0B]">
          <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {/* DRep ID */}
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">DRep ID</span>
              </div>
              <div className="space-y-2">
                <div className="bg-gray-50 dark:bg-gray-800 rounded-md p-2 border border-gray-200 dark:border-gray-800">
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
                <Activity className="h-4 w-4 text-gray-500 dark:text-gray-400" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Status</span>
              </div>
              <div className="flex items-center gap-2">
                {loadingProxyDrep ? (
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 border-2 border-gray-300 dark:border-gray-500 border-t-gray-600 dark:border-t-gray-300 rounded-full animate-spin"></div>
                    <span className="text-sm text-gray-500 dark:text-gray-400">Loading...</span>
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
                <TrendingUp className="h-4 w-4 text-gray-500 dark:text-gray-400" />
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

        {/* Collapsible DRep Management Section */}
        <Collapsible open={isDRepManagementOpen} onOpenChange={setIsDRepManagementOpen}>
          <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-[#0A0A0B]">
            <CollapsibleTrigger className="w-full">
              <div className="flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors cursor-pointer -m-4 p-4 rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-gray-100 dark:bg-[#0A0A0B]/50">
                    <Activity className="h-4 w-4 sm:h-5 sm:w-5 text-gray-600 dark:text-gray-400" />
                  </div>
                  <h3 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
                    DRep Management
                  </h3>
                </div>
                {isDRepManagementOpen ? (
                  <ChevronUp className="h-4 w-4 sm:h-5 sm:w-5 text-gray-500 dark:text-gray-400" />
                ) : (
                  <ChevronDown className="h-4 w-4 sm:h-5 sm:w-5 text-gray-500 dark:text-gray-400" />
                )}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="pt-4 mt-4 border-t border-gray-200 dark:border-gray-800">
                <div className="space-y-3">
                  {/* Primary Actions - Registration & Update */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Button 
                      className="w-full justify-start gap-3 h-auto py-3.5 px-4 text-sm sm:text-base font-medium" 
                      disabled={isDRepRegistered}
                      variant={isDRepRegistered ? "outline" : "default"}
                      onClick={() => setRegisterModalOpen(true)}
                    >
                      <UserPlus className="h-5 w-5 flex-shrink-0" />
                      <span className="flex-1 text-left">Register DRep</span>
                    </Button>
                    <Button 
                      className="w-full justify-start gap-3 h-auto py-3.5 px-4 text-sm sm:text-base font-medium" 
                      disabled={!isDRepRegistered}
                      variant={!isDRepRegistered ? "outline" : "default"}
                      onClick={() => setUpdateModalOpen(true)}
                    >
                      <Edit className="h-5 w-5 flex-shrink-0" />
                      <span className="flex-1 text-left">Update DRep</span>
                    </Button>
                  </div>
                  
                  {/* Secondary Actions - Retire & Find */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="w-full">
                      <Retire appWallet={appWallet} manualUtxos={manualUtxos} />
                    </div>
                    <Link href={`/wallets/${appWallet.id}/governance/drep`} className="w-full">
                      <Button className="w-full justify-start gap-3 h-auto py-3.5 px-4 text-sm sm:text-base font-medium" variant="outline">
                        <Search className="h-5 w-5 flex-shrink-0" />
                        Find a DRep
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </CollapsibleContent>
          </div>
        </Collapsible>
      </div>
      
      {/* Register DRep Modal */}
      <RegisterDrepModal
        open={registerModalOpen}
        onOpenChange={setRegisterModalOpen}
      />
      
      {/* Update DRep Modal */}
      <UpdateDrepModal
        open={updateModalOpen}
        onOpenChange={setUpdateModalOpen}
      />
    </CardUI>
  );
}

