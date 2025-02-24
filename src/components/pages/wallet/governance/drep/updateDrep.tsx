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


  
export default function UpdateDRep() {
  const { appWallet } = useAppWallet();
  const { connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);
  const { newTransaction } = useTransaction();
  const [manualUtxos, setManualUtxos] = useState<any[]>([]);

  // Updated form state now includes imageSha256.
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

  async function createAnchor() {
    if (!appWallet) {
      throw new Error("Wallet not connected");
    }
    // Generate JSON‑LD metadata from the form state
    const drepMetadata = getDRepMetadata(formState, appWallet);
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
    const res = await rawResponse.json();
    const anchorUrl = res.url;
    const anchorObj = JSON.parse(getFile(anchorUrl));
    const anchorHash = hashDrepAnchor(anchorObj);
    return { anchorUrl, anchorHash };
  }

  async function updateDrep() {
    if (!connected || !userAddress || !appWallet)
      throw new Error("Wallet not connected");
  
    setLoading(true);
    const txBuilder = getTxBuilder(network);
    const drepIds = getDRepIds(appWallet.dRepId);
  
    // Create anchor as in register (this function generates metadata,
    // uploads it, and returns anchorUrl and anchorHash)
    const { anchorUrl, anchorHash } = await createAnchor();
  
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
  
    setLoading(false);
  }

  return (
    <CardUI title="Update DRep Information" icon={Plus}>
      <DRepForm
        {...formState}
        setImageSha256={(value) =>
          setFormState((prev) => ({ ...prev, imageSha256: value }))
        }
        setGivenName={(value) =>
          setFormState((prev) => ({ ...prev, givenName: value }))
        }
        setBio={(value) => setFormState((prev) => ({ ...prev, bio: value }))}
        setMotivations={(value) =>
          setFormState((prev) => ({ ...prev, motivations: value }))
        }
        setObjectives={(value) =>
          setFormState((prev) => ({ ...prev, objectives: value }))
        }
        setQualifications={(value) =>
          setFormState((prev) => ({ ...prev, qualifications: value }))
        }
        setEmail={(value) =>
          setFormState((prev) => ({ ...prev, email: value }))
        }
        setImageUrl={(value) =>
          setFormState((prev) => ({ ...prev, imageUrl: value }))
        }
        setLinks={(value) =>
          setFormState((prev) => ({ ...prev, links: value }))
        }
        setIdentities={(value) =>
          setFormState((prev) => ({ ...prev, identities: value }))
        }
        appWallet={appWallet}
        network={network}
        manualUtxos={manualUtxos}
        setManualUtxos={setManualUtxos}
        setManualSelected={() => {}}
        loading={loading}
        onSubmit={updateDrep}
        mode="update"
      />
    </CardUI>
  );
}

function createAnchor(): { anchorUrl: any; anchorHash: any; } | PromiseLike<{ anchorUrl: any; anchorHash: any; }> {
    throw new Error("Function not implemented.");
}
