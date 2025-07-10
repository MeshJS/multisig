import { Plus } from "lucide-react";
import CardUI from "@/components/ui/card-content";
import { useState } from "react";
import RequiredSigners from "@/components/multisig/requiredSigners";
import { MultisigKey } from "@/utils/multisigSDK";
import useAppWallet from "@/hooks/useAppWallet";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { getDRepIds } from "@meshsdk/core-cst";
import useTransaction from "@/hooks/useTransaction";
import DRepForm from "./drepForm";
import { getDRepMetadata } from "./drepMetadata";
import { getFile, hashDrepAnchor, resolveNativeScriptHash } from "@meshsdk/core";
import type { UTxO } from "@meshsdk/core";
import router from "next/router";
import useMultisigWallet from "@/hooks/useMultisigWallet";

interface PutResponse {
  url: string;
}

export default function RegisterDRep() {
  const { appWallet } = useAppWallet();
  const { connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);
  const { newTransaction } = useTransaction();
  const { multisigWallet } = useMultisigWallet();

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
  const [selectedSigners, setSelectedSigners] = useState<MultisigKey[]>([]);
  const [selectedPaymentSigners, setSelectedPaymentSigners] = useState<MultisigKey[]>([]);

  async function createAnchor(): Promise<{
    anchorUrl: string;
    anchorHash: string;
  }> {
    if (!appWallet) {
      throw new Error("Wallet not connected");
    }
    // Cast metadata to a known record type
    const drepMetadata = (await getDRepMetadata(
      formState,
      appWallet,
    )) as Record<string, unknown>;
    const rawResponse = await fetch("/api/vercel-storage/put", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pathname: `drep/${formState.givenName}.jsonld`,
        value: JSON.stringify(drepMetadata),
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

  async function registerDrep(): Promise<void> {
    if (!connected || !userAddress || !appWallet)
      throw new Error("Wallet not connected");
    if (!multisigWallet) throw new Error("Multisig Wallet could not be built.");
    const stakingScript = multisigWallet.getStakingScript();
    if (multisigWallet.stakingEnabled() && !stakingScript)
      throw new Error("Staking script not found.");

    setLoading(true);
    const txBuilder = getTxBuilder(network);
    try {
      const { anchorUrl, anchorHash } = await createAnchor();

      const selectedUtxos: UTxO[] = manualUtxos;

      if (selectedUtxos.length === 0) {
        setLoading(false);
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
      
      const drepids = getDRepIds(appWallet.dRepId)
      const anchor = {
          anchorUrl: anchorUrl,
          anchorDataHash: anchorHash,
        }
      txBuilder
        .txInScript(appWallet.scriptCbor)
        .changeAddress(appWallet.address)
        .drepRegistrationCertificate(drepids.cip129, anchor)
        .certificateScript(multisigWallet.getPaymentScript()!)
        ;

        console.log(txBuilder)
      for (const key of selectedPaymentSigners) {
        txBuilder.requiredSignerHash(key.keyHash);
      }
      // if(stakingScript) {
      //   console.log("Adding staking script to transaction");
      //   txBuilder.certificateScript(stakingScript);
      // }

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

  return (
    <CardUI title="Register DRep" icon={Plus}>
      {multisigWallet && (
        <>
          <RequiredSigners
            multisigWallet={multisigWallet}
            role={0}
            onChange={(signers) => setSelectedPaymentSigners(signers)}
          />
          <RequiredSigners
            multisigWallet={multisigWallet}
            role={2}
            onChange={(signers) => setSelectedSigners(signers)}
          />
        </>
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
          onSubmit={registerDrep}
          mode="register"
        />
      )}
    </CardUI>
  );
}
