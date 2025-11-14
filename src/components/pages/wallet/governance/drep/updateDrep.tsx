import { Minus } from "lucide-react";
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
import { getFile, hashDrepAnchor } from "@meshsdk/core";
import type { UTxO } from "@meshsdk/core";
import router from "next/router";
import useMultisigWallet from "@/hooks/useMultisigWallet";
import { useProxy } from "@/hooks/useProxy";
import { MeshProxyContract } from "@/components/multisig/proxy/offchain";
import { api } from "@/utils/api";
import { getProvider } from "@/utils/get-provider";

interface PutResponse {
  url: string;
}

export default function UpdateDRep() {
  const { appWallet } = useAppWallet();
  const { wallet, connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);
  const { newTransaction } = useTransaction();
  const { multisigWallet } = useMultisigWallet();
  const { isProxyEnabled, selectedProxyId } = useProxy();

  // UTxO selection state
  const [manualUtxos, setManualUtxos] = useState<UTxO[]>([]);

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
    // Cast metadata to a known record type
    const drepMetadata = (await getDRepMetadata(
      formState,
      appWallet,
    )) as Record<string, unknown>;
    console.log(drepMetadata);
    const rawResponse = await fetch("/api/ipfs/put", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pathname: `drep/${formState.givenName}.jsonld`,
        value: JSON.stringify(drepMetadata),
        userAddress: userAddress || undefined,
        walletId: appWallet?.id || undefined,
      }),
    });
    const res = (await rawResponse.json()) as PutResponse;
    const anchorUrl = res.url;
    // Await file retrieval
    const fileContent = getFile(anchorUrl);
    const anchorObj = JSON.parse(fileContent);
    const anchorHash = hashDrepAnchor(anchorObj);
    return { anchorUrl, anchorHash };
  }

  async function updateProxyDrep(): Promise<void> {
    if (!connected || !userAddress || !multisigWallet || !appWallet) {
      throw new Error("Multisig wallet not connected");
    }
    if (!hasValidProxy) {
      // Fall back to standard update if no valid proxy
      return updateDrep();
    }

    setLoading(true);

    try {
      // Get the selected proxy
      const proxy = proxies?.find((p: any) => p.id === selectedProxyId);
      if (!proxy) {
        // Fall back to standard update if proxy not found
        return updateDrep();
      }

      // Create anchor metadata
      const { anchorUrl, anchorHash } = await createAnchor();

      // Get multisig inputs
      const { utxos, walletAddress } = await getMsInputs();

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

      // Update DRep using proxy
      const txHex = await proxyContract.updateProxyDrep(anchorUrl, anchorHash, utxos, walletAddress);

      await newTransaction({
        txBuilder: txHex,
        description: "Proxy DRep update",
        toastMessage: "Proxy DRep update transaction has been created",
      });

      router.push(`/wallets/${appWallet.id}/governance`);
    } catch (error) {
      console.error("Proxy DRep update error:", error);
      throw error;
    } finally {
      setLoading(false);
    }
  }

  async function updateDrep(): Promise<void> {
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
    const changeAddress = multisigWallet?.getKeysByRole(3) ? multisigWallet?.getScript().address : appWallet.address;
    if (!changeAddress) {
      throw new Error("Change address not found");
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
        .drepUpdateCertificate(dRepId, {
          anchorUrl: anchorUrl,
          anchorDataHash: anchorHash,
        })
        .certificateScript(drepCbor)
        .changeAddress(changeAddress);

      await newTransaction({
        txBuilder,
        description: "DRep update",
        toastMessage: "DRep update transaction has been created",
      });
    } catch (e) {
      console.error(e);
    }
    router.push(`/wallets/${appWallet.id}/governance`);
    setLoading(false);
  }

  return (
    <div className="w-full max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Minus className="h-6 w-6" />
          Update DRep
        </h1>
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
          onSubmit={hasValidProxy ? updateProxyDrep : updateDrep}
          mode="update"
          isProxyMode={hasValidProxy}
        />
      )}
    </div>
  );
}
