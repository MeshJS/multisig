import { Plus } from "lucide-react";
import CardUI from "@/components/common/card-content";
import { useState } from "react";
import useAppWallet from "@/hooks/useAppWallet";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import { getDRepIds } from "@meshsdk/core-csl";
import useTransaction from "@/hooks/useTransaction";
import DRepForm from "./drepForm";
import { getDRepMetadata } from "./drepMetadata";
import { getFile, hashDrepAnchor } from "@meshsdk/core";

interface AppWallet {
  dRepId: string;
  scriptCbor: string;
  address: string;
}

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

  // Use a properly typed UTxO array instead of any[]
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

  async function createAnchor(): Promise<{ anchorUrl: string; anchorHash: string }> {
    if (!appWallet) {
      throw new Error("Wallet not connected");
    }
    // Generate JSON‑LD metadata from the form state. We assume getDRepMetadata returns an object.
    const drepMetadata: object = await getDRepMetadata(formState, appWallet);
    console.log(drepMetadata);
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
    const fileContent = getFile(anchorUrl);
    const anchorObj = JSON.parse(fileContent);
    const anchorHash = hashDrepAnchor(anchorObj);
    return { anchorUrl, anchorHash };
  }

  async function registerDrep(): Promise<void> {
    if (!connected || !userAddress || !appWallet)
      throw new Error("Wallet not connected");

    setLoading(true);
    const txBuilder = getTxBuilder(network);
    const drepIds = getDRepIds(appWallet.dRepId);

    // Create anchor by uploading JSON‑LD metadata
    const { anchorUrl, anchorHash } = await createAnchor();

    // Cast manualUtxos to UTxO[] (already typed) and use const since it is not reassigned
    const selectedUtxos: UTxO[] = manualUtxos;

    if (selectedUtxos.length === 0) {
      // Optionally set an error message here if funds are insufficient.
      setLoading(false);
      return;
    }

    // Loop over each UTxO to add transaction inputs and corresponding scripts.
    for (const utxo of selectedUtxos) {
      txBuilder
        .txIn(
          utxo.input.txHash,
          utxo.input.outputIndex,
          utxo.output.amount,
          utxo.output.address
        )
        .txInScript(appWallet.scriptCbor);
    }

    txBuilder
      .drepRegistrationCertificate(drepIds.cip105, {
        anchorUrl: anchorUrl,
        anchorDataHash: anchorHash,
      })
      .certificateScript(appWallet.scriptCbor)
      .changeAddress(appWallet.address)
      .selectUtxosFrom(manualUtxos);

    await newTransaction({
      txBuilder,
      description: "DRep registration",
      toastMessage: "DRep registration transaction has been created",
    });

    setLoading(false);
  }

  return (
    <CardUI title="Register DRep" icon={Plus}>
      <DRepForm
        setImageSha256={(value: string) =>
          setFormState((prev) => ({ ...prev, imageSha256: value }))
        }
        {...formState}
        setGivenName={(value: string) =>
          setFormState((prev) => ({ ...prev, givenName: value }))
        }
        setBio={(value: string) => setFormState((prev) => ({ ...prev, bio: value }))}
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
    </CardUI>
  );
}