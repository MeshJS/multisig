import { Minus } from "lucide-react";
import CardUI from "@/components/ui/card-content";
import { useState } from "react";
import useAppWallet from "@/hooks/useAppWallet";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import { getDRepIds } from "@meshsdk/core-cst";
import useTransaction from "@/hooks/useTransaction";
import DRepForm from "./drepForm";
import { getDRepMetadata } from "./drepMetadata";
import { getFile, hashDrepAnchor } from "@meshsdk/core";
import type { UTxO } from "@meshsdk/core";
import router from "next/router";

export default function UpdateDRep() {
  const { appWallet } = useAppWallet();
  const { connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);
  const { newTransaction } = useTransaction();

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

  async function createAnchor(): Promise<{
    anchorUrl: string;
    anchorHash: string;
  }> {
    if (!appWallet) {
      throw new Error("Wallet not connected");
    }
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
    const res = (await rawResponse.json()) as { url: string };
    const anchorUrl = res.url;
    const fileContent = getFile(anchorUrl);
    const anchorObj = JSON.parse(fileContent);
    const anchorHash = hashDrepAnchor(anchorObj);
    return { anchorUrl, anchorHash };
  }

  async function updateDrep(): Promise<void> {
    if (!connected || !userAddress || !appWallet)
      throw new Error("Wallet not connected");

    setLoading(true);
    const txBuilder = getTxBuilder(network);
    const drepIds = getDRepIds(appWallet.dRepId);
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
          .txInScript(appWallet.scriptCbor);
      }

      txBuilder
        .drepUpdateCertificate(drepIds.cip105, {
          anchorUrl,
          anchorDataHash: anchorHash,
        })
        .certificateScript(appWallet.scriptCbor)
        .changeAddress(appWallet.address)
        .selectUtxosFrom(manualUtxos);

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
    <CardUI title="Update DRep" icon={Minus}>
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
            // Intentionally left empty.
          }}
          loading={loading}
          onSubmit={updateDrep}
          mode="update"
        />
      )}
    </CardUI>
  );
}
