import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import CardUI from "@/components/common/card-content";
import { getFile, hashDrepAnchor, UTxO } from "@meshsdk/core";
import { useWallet } from "@meshsdk/react";
import { useUserStore } from "@/lib/zustand/user";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { useSiteStore } from "@/lib/zustand/site";
import { getTxBuilder } from "@/components/common/cardano-objects/get-tx-builder";
import useAppWallet from "@/hooks/useAppWallet";
import useTransaction from "@/hooks/useTransaction";
import { getDRepIds } from "@meshsdk/core-csl";
import UTxOSelector from "../../new-transaction/utxoSelector";
import ImgDragAndDrop from "@/components/common/ImgDragAndDrop";

export default function CardRegister() {
  const { appWallet } = useAppWallet();
  const { connected } = useWallet();
  const userAddress = useUserStore((state) => state.userAddress);
  const network = useSiteStore((state) => state.network);
  const [givenName, setgivenName] = useState<string>("");
  const [bio, setbio] = useState<string>("");
  const [motivations, setmotivations] = useState<string>("");
  const [objectives, setobjectives] = useState<string>("");
  const [qualifications, setqualifications] = useState<string>("");
  const [identity, setidentity] = useState<string>("");
  const { newTransaction } = useTransaction();
  const loading = useSiteStore((state) => state.loading);
  const setLoading = useSiteStore((state) => state.setLoading);
  const [manualUtxos, setManualUtxos] = useState<UTxO[]>([]);
  const [manualSelected, setManualSelected] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [image, setImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string>("");

  const [links, setLinks] = useState<string[]>([""]);
  const [identities, setIdentities] = useState<string[]>([""]);

  const addLink = () => setLinks([...links, ""]);
  const removeLink = (index: number) => {
    setLinks(links.filter((_, i) => i !== index));
  };

  const updateLink = (index: number, value: string) => {
    const newLinks = [...links];
    newLinks[index] = value;
    setLinks(newLinks);
  };

  const addIdentity = () => setIdentities([...identities, ""]);
  const removeIdentity = (index: number) => {
    setIdentities(identities.filter((_, i) => i !== index));
  };

  const updateIdentity = (index: number, value: string) => {
    const newIdentities = [...identities];
    newIdentities[index] = value;
    setIdentities(newIdentities);
  };

  function resetForm() {
    setgivenName("");
    setbio("");
    setmotivations("");
    setobjectives("");
    setqualifications("");
    setidentity("");
    setImage(null);
    setImageUrl("");
  }

  function handleImageUpload(url: string) {
    setImageUrl(url); // Only store the final Vercel URL
  }

  async function createAnchor() {
    const rawResponse = await fetch("/api/vercel-storage/put", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pathname: `drep/${givenName}.jsonld`,
        value: JSON.stringify({
          "@context": {
            CIP100:
              "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
            CIP108:
              "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0108/README.md#",
            CIP119:
              "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0119/README.md#",
            hashAlgorithm: "CIP100:hashAlgorithm",
            body: {
              "@id": "CIP119:body",
              "@context": {
                references: {
                  "@id": "CIP119:references",
                  "@container": "@set",
                  "@context": {
                    GovernanceMetadata: "CIP100:GovernanceMetadataReference",
                    Identity: "CIP119:IdentityReference",
                    Link: "CIP119:LinkReference",
                    Other: "CIP100:OtherReference",
                    label: "CIP100:reference-label",
                    uri: "CIP100:reference-uri",
                    referenceHash: {
                      "@id": "CIP119:referenceHash",
                      "@context": {
                        hashDigest: "CIP119:hashDigest",
                        hashAlgorithm: "CIP100:hashAlgorithm",
                      },
                    },
                  },
                },
                bio: "CIP119:bio",
                email: "CIP119:email",
                paymentAddress: "CIP119:paymentAddress",
                givenName: "CIP119:givenName",
                image: "CIP119:image",
                objectives: "CIP119:objectives",
                motivations: "CIP119:motivations",
                qualifications: "CIP119:qualifications",
                doNotList: "CIP119:doNotList",
              },
            },
            authors: {
              "@id": "CIP100:authors",
              "@container": "@set",
              "@context": {
                name: "http://xmlns.com/foaf/0.1/name",
                witness: {
                  "@id": "CIP100:witness",
                  "@context": {
                    witnessAlgorithm: "CIP100:witnessAlgorithm",
                    publicKey: "CIP100:publicKey",
                    signature: "CIP100:signature",
                  },
                },
              },
            },
          },
          authors: [],
          hashAlgorithm: "blake2b-256",
          body: {
            doNotList: false,
            bio: bio,
            email: email,
            givenName: givenName,
            image: {
              "@type": "ImageObject",
              contentUrl: imageUrl,
              sha256: "",
            },
            motivations: motivations,
            objectives: objectives,
            paymentAddress: appWallet?.address,
            qualifications: qualifications,
            references: [
              ...links
                .filter((link) => link.trim() !== "")
                .map((link) => ({
                  "@type": "Link",
                  label: "Link",
                  uri: link,
                })),
              ...identities
                .filter((identity) => identity.trim() !== "")
                .map((identity) => ({
                  "@type": "Identity",
                  label: "Identity",
                  uri: identity,
                })),
            ],
          },
        }),
      }),
    });

    const res = await rawResponse.json();
    const anchorUrl = res.url;
    const anchorObj = JSON.parse(getFile(anchorUrl));
    const anchorHash = hashDrepAnchor(anchorObj);

    return { anchorUrl, anchorHash };
  }

  async function updateDrep() {
    if (!connected) throw new Error("Not connected to wallet");
    if (!userAddress) throw new Error("No user address");
    if (!appWallet) throw new Error("No wallet");

    setLoading(true);

    const selectedUtxos = manualUtxos;
    if (selectedUtxos.length === 0) throw new Error("No relevant UTxOs found");

    const { anchorUrl, anchorHash } = await createAnchor();

    // tx

    const txBuilder = getTxBuilder(network);

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

    const drepids = getDRepIds(appWallet.dRepId);

    txBuilder
      .drepUpdateCertificate(drepids.cip105, {
        anchorUrl: anchorUrl,
        anchorDataHash: anchorHash,
      })
      .certificateScript(appWallet.scriptCbor)
      .changeAddress(appWallet.address)
      .selectUtxosFrom(selectedUtxos);

    await newTransaction({
      txBuilder,
      description: "DRep update",
      toastMessage: "DRep update transaction has been created",
    });
    resetForm();
  }

  return (
    <CardUI
      title="Update DRep information"
      icon={Plus}
      cardClassName="col-span-2"
    >
      <div className="flex flex-col gap-4">
        <p>
          A DRep is expected to actively participate in governance and act as a
          representative of other Cardano members in governance matters.
          Therefore, DReps will be expected to keep abreast of Governance
          Actions so they can make informed and wise decisions. Becoming a DRep
          will require a refundable deposit of ₳500.{" "}
          <Link
            href="https://docs.gov.tools/about/what-is-cardano-govtool/govtool-functions/dreps"
            target="_blank"
            rel="noopener noreferrer"
          >
            Learn about
          </Link>{" "}
          about DRep.
        </p>

        <fieldset className="grid gap-6">
          <div className="grid gap-3">
            <Label>
              DRep Name - This is the name that will be shown on your DRep
              profile
            </Label>
            <Input
              placeholder="name must be without spaces"
              value={givenName}
              onChange={(e) => {
                // const value = e.target.value.replace(/[^a-zA-Z0-9]/g, "");
                // setgivenName(value);
                setgivenName(e.target.value);
              }}
            />
          </div>
          <div className="grid gap-3">
            <Label>Bio - A brief explaination who you are.</Label>
            <Textarea value={bio} onChange={(e) => setbio(e.target.value)} />
          </div>

          <div className="grid gap-3">
            <Label>Email - Your contact email</Label>
            <Input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="grid gap-3">
            <Label>Upload Image</Label>
            <ImgDragAndDrop onImageUpload={handleImageUpload} />
          </div>

          <div className="grid gap-3">
            <Label>
              Objectives - What you believe and what you want to achieve as a
              DRep.
            </Label>
            <Textarea
              value={objectives}
              onChange={(e) => setobjectives(e.target.value)}
            />
          </div>

          <div className="grid gap-3">
            <Label>
              Motivations - Why do you want to be a DRep, what personal and
              professional experiences do you want to share.
            </Label>
            <Textarea
              value={motivations}
              onChange={(e) => setmotivations(e.target.value)}
            />
          </div>

          <div className="grid gap-3">
            <Label>
              Qualifications - List any qualifications that are relevant to your
              role as a DRep
            </Label>
            <Textarea
              value={qualifications}
              onChange={(e) => setqualifications(e.target.value)}
            />
          </div>

          <div className="grid gap-3">
            <Label>Links - Add relevant links to your profile</Label>
            {links.map((link, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={link}
                  onChange={(e) => updateLink(index, e.target.value)}
                  placeholder="https://path/to/info"
                />
                <Button
                  onClick={() => removeLink(index)}
                  size="icon"
                  variant="destructive"
                >
                  X
                </Button>
              </div>
            ))}
            <Button onClick={addLink} variant="secondary">
              + Add Link
            </Button>
          </div>

          <div className="grid gap-3">
            <Label>Identity - Add identity verification links</Label>
            {identities.map((identity, index) => (
              <div key={index} className="flex gap-2">
                <Input
                  value={identity}
                  onChange={(e) => updateIdentity(index, e.target.value)}
                  placeholder="https://path/to/identity"
                />
                <Button
                  onClick={() => removeIdentity(index)}
                  size="icon"
                  variant="destructive"
                >
                  X
                </Button>
              </div>
            ))}
            <Button onClick={addIdentity} variant="secondary">
              + Add Identity
            </Button>
          </div>
        </fieldset>

        {appWallet && (
          <UTxOSelector
            appWallet={appWallet}
            network={network}
            onSelectionChange={(utxos, manual) => {
              setManualUtxos(utxos);
              setManualSelected(manual);
            }}
          />
        )}

        <div>
          <Button
            onClick={() => updateDrep()}
            disabled={
              loading ||
              givenName.length === 0 ||
              motivations.length === 0 ||
              objectives.length === 0 ||
              qualifications.length === 0
            }
          >
            {loading ? "Loading..." : "Update DRep"}
          </Button>
        </div>
      </div>
    </CardUI>
  );
}
