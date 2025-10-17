import React, { useState, useEffect, useCallback } from "react";
import { useWallet } from "@meshsdk/react";
import { MeshProxyContract } from "./offchain";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { toast } from "@/hooks/use-toast";
import { getTxBuilder } from "@/utils/get-tx-builder";
import useAppWallet from "@/hooks/useAppWallet";
import { api } from "@/utils/api";
import useTransaction from "@/hooks/useTransaction";
import ProxyOverview from "./ProxyOverview";
import ProxySetup from "./ProxySetup";
import ProxySpend from "./ProxySpend";
import UTxOSelector from "@/components/pages/wallet/new-transaction/utxoSelector";
import { getProvider } from "@/utils/get-provider";
import { MeshTxBuilder, UTxO } from "@meshsdk/core";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertCircle, ChevronDown, ChevronUp, Wallet, TrendingUp, Info } from "lucide-react";

interface ProxyOutput {
  address: string;
  unit: string;
  amount: string;
}

interface ProxySetupResult {
  tx: MeshTxBuilder;
  paramUtxo: { txHash: string; outputIndex: number };
  authTokenId: string;
  proxyAddress: string;
}

export default function ProxyControl() {
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const setLoading = useSiteStore((state) => state.setLoading);
  const network = useSiteStore((state) => state.network);
  const { appWallet } = useAppWallet();
  const ctx = api.useUtils();
  const { newTransaction } = useTransaction();



  const { mutateAsync: createProxy } = api.proxy.createProxy.useMutation({
    onSuccess: () => {
      void ctx.proxy.getProxiesByUserOrWallet.invalidate();
    },
  });

  const { mutateAsync: updateProxy } = api.proxy.updateProxy.useMutation({
    onSuccess: () => {
      void ctx.proxy.getProxiesByUserOrWallet.invalidate();
    },
  });

  // Get user by address for user-linked proxies
  const { data: user } = api.proxy.getUserByAddress.useQuery(
    { address: userAddress || "" },
    { enabled: !!userAddress && !appWallet?.id }
  );

  const { data: proxies, refetch: refetchProxies, isLoading: proxiesLoading, error: proxiesError } = api.proxy.getProxiesByUserOrWallet.useQuery(
    { 
      walletId: appWallet?.id || undefined,
      userAddress: userAddress || undefined,
    },
    { enabled: !!(appWallet?.id || userAddress) }
  );

  // Debug logging for proxy loading
  useEffect(() => {
    console.log("Proxy loading debug:", {
      appWalletId: appWallet?.id,
      userAddress,
      enabled: !!(appWallet?.id || userAddress),
      proxiesLoading,
      proxiesError,
      proxiesCount: proxies?.length || 0,
      proxies: proxies
    });
  }, [appWallet?.id, userAddress, proxiesLoading, proxiesError, proxies]);

  // State management
  const [proxyContract, setProxyContract] = useState<MeshProxyContract | null>(null);
  const [proxyBalance, setProxyBalance] = useState<Array<{ unit: string; quantity: string }>>([]);
  const [isProxySetup, setIsProxySetup] = useState<boolean>(false);
  const [loading, setLocalLoading] = useState<boolean>(false);
  const [selectedProxy, setSelectedProxy] = useState<string>("");
  const [selectedProxyBalance, setSelectedProxyBalance] = useState<Array<{ unit: string; quantity: string }>>([]);
  const [allProxyBalances, setAllProxyBalances] = useState<Record<string, Array<{ unit: string; quantity: string }>>>({});
  const [tvlLoading, setTvlLoading] = useState<boolean>(false);

  // Setup flow state
  const [setupStep, setSetupStep] = useState<number>(0);
  const [setupData, setSetupData] = useState<{
    paramUtxo?: { txHash: string; outputIndex: number };
    authTokenId?: string;
    proxyAddress?: string;
    txHex?: MeshTxBuilder;
    description?: string;
  }>({});

  // Tab management

  // Form states
  const [setupLoading, setSetupLoading] = useState<boolean>(false);
  const [spendLoading, setSpendLoading] = useState<boolean>(false);
  const [showSetupModal, setShowSetupModal] = useState<boolean>(false);
  const [showSpendSection, setShowSpendSection] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  
  // Spend form
  const [spendOutputs, setSpendOutputs] = useState<ProxyOutput[]>([
    { address: "", unit: "lovelace", amount: "" }
  ]);

  // UTxO selection state (UI only). We will still pass all UTxOs from provider to contract.
  const [selectedUtxos, setSelectedUtxos] = useState<UTxO[]>([]);
  const [manualSelected, setManualSelected] = useState<boolean>(false);

  // Helper to resolve inputs for multisig controlled txs
  const getMsInputs = useCallback(async (): Promise<{ utxos: UTxO[]; walletAddress: string }> => {
    if (!appWallet?.address) {
      throw new Error("Multisig wallet address not available");
    }
    const provider = getProvider(network);
    const utxos = await provider.fetchAddressUTxOs(appWallet.address);
    if (!utxos || utxos.length === 0) {
      throw new Error("No UTxOs found at multisig wallet address");
    }
    console.log("utxos", utxos);
    console.log("walletAddress", appWallet.address);
    return { utxos, walletAddress: appWallet.address };
  }, [appWallet?.address, network]);

  // Initialize proxy contract
  useEffect(() => {
    if (connected && wallet && userAddress) {
      try {
        const txBuilder = getTxBuilder(network);
        const contract = new MeshProxyContract(
          {
            mesh: txBuilder,
            wallet: wallet,
            networkId: network,
          },
          {},
          appWallet?.scriptCbor || undefined,
        );
        setProxyContract(contract);
      } catch (error) {
        console.error("Failed to initialize proxy contract:", error);
        toast({
          title: "Error",
          description: "Failed to initialize proxy contract",
          variant: "destructive",
        });
      }
    }
  }, [connected, wallet, userAddress, network]);

  // Check if proxy is already set up
  const checkProxySetup = useCallback(async () => {
    if (!proxyContract) return;

    try {
      const balance = await proxyContract.getProxyBalance();
      setProxyBalance(balance);
      setIsProxySetup(balance.length > 0);
    } catch (error) {
      // Proxy not set up yet
      setIsProxySetup(false);
      setProxyBalance([]);
    }
  }, [proxyContract]);

  // Load initial state
  useEffect(() => {
    checkProxySetup();
  }, [checkProxySetup]);

  // Step 1: Initialize proxy setup
  const handleInitializeSetup = useCallback(async (description?: string) => {
    if (!proxyContract || !connected) {
      toast({
        title: "Error",
        description: "Wallet not connected or proxy contract not initialized",
        variant: "destructive",
      });
      return;
    }

    try {
      setSetupLoading(true);
      setLoading(true);
      
      // Reset setup data to prevent conflicts with previous attempts
      setSetupData({});
      setSetupStep(0);
      
      // Reset proxy contract state to prevent policy ID conflicts
      proxyContract.reset();

      // Use multisig wallet inputs: pass all UTxOs, first >=5 ADA as collateral, and ms wallet address
      const { utxos, collateral, walletAddress } = await getMsInputs();
      const result: ProxySetupResult = await proxyContract.setupProxy(utxos, walletAddress);

      setSetupData({
        paramUtxo: result.paramUtxo,
        authTokenId: result.authTokenId,
        proxyAddress: result.proxyAddress,
        txHex: result.tx,
        description: description || undefined,
      });

      setSetupStep(1);
      toast({
        title: "Step 1 Complete",
        description: "Proxy parameters generated successfully",
        variant: "default",
      });

    } catch (error) {
      console.error("Initialize setup error:", error);
      toast({
        title: "Error",
        description: `Failed to initialize proxy setup: ${error instanceof Error ? error.message : 'Unknown error'}`,
        variant: "destructive",
      });
    } finally {
      setSetupLoading(false);
      setLoading(false);
    }
  }, [proxyContract, connected, setLoading]);

  // Step 2: Review and confirm setup
  const handleConfirmSetup = useCallback(async () => {
    if (!setupData.txHex || !setupData.proxyAddress || !setupData.authTokenId) {
      toast({
        title: "Error",
        description: "Setup data is incomplete",
        variant: "destructive",
      });
      return;
    }

    try {
      setSetupLoading(true);
      setLoading(true);

      // If msCbor is set, route through useTransaction hook to create a signable
      if (appWallet?.scriptCbor && setupData.txHex) {
        
        await newTransaction({
          txBuilder: setupData.txHex,
          description: setupData.description,
          toastMessage: "Proxy setup transaction created",
        });
      } else if (setupData.txHex) {
        // Sign and submit the transaction
        const signedTx = await wallet.signTx(await setupData.txHex.complete(), true);
        await wallet.submitTx(signedTx);
      } else {
        throw new Error("No transaction to submit");
      }

      // Store proxy information in the database
      if (!appWallet?.id && !userAddress) {
        throw new Error("Either wallet ID or user address is required to create proxy");
      }

      await createProxy({
        walletId: appWallet?.id || undefined,
        userId: user?.id || undefined,
        proxyAddress: setupData.proxyAddress,
        authTokenId: setupData.authTokenId,
        paramUtxo: JSON.stringify(setupData.paramUtxo),
        description: setupData.description || undefined,
      });

      // Update local state
      setIsProxySetup(true);

      // Refresh the proxies list
      await refetchProxies();

      setSetupStep(2);
      toast({
        title: "Setup Complete!",
        description: "Proxy has been successfully created and is ready to use",
        variant: "default",
      });

      // Close the setup modal after successful completion
      setTimeout(() => {
        setShowSetupModal(false);
        setSetupStep(0);
        setSetupData({});
      }, 2000); // Close after 2 seconds to let user see the success message

    } catch (error) {
      console.error("Confirm setup error:", error);
      
      // Handle specific error cases
      let errorMessage = "Failed to complete proxy setup";
      if (error instanceof Error) {
        if (error.message.includes("No collateral found")) {
          errorMessage = "Wallet collateral not set up. Please set up collateral in your wallet settings (requires 5 ADA minimum).";
        } else if (error.message.includes("No UTxOs found")) {
          errorMessage = "No UTxOs available in wallet. Please ensure your wallet has sufficient funds.";
        } else {
          errorMessage = `Failed to complete proxy setup: ${error.message}`;
        }
      }
      
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setSetupLoading(false);
      setLoading(false);
    }
  }, [setupData, wallet, appWallet, user, createProxy, refetchProxies, setLoading]);

  // Reset setup flow
  const handleResetSetup = useCallback(() => {
    setSetupStep(0);
    setSetupData({});
  }, []);

  // Navigation functions
  const handleStartSetup = useCallback(() => {
    setShowSetupModal(true);
  }, []);

  const handleStartSpending = useCallback(() => {
    if (selectedProxy) {
      setShowSpendSection(true);
    }
  }, [selectedProxy]);

  const handleCloseSetup = useCallback(() => {
    setShowSetupModal(false);
    setSetupStep(0);
    setSetupData({});
  }, []);

  const handleCloseSpend = useCallback(() => {
    setShowSpendSection(false);
  }, []);

  const handleUpdateProxy = useCallback(async (proxyId: string, description: string) => {
    await updateProxy({
      id: proxyId,
      description: description || undefined,
    });
  }, [updateProxy]);

  // Get balance for a specific proxy
  const getProxyBalance = useCallback(async (proxyAddress: string) => {
    if (!proxyContract) return [];

    try {
      // Create a temporary contract instance for this proxy
      const tempContract = new MeshProxyContract(
        {
          mesh: getTxBuilder(network),
          wallet: wallet,
          networkId: network,
        },
        {}
      );
      tempContract.proxyAddress = proxyAddress;
      
      const balance = await tempContract.getProxyBalance();
      return balance;
    } catch (error) {
      console.error("Get proxy balance error:", error);
      return [];
    }
  }, [proxyContract, network, wallet]);

  // Fetch all proxy balances for TVL calculation
  const fetchAllProxyBalances = useCallback(async () => {
    if (!proxies || proxies.length === 0 || !proxyContract) return;

    try {
      setTvlLoading(true);
      const balances: Record<string, Array<{ unit: string; quantity: string }>> = {};
      
      for (const proxy of proxies) {
        try {
          const balance = await getProxyBalance(proxy.proxyAddress);
          balances[proxy.id] = balance;
        } catch (error) {
          console.error(`Failed to fetch balance for proxy ${proxy.id}:`, error);
          balances[proxy.id] = [];
        }
      }
      
      setAllProxyBalances(balances);
    } catch (error) {
      console.error("Failed to fetch proxy balances:", error);
    } finally {
      setTvlLoading(false);
    }
  }, [proxies, proxyContract, getProxyBalance]);

  // Calculate Total Value Locked (TVL) across all proxies
  const calculateTVL = useCallback(() => {
    if (!proxies || proxies.length === 0) {
      return { totalADA: 0, totalAssets: 0, totalProxies: 0 };
    }

    let totalADA = 0;
    let totalAssets = 0;
    let totalProxies = proxies.length;

    // Sum up all ADA from all proxy balances
    Object.values(allProxyBalances).forEach((balance) => {
      balance.forEach((asset) => {
        if (asset.unit === "lovelace") {
          totalADA += parseFloat(asset.quantity) / 1000000; // Convert lovelace to ADA
        }
        totalAssets++;
      });
    });

    return { totalADA, totalAssets, totalProxies };
  }, [proxies, allProxyBalances]);

  const { totalADA, totalAssets } = calculateTVL();

  // Fetch all proxy balances when proxies change
  useEffect(() => {
    if (proxies && proxies.length > 0 && proxyContract) {
      fetchAllProxyBalances();
    }
  }, [proxies, proxyContract, fetchAllProxyBalances]);

  // Refresh balances when component mounts or wallet changes
  useEffect(() => {
    if (proxies && proxies.length > 0 && proxyContract && connected) {
      // Small delay to ensure everything is initialized
      const timer = setTimeout(() => {
        fetchAllProxyBalances();
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [connected, proxyContract, fetchAllProxyBalances, proxies]);

  // Manual TVL refresh function
  const refreshTVL = useCallback(async () => {
    if (proxies && proxies.length > 0 && proxyContract) {
      await fetchAllProxyBalances();
    }
  }, [proxies, proxyContract, fetchAllProxyBalances]);

  // Global refresh function for all proxy balances
  const refreshAllBalances = useCallback(async () => {
    if (proxies && proxies.length > 0 && proxyContract) {
      await fetchAllProxyBalances();
    }
  }, [proxies, proxyContract, fetchAllProxyBalances]);

  // Spend outputs management
  const handleSpendOutputsChange = useCallback((outputs: ProxyOutput[]) => {
    setSpendOutputs(outputs);
  }, []);

  // Handle proxy selection
  const handleProxySelection = useCallback(async (proxyId: string) => {
    setSelectedProxy(proxyId);
    const proxy = proxies?.find((p: any) => p.id === proxyId);
    if (proxy) {
      const balance = await getProxyBalance(proxy.proxyAddress);
      setSelectedProxyBalance(balance);
    }
  }, [proxies, getProxyBalance]);


  // Spend from proxy
  const handleSpendFromProxy = useCallback(async () => {
    if (!proxyContract || !connected) {
      toast({
        title: "Error",
        description: "Wallet not connected or proxy contract not initialized",
        variant: "destructive",
      });
      return;
    }

    if (!selectedProxy) {
      toast({
        title: "Error",
        description: "Please select a proxy to spend from",
        variant: "destructive",
      });
      return;
    }

    // Validate outputs
    const validOutputs = spendOutputs.filter(output => 
      output.address && output.amount && parseFloat(output.amount) > 0
    );

    if (validOutputs.length === 0) {
      toast({
        title: "Error",
        description: "Please provide at least one valid output",
        variant: "destructive",
      });
      return;
    }

    try {
      setSpendLoading(true);
      setLoading(true);

      // Get the selected proxy
      const proxy = proxies?.find((p: any) => p.id === selectedProxy);
      if (!proxy) {
        throw new Error("Selected proxy not found");
      }

      // Create a contract instance for the selected proxy
      const selectedProxyContract = new MeshProxyContract(
        {
          mesh: getTxBuilder(network),
          wallet: wallet,
          networkId: network,
        },
        {
          paramUtxo: JSON.parse(proxy.paramUtxo),
        },
        appWallet?.scriptCbor || undefined,
      );
      selectedProxyContract.proxyAddress = proxy.proxyAddress;

      // Pass multisig inputs to spend as well
      const { utxos, walletAddress } = await getMsInputs();
      const txHex = await selectedProxyContract.spendProxySimple(validOutputs, utxos, walletAddress);
      if (appWallet?.scriptCbor) {
      await newTransaction({
        txBuilder: txHex,
          description: "Proxy spend transaction",
          toastMessage: "Proxy spend transaction created",
        });
      } else {
        await wallet.submitTx(await txHex.complete());
      }

      // Refresh balance after successful spend
      await handleProxySelection(selectedProxy);

      // Close the spend modal after successful transaction
      setTimeout(() => {
        setShowSpendSection(false);
      }, 2000); // Close after 2 seconds to let user see the success message

    } catch (error) {
      console.error("Spend from proxy error:", error);
      
      // Handle specific error cases
      let errorMessage = "Failed to spend from proxy";
      if (error instanceof Error) {
        if (error.message.includes("No collateral found")) {
          errorMessage = "Wallet collateral not set up. Please set up collateral in your wallet settings (requires 5 ADA minimum).";
        } else if (error.message.includes("No UTxOs found")) {
          errorMessage = "No UTxOs available in wallet. Please ensure your wallet has sufficient funds.";
        } else {
          errorMessage = `Failed to spend from proxy: ${error.message}`;
        }
      }
      
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setSpendLoading(false);
      setLoading(false);
    }
  }, [proxyContract, connected, spendOutputs, selectedProxy, proxies, network, wallet, setLoading, handleProxySelection]);


  // Copy to clipboard
  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({
      title: "Copied",
      description: "Address copied to clipboard",
      variant: "default",
    });
  };


  if (!connected) {
    return (
      <Card>
        <CardContent className="p-6">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Please connect your wallet to use proxy control features.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card>
        <CardHeader className="p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Wallet className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1">
              <div className="h-4 bg-muted rounded animate-pulse mb-2"></div>
              <div className="h-3 bg-muted rounded animate-pulse w-2/3"></div>
            </div>
          </div>
        </CardHeader>
      </Card>
    );
  }


  return (
    <div className="w-full">
      {/* Single Expanding Proxy Control Card */}
      <Card>
        <CardHeader 
          className="cursor-pointer hover:bg-muted/50 transition-colors p-4 sm:p-6 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded-t-lg"
          onClick={() => setIsExpanded(!isExpanded)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setIsExpanded(!isExpanded);
            }
          }}
          tabIndex={0}
          role="button"
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? 'Collapse' : 'Expand'} proxy control panel`}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm sm:text-base font-semibold text-foreground truncate">
                  Proxy Contracts
                </div>
                <div className="text-xs text-muted-foreground">
                  Automated transaction management
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
              {/* TVL Display */}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="text-right cursor-help">
                      <div className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3 text-primary" />
                        <div className="text-sm sm:text-lg font-bold text-foreground">
                          {tvlLoading ? (
                            <div className="h-4 w-16 bg-muted animate-pulse rounded"></div>
                          ) : (
                            `${totalADA.toFixed(2)} ADA`
                          )}
                        </div>
                        <Info className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <div className="text-xs text-muted-foreground hidden sm:block">
                        {proxies && proxies.length > 0 
                          ? `${proxies.length} proxy${proxies.length !== 1 ? 'ies' : ''} • ${totalAssets} asset${totalAssets !== 1 ? 's' : ''}`
                          : 'Ready to setup'
                        }
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold">Total Value Locked (TVL)</div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={(e) => {
                            e.stopPropagation();
                            refreshTVL();
                          }}
                          disabled={tvlLoading}
                        >
                          <TrendingUp className={`h-3 w-3 ${tvlLoading ? 'animate-spin' : ''}`} />
                        </Button>
                      </div>
                      <div className="text-sm space-y-1">
                        <div>Total ADA: {totalADA.toFixed(6)} ADA</div>
                        <div>Total Assets: {totalAssets}</div>
                        <div>Active Proxies: {proxies?.length || 0}</div>
                        {tvlLoading && (
                          <div className="text-xs text-muted-foreground">Updating balances...</div>
                        )}
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              
              {/* Expand/Collapse Button */}
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 flex-shrink-0">
                {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* Expandable Content */}
        {isExpanded && (
          <CardContent className="pt-0">
            <div className="space-y-6 animate-in slide-in-from-top-2 fade-in duration-300">
              {/* Overview Section */}
              <ProxyOverview
                proxies={proxies}
                selectedProxy={selectedProxy}
                selectedProxyBalance={selectedProxyBalance}
                proxyBalance={proxyBalance}
                isProxySetup={isProxySetup}
                onProxySelection={handleProxySelection}
                onCopyToClipboard={copyToClipboard}
                onStartSetup={handleStartSetup}
                onStartSpending={handleStartSpending}
                onGetProxyBalance={getProxyBalance}
                onUpdateProxy={handleUpdateProxy}
                onRefreshAllBalances={refreshAllBalances}
              />

              {/* UTxO Selector for visibility/control. Contract uses all UTxOs from provider. */}
              {appWallet && (
                <div className="mt-2">
                  <UTxOSelector
                    appWallet={appWallet}
                    network={network}
                    onSelectionChange={(utxos, manual) => {
                      setSelectedUtxos(utxos);
                      setManualSelected(manual);
                    }}
                  />
                </div>
              )}

            </div>
          </CardContent>
        )}
      </Card>

      {/* Spend Modal */}
      <Dialog open={showSpendSection} onOpenChange={setShowSpendSection}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Spend from Proxy</DialogTitle>
          </DialogHeader>
          <ProxySpend
            proxies={proxies}
            selectedProxy={selectedProxy}
            selectedProxyBalance={selectedProxyBalance}
            spendOutputs={spendOutputs}
            spendLoading={spendLoading}
            onProxySelection={handleProxySelection}
            onSpendOutputsChange={handleSpendOutputsChange}
            onSpendFromProxy={handleSpendFromProxy}
            onCloseSpend={handleCloseSpend}
          />
        </DialogContent>
      </Dialog>

      {/* Setup Modal */}
      <Dialog open={showSetupModal} onOpenChange={setShowSetupModal}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Setup New Proxy</DialogTitle>
          </DialogHeader>
          <ProxySetup
            setupStep={setupStep}
            setupData={setupData}
            setupLoading={setupLoading}
            onInitializeSetup={handleInitializeSetup}
            onConfirmSetup={handleConfirmSetup}
            onResetSetup={handleResetSetup}
            onCopyToClipboard={copyToClipboard}
            onCloseSetup={handleCloseSetup}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
