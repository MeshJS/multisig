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

interface RegisterDRepProps {
  onClose?: () => void;
}

export default function RegisterDRep({ onClose }: RegisterDRepProps = {}) {
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
    if (!connected || !userAddress || !appWallet)
      throw new Error("Wallet not connected");

    setLoading(true);
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
        throw new Error("DRep not found");
      }
      dRepId = drepData.dRepId;
      drepCbor = drepData.drepCbor;
      const multisigScript = multisigWallet.getScript();
      const multisigScriptCbor = multisigScript.scriptCbor;
      const appScriptCbor = appWallet.scriptCbor;
      if (!multisigScriptCbor && !appScriptCbor) {
        throw new Error("Script CBOR not found");
      }
      scriptCbor = multisigWallet.getKeysByRole(3) ? (multisigScriptCbor || appScriptCbor!) : (appScriptCbor || multisigScriptCbor!);
      changeAddress = multisigScript.address;
    } else {
      // Legacy wallet: use appWallet values (computed with input order preserved)
      if (!appWallet.dRepId || !appWallet.scriptCbor) {
        throw new Error("DRep ID or script not found for legacy wallet");
      }
      dRepId = appWallet.dRepId;
      drepCbor = appWallet.scriptCbor; // Use payment script CBOR for legacy wallets
      scriptCbor = appWallet.scriptCbor;
      changeAddress = appWallet.address;
    }
    
    if (!scriptCbor || !changeAddress) {
      throw new Error("Script or change address not found");
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
        .changeAddress(changeAddress);



      await newTransaction({
        txBuilder,
        description: "DRep registration",
        toastMessage: "DRep registration transaction has been created",
      });
      if (onClose) {
        onClose();
      } else {
        router.push(`/wallets/${appWallet.id}/governance`);
      }
    } catch (e) {
      console.error(e);
    }
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
      if (onClose) {
        onClose();
      } else {
        router.push(`/wallets/${appWallet.id}/governance`);
      }
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }

  return (
    <div className={`w-full max-w-4xl mx-auto ${onClose ? '' : 'px-3 sm:px-4 md:px-6'}`}>
      {!onClose && (
        <div className="mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
            <Plus className="h-5 w-5 sm:h-6 sm:w-6 flex-shrink-0" />
            <span>Register DRep</span>
          </h1>
        </div>
      )}
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
