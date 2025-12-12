import { Plus } from "lucide-react";
import { useState, useCallback } from "react";
import useAppWallet from "@/hooks/useAppWallet";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { getDRepIds } from "@meshsdk/core-cst";
import useTransaction from "@/hooks/useTransaction";
import DRepForm from "./drepForm";
import { getDRepMetadata } from "./drepMetadata";
import { hashDrepAnchor } from "@meshsdk/core";
import type { UTxO } from "@meshsdk/core";
import router from "next/router";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import { getProvider } from "@/utils/get-provider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/utils/api";
import { useProxy } from "@/hooks/useProxy";

interface PutResponse {
  url: string;
}

export default function RegisterDRep() {
  const { appWallet } = useAppWallet();
  const { connected, wallet } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);
  const { newTransaction } = useTransaction();
  const { multisigWallet } = useMultisigWallet();
  const { isProxyEnabled, selectedProxyId, setSelectedProxy } = useProxy();

  // Get proxies for the current wallet
  const { data: proxies, isLoading: proxiesLoading } = api.proxy.getProxiesByUserOrWallet.useQuery(
    { 
      walletId: appWallet?.id || undefined,
      userAddress: userAddress || undefined,
    },
    { enabled: !!(appWallet?.id || userAddress) }
  );

  // Check if we have valid proxy data (proxy enabled, selected, proxies exist, and selected proxy is found)
  const hasValidProxy = !!(isProxyEnabled && selectedProxyId && proxies && proxies.length > 0 && proxies.find((p: any) => p.id === selectedProxyId));

  const [manualUtxos, setManualUtxos] = useState<UTxO[]>([]);
  const [formState, setFormState] = useState({
    givenName: "",
    bio: "",
    motivations: "",
    objectives: "",
    qualifications: "",
    email: "",
    imageUrl: "",
    imageSha256: "",
    links: [""],
    identities: [""],
  });

  // Helper to resolve inputs for multisig controlled txs
  const getMsInputs = useCallback(async (): Promise<{ utxos: UTxO[]; walletAddress: string }> => {
    if (!multisigWallet?.getScript().address) {
      throw new Error("Multisig wallet address not available");
    }
    if (!manualUtxos || manualUtxos.length === 0) {
      throw new Error("No UTxOs selected. Please select UTxOs from the selector.");
    }
    return { utxos: manualUtxos, walletAddress: multisigWallet.getScript().address };
  }, [multisigWallet?.getScript().address, manualUtxos]);

  async function createAnchor(): Promise<{
    anchorUrl: string;
    anchorHash: string;
  }> {
    if (!appWallet) {
      throw new Error("Wallet not connected");
    }
    if (!multisigWallet) {
      throw new Error("Multisig wallet not connected");
    }
    // Get metadata with both compacted (for upload) and normalized (for hashing) forms
    const metadataResult = await getDRepMetadata(
      formState,
      appWallet,
    );
    
    // Upload the compacted JSON-LD (readable format)
    const rawResponse = await fetch("/api/pinata-storage/put", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pathname: `drep/${formState.givenName}.jsonld`,
        value: JSON.stringify(metadataResult.compacted, null, 2), // Pretty print for readability
      }),
    });
    const res = (await rawResponse.json()) as PutResponse;
    const anchorUrl = res.url;
    
    // Compute hash from the canonicalized (normalized) form per CIP-100/CIP-119
    // The normalized form is in N-Quads format which is the canonical representation
    const anchorHash = hashDrepAnchor(metadataResult.compacted);
    return { anchorUrl, anchorHash };
  }

  async function registerDrep(): Promise<void> {
    if (!connected || !userAddress || !multisigWallet || !appWallet)
      throw new Error("Multisig wallet not connected");

    setLoading(true);
    const txBuilder = getTxBuilder(network);
    const dRepId = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getDRepId() : appWallet?.dRepId;
    if (!dRepId) {
      throw new Error("DRep not found");
    }
    const scriptCbor = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getScript().scriptCbor : appWallet.scriptCbor;
    const drepCbor = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getDRepScript() : appWallet.scriptCbor;
    if (!scriptCbor) {
      throw new Error("Script not found");
    }
    if (!drepCbor) {
      throw new Error("DRep script not found");
    }
    try {
      const { anchorUrl, anchorHash } = await createAnchor();

      const selectedUtxos: UTxO[] = manualUtxos;

      if (selectedUtxos.length === 0) {
        setLoading(false);
        return;
      }

      for (const utxo of selectedUtxos) {
        txBuilder
          .txIn(
            utxo.input.txHash,
            utxo.input.outputIndex,
            utxo.output.amount,
            utxo.output.address,
          )
          .txInScript(scriptCbor);
      }

      txBuilder
        .drepRegistrationCertificate(dRepId, {
          anchorUrl: anchorUrl,
          anchorDataHash: anchorHash,
        })
        .certificateScript(drepCbor)
        .changeAddress(multisigWallet.getScript().address);



      await newTransaction({
        txBuilder,
        description: "DRep registration",
        toastMessage: "DRep registration transaction has been created",
      });
    } catch (e) {
      console.error(e);
    }
    router.push(`/wallets/${appWallet.id}/governance`);
    setLoading(false);
  }

  async function registerProxyDrep(): Promise<void> {
    if (!connected || !userAddress || !multisigWallet || !appWallet) {
      throw new Error("Multisig wallet not connected");
    }

    if (!hasValidProxy) {
      // Fall back to standard registration if no valid proxy
      return registerDrep();
    }

    setLoading(true);
    try {
      const { anchorUrl, anchorHash } = await createAnchor();

      // Get multisig inputs
      const { utxos, walletAddress } = await getMsInputs();

      // Get the selected proxy
      const proxy = proxies?.find((p: any) => p.id === selectedProxyId);
      if (!proxy) {
        // Fall back to standard registration if proxy not found
        return registerDrep();
      }

      // Create proxy contract instance with the selected proxy
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

      // Register DRep using proxy
      const txHex = await proxyContract.registerProxyDrep(anchorUrl, anchorHash, utxos, walletAddress);

      await newTransaction({
        txBuilder: txHex,
        description: "Proxy DRep registration",
        toastMessage: "Proxy DRep registration transaction has been created",
      });
    } catch (e) {
      console.error(e);
    }
    router.push(`/wallets/${appWallet.id}/governance`);
    setLoading(false);
  }

  return (
    <div className="w-full max-w-4xl mx-auto px-3 sm:px-4 md:px-6">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
          <Plus className="h-5 w-5 sm:h-6 sm:w-6 flex-shrink-0" />
          <span>Register DRep</span>
        </h1>
        <div className="mt-3 sm:mt-4 space-y-2 sm:space-y-3">
          {/* Global Proxy Status - Only show when proxies exist */}
          {proxies && proxies.length > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-2 p-3 rounded-lg border bg-muted/30">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full flex-shrink-0 ${isProxyEnabled ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="text-xs sm:text-sm font-medium">
                  {isProxyEnabled ? 'Proxy Mode Enabled' : 'Standard Mode'}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {isProxyEnabled 
                  ? 'DRep will be registered using a proxy contract' 
                  : 'DRep will be registered directly'
                }
              </span>
            </div>
          )}

          {/* Proxy Configuration - Only show when proxies exist */}
          {isProxyEnabled && proxies && proxies.length > 0 && (
            <div className="space-y-2 sm:space-y-3 p-3 rounded-lg border bg-blue-50/50 dark:bg-blue-950/20">
              <p className="text-xs sm:text-sm text-muted-foreground">
                This will register the DRep using a proxy contract, allowing for more flexible governance control.
              </p>
              {proxies && proxies.length > 0 ? (
                <div className="space-y-2">
                  <Label htmlFor="proxy-select" className="text-xs sm:text-sm">Select Proxy</Label>
                  <Select value={selectedProxyId} onValueChange={setSelectedProxy}>
                    <SelectTrigger id="proxy-select" className="w-full text-sm sm:text-base">
                      <SelectValue placeholder="Choose a proxy..." />
                    </SelectTrigger>
                    <SelectContent>
                      {proxies.map((proxy: any) => (
                        <SelectItem key={proxy.id} value={proxy.id}>
                          <div className="flex flex-col">
                            <span className="font-medium text-xs sm:text-sm">
                              {proxy.description || `Proxy ${proxy.id.slice(0, 8)}...`}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {proxy.proxyAddress.slice(0, 20)}...
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="text-xs sm:text-sm text-muted-foreground">
                  {proxiesLoading ? "Loading proxies..." : "No proxies available. Please create a proxy first."}
                </div>
              )}
            </div>
          )}

          {/* Standard Mode Info */}
          {!isProxyEnabled && (
            <div className="p-3 rounded-lg border bg-gray-50/50 dark:bg-gray-950/20">
              <p className="text-xs sm:text-sm text-muted-foreground">
                DRep will be registered directly to your multisig wallet. 
                To use proxy registration, enable proxy mode in the Proxy Control panel.
              </p>
            </div>
          )}
        </div>
      </div>
      {appWallet && (
        <DRepForm
          _imageUrl={""}
          _imageSha256={""}
          setImageSha256={(value: string) =>
            setFormState((prev) => ({ ...prev, imageSha256: value }))
          }
          {...formState}
          setGivenName={(value: string) =>
            setFormState((prev) => ({ ...prev, givenName: value }))
          }
          setBio={(value: string) =>
            setFormState((prev) => ({ ...prev, bio: value }))
          }
          setMotivations={(value: string) =>
            setFormState((prev) => ({ ...prev, motivations: value }))
          }
          setObjectives={(value: string) =>
            setFormState((prev) => ({ ...prev, objectives: value }))
          }
          setQualifications={(value: string) =>
            setFormState((prev) => ({ ...prev, qualifications: value }))
          }
          setEmail={(value: string) =>
            setFormState((prev) => ({ ...prev, email: value }))
          }
          setImageUrl={(value: string) =>
            setFormState((prev) => ({ ...prev, imageUrl: value }))
          }
          setLinks={(value: string[]) =>
            setFormState((prev) => ({ ...prev, links: value }))
          }
          setIdentities={(value: string[]) =>
            setFormState((prev) => ({ ...prev, identities: value }))
          }
          appWallet={appWallet}
          network={network}
          manualUtxos={manualUtxos}
          setManualUtxos={setManualUtxos}
          setManualSelected={() => {
            // This function is intentionally left empty.
          }}
          loading={loading}
          onSubmit={hasValidProxy ? registerProxyDrep : registerDrep}
          mode="register"
          isProxyMode={hasValidProxy}
        />
      )}
    </div>
  );
}
