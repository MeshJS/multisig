import { Button } from "@/components/ui/button";
import { Wallet } from "@/types/wallet";
import { useSiteStore } from "@/lib/zustand/site";
import { getProvider } from "@/utils/get-provider";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { keepRelevant, Quantity, Unit, UTxO } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
import { useWalletsStore } from "@/lib/zustand/wallets";
import useTransaction from "@/hooks/useTransaction";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useProxy } from "@/hooks/useProxy";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import { api } from "@/utils/api";
import { useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

export default function Retire({ appWallet, manualUtxos }: { appWallet: Wallet; manualUtxos: UTxO[] }) {
  const network = useSiteStore((state) => state.network);
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const drepInfo = useWalletsStore((state) => state.drepInfo);
  const { newTransaction } = useTransaction();
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);
  const { multisigWallet } = useMultisigWallet();
  const { isProxyEnabled, selectedProxyId } = useProxy();
  const { toast } = useToast();


  // Get proxies for proxy mode
  const { data: proxies } = api.proxy.getProxiesByUserOrWallet.useQuery(
    { 
      walletId: appWallet?.id || undefined,
      userAddress: userAddress || undefined,
    },
    { enabled: !!(appWallet?.id || userAddress) }
  );

  // Check if we have valid proxy data (proxy enabled, selected, proxies exist, and selected proxy is found)
  const hasValidProxy = !!(isProxyEnabled && selectedProxyId && proxies && proxies.length > 0 && proxies.find((p: any) => p.id === selectedProxyId));

  // Helper function to get multisig inputs (like in register component)
  const getMsInputs = useCallback(async (): Promise<{ utxos: UTxO[]; walletAddress: string }> => {
    if (!multisigWallet?.getScript().address) {
      throw new Error("Multisig wallet address not available");
    }
    if (!manualUtxos || manualUtxos.length === 0) {
      throw new Error("No UTxOs selected. Please select UTxOs from the selector.");
    }
    return { utxos: manualUtxos, walletAddress: multisigWallet.getScript().address };
  }, [multisigWallet?.getScript().address, manualUtxos]);

  async function retireProxyDrep(): Promise<void> {
    if (!connected || !userAddress || !multisigWallet || !appWallet) {
      toast({
        title: "Connection Error",
        description: "Multisig wallet not connected",
        variant: "destructive",
      });
      return;
    }
    if (!hasValidProxy) {
      // Fall back to standard retire if no valid proxy
      return retireDrep();
    }

    setLoading(true);

    try {
      // Get the selected proxy
      const proxy = proxies?.find((p: any) => p.id === selectedProxyId);
      if (!proxy) {
        // Fall back to standard retire if proxy not found
        return retireDrep();
      }

      // Get multisig inputs
      let utxos, walletAddress;
      try {
        const inputs = await getMsInputs();
        utxos = inputs.utxos;
        walletAddress = inputs.walletAddress;
      } catch (error) {
        toast({
          title: "UTxO Selection Error",
          description: error instanceof Error ? error.message : "Failed to get multisig inputs",
          variant: "destructive",
        });
        return;
      }

      // Create proxy contract instance
      const txBuilder = getTxBuilder(network);
      const proxyContract = new MeshProxyContract(
        {
          mesh: txBuilder,
          wallet: wallet,
          networkId: network,
        },
        {
          paramUtxo: JSON.parse(proxy.paramUtxo),
        },
        appWallet.scriptCbor,
      );
      proxyContract.proxyAddress = proxy.proxyAddress;

      // Deregister DRep using proxy
      const txHex = await proxyContract.deregisterProxyDrep(utxos, walletAddress);

      await newTransaction({
        txBuilder: txHex,
        description: "Proxy DRep retirement",
        toastMessage: "Proxy DRep retirement transaction has been created",
      });
    } catch (error) {
      console.error("Proxy DRep retirement error:", error);
      toast({
        title: "Proxy DRep Retirement Failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  async function retireDrep() {
    if (!connected) {
      toast({
        title: "Connection Error",
        description: "Not connected to wallet",
        variant: "destructive",
      });
      return;
    }
    if (!userAddress) {
      toast({
        title: "User Error",
        description: "No user address",
        variant: "destructive",
      });
      return;
    }
    if (!multisigWallet) {
      toast({
        title: "Wallet Error",
        description: "Multisig Wallet could not be built",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      const blockchainProvider = getProvider(network);
      // For legacy wallets, use appWallet address; for SDK wallets, use multisig address
      const addressToFetch = multisigWallet?.getScript().address || appWallet.address;
      if (!addressToFetch) {
        toast({
          title: "Address Error",
          description: "No address available to fetch UTxOs",
          variant: "destructive",
        });
        return;
      }
      const utxos = await blockchainProvider.fetchAddressUTxOs(addressToFetch);

      const assetMap = new Map<Unit, Quantity>();
      assetMap.set("lovelace", "5000000");
      const selectedUtxos = keepRelevant(assetMap, utxos);
      if (selectedUtxos.length === 0) {
        toast({
          title: "UTxO Error",
          description: "No relevant UTxOs found",
          variant: "destructive",
        });
        return;
      }

      const txBuilder = getTxBuilder(network);
      
      // For legacy wallets (no multisigWallet), use appWallet values directly (preserves input order)
      // For SDK wallets, use multisigWallet to compute DRep ID and script
      let dRepId: string;
      let drepCbor: string;
      let scriptCbor: string;
      let changeAddress: string;
      
      if (multisigWallet) {
        const drepData = multisigWallet.getDRep(appWallet);
        if (!drepData) {
          toast({
            title: "DRep Error",
            description: "DRep not found",
            variant: "destructive",
          });
          return;
        }
        dRepId = drepData.dRepId;
        drepCbor = drepData.drepCbor;
        const multisigScript = multisigWallet.getScript();
        const multisigScriptCbor = multisigScript.scriptCbor;
        const appScriptCbor = appWallet.scriptCbor;
        if (!multisigScriptCbor && !appScriptCbor) {
          toast({
            title: "Script Error",
            description: "Script CBOR not found",
            variant: "destructive",
          });
          return;
        }
        scriptCbor = multisigWallet.getKeysByRole(3) ? (multisigScriptCbor || appScriptCbor!) : (appScriptCbor || multisigScriptCbor!);
        changeAddress = multisigScript.address;
      } else {
        // Legacy wallet: use appWallet values (computed with input order preserved)
        if (!appWallet.dRepId || !appWallet.scriptCbor) {
          toast({
            title: "DRep Error",
            description: "DRep ID or script not found for legacy wallet",
            variant: "destructive",
          });
          return;
        }
        dRepId = appWallet.dRepId;
        drepCbor = appWallet.scriptCbor; // Use payment script CBOR for legacy wallets
        scriptCbor = appWallet.scriptCbor;
        changeAddress = appWallet.address;
      }
      
      if (!scriptCbor || !changeAddress) {
        toast({
          title: "Script Error",
          description: "Script or change address not found",
          variant: "destructive",
        });
        return;
      }
      
      for (const utxo of selectedUtxos) {
        txBuilder.txIn(
          utxo.input.txHash,
          utxo.input.outputIndex,
          utxo.output.amount,
          utxo.output.address,
        );
      }

      txBuilder
        .txInScript(scriptCbor)
        .changeAddress(changeAddress)
        .drepDeregistrationCertificate(dRepId, "500000000");
      
      // Only add certificateScript if it's different from the spending script
      // to avoid "extraneous scripts" error
      if (drepCbor !== scriptCbor) {
        txBuilder.certificateScript(drepCbor);
      }

      await newTransaction({
        txBuilder,
        description: "DRep retirement",
        toastMessage: "DRep retirement transaction has been created",
      });
    } catch (error) {
      console.error("DRep retirement error:", error);
      toast({
        title: "DRep Retirement Failed",
        description: error instanceof Error ? error.message : "An unexpected error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      
      <Button
        onClick={() => hasValidProxy ? retireProxyDrep() : retireDrep()}
        disabled={loading || (!hasValidProxy && !drepInfo?.active) || (manualUtxos.length === 0)}
      >
        {loading ? "Loading..." : `Retire DRep${hasValidProxy ? " (Proxy Mode)" : ""}`}
      </Button>
      {isProxyEnabled && proxies && proxies.length > 0 && !selectedProxyId && (
        <div className="mt-2 p-2 bg-yellow-50 dark:bg-yellow-950/20 border border-yellow-200 dark:border-yellow-800 rounded-md">
          <p className="text-xs text-yellow-800 dark:text-yellow-200 font-medium">
            Proxy Mode Active - Select a proxy to continue
          </p>
          <p className="text-xs text-yellow-700 dark:text-yellow-300 mt-1">
            Go to the Proxy Control panel above and select a proxy to enable DRep retirement.
          </p>
        </div>
      )}
    </div>
  );
}
