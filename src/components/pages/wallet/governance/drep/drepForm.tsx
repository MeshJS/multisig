import { useState } from "react";
import { Button } from "@/components/ui/button";
import UTxOSelector from "../../new-transaction/utxoSelector";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ImgDragAndDrop from "@/components/common/ImgDragAndDrop";
import Link from "next/link";
import type { UTxO } from "@meshsdk/core";
import { Wallet } from "@/types/wallet";


interface DRepFormProps {
  givenName: string;
  setGivenName: (value: string) => void;
  bio: string;
  setBio: (value: string) => void;
  motivations: string;
  setMotivations: (value: string) => void;
  objectives: string;
  setObjectives: (value: string) => void;
  qualifications: string;
  setQualifications: (value: string) => void;
  email: string;
  setEmail: (value: string) => void;
  _imageUrl: string; // renamed as unused
  setImageUrl: (value: string) => void;
  _imageSha256: string; // renamed as unused
  setImageSha256: (value: string) => void;
  links: string[];
  setLinks: (value: string[]) => void;
  identities: string[];
  setIdentities: (value: string[]) => void;
  appWallet: Wallet;
  network: number;
  manualUtxos: UTxO[]; 
  setManualUtxos: (utxos: UTxO[]) => void;
  setManualSelected: (value: boolean) => void;
  loading: boolean;
  onSubmit: () => void;
  mode: "register" | "update";
  isProxyMode?: boolean;
}

export default function DRepForm({
  givenName,
  setGivenName,
  bio,
  setBio,
  motivations,
  setMotivations,
  objectives,
  setObjectives,
  qualifications,
  setQualifications,
  email,
  setEmail,
  _imageUrl,
  setImageUrl,
  _imageSha256,
  setImageSha256,
  links,
  setLinks,
  identities,
  setIdentities,
  appWallet,
  network,
  manualUtxos,
  setManualUtxos,
  setManualSelected,
  loading,
  onSubmit,
  mode,
  isProxyMode = false,
}: DRepFormProps) {
  // Local state for links and identities for immediate updates
  const [localLinks, setLocalLinks] = useState<string[]>(links);
  const [localIdentities, setLocalIdentities] = useState<string[]>(identities);

  const addLink = () => setLocalLinks([...localLinks, ""]);
  const removeLink = (index: number) =>
    setLocalLinks(localLinks.filter((_, i) => i !== index));
  const updateLink = (index: number, value: string) => {
    const newLinks = [...localLinks];
    newLinks[index] = value;
    setLocalLinks(newLinks);
    setLinks(newLinks);
  };

  const addIdentity = () => setLocalIdentities([...localIdentities, ""]);
  const removeIdentity = (index: number) =>
    setLocalIdentities(localIdentities.filter((_, i) => i !== index));
  const updateIdentity = (index: number, value: string) => {
    const newIdentities = [...localIdentities];
    newIdentities[index] = value;
    setLocalIdentities(newIdentities);
    setIdentities(newIdentities);
  };

  // Image upload handler
  function handleImageUpload(url: string, digest: string) {
    setImageUrl(url);
    setImageSha256(digest);
  }

  return (
    <div className="flex flex-col gap-4">
      <p>
        A DRep is expected to actively participate in governance and act as a
        representative of other Cardano members. Becoming a DRep requires a
        refundable deposit of ₳500.{" "}
        <Link
          href="https://docs.gov.tools/about/what-is-cardano-govtool/govtool-functions/dreps"
          passHref
        >
          Learn more
        </Link>
        .
      </p>

      <fieldset className="grid gap-6">
        <div className="grid gap-3">
          <Label>DRep Name</Label>
          <Input
            placeholder="name must be without spaces"
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
          />
        </div>

        <div className="grid gap-3">
          <Label>Bio</Label>
          <Textarea value={bio} onChange={(e) => setBio(e.target.value)} />
        </div>

        <div className="grid gap-3">
          <Label>Email</Label>
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
          <Label>Objectives</Label>
          <Textarea
            value={objectives}
            onChange={(e) => setObjectives(e.target.value)}
          />
        </div>

        <div className="grid gap-3">
          <Label>Motivations</Label>
          <Textarea
            value={motivations}
            onChange={(e) => setMotivations(e.target.value)}
          />
        </div>

        <div className="grid gap-3">
          <Label>Qualifications</Label>
          <Textarea
            value={qualifications}
            onChange={(e) => setQualifications(e.target.value)}
          />
        </div>

        <div className="grid gap-3">
          <Label>Links</Label>
          {localLinks.map((link, index) => (
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
          <Label>Identities</Label>
          {localIdentities.map((identity, index) => (
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
          onSelectionChange={(utxos: UTxO[], manual: boolean) => {
            setManualUtxos(utxos);
            setManualSelected(manual);
          }}
        />
      )}

      <div className="space-y-2">
        <Button
          onClick={onSubmit}
          disabled={
            loading ||
            !givenName ||
            !motivations ||
            !objectives ||
            !qualifications
          }
          className="w-full"
        >
          {loading
            ? "Loading..."
            : mode === "register"
            ? `Register DRep ${isProxyMode ? "(Proxy Mode)" : "(Standard Mode)"}`
            : `Update DRep ${isProxyMode ? "(Proxy Mode)" : "(Standard Mode)"}`}
        </Button>
        {isProxyMode && (
          <p className="text-xs text-muted-foreground text-center">
            This will create a multisig transaction for proxy DRep registration
          </p>
        )}
      </div>
    </div>
  );
}