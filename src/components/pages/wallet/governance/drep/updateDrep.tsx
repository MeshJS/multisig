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

  async function updateDrep() {
    if (!connected || !userAddress || !appWallet)
      throw new Error("Wallet not connected");

    setLoading(true);
    const txBuilder = getTxBuilder(network);
    const drepIds = getDRepIds(appWallet.dRepId);

    // Generate JSON‑LD metadata from form state (which now includes imageSha256)
    const drepMetadata = getDRepMetadata(formState, appWallet);

    txBuilder
      .drepUpdateCertificate(drepIds.cip105, { body: drepMetadata.body })
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