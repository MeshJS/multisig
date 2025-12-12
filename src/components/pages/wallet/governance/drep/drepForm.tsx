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
    <div className="flex flex-col gap-3 sm:gap-4">
      <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
        A DRep is expected to actively participate in governance and act as a
        representative of other Cardano members. Becoming a DRep requires a
        refundable deposit of ₳500.{" "}
        <Link
          href="https://docs.gov.tools/about/what-is-cardano-govtool/govtool-functions/dreps"
          passHref
          className="text-blue-600 dark:text-blue-400 hover:underline"
        >
          Learn more
        </Link>
        .
      </p>

      <fieldset className="grid gap-4 sm:gap-6">
        <div className="grid gap-2 sm:gap-3">
          <Label className="text-sm sm:text-base">DRep Name</Label>
          <Input
            placeholder="name must be without spaces"
            value={givenName}
            onChange={(e) => setGivenName(e.target.value)}
            className="text-sm sm:text-base"
          />
        </div>

        <div className="grid gap-2 sm:gap-3">
          <Label className="text-sm sm:text-base">Bio</Label>
          <Textarea 
            value={bio} 
            onChange={(e) => setBio(e.target.value)}
            className="text-sm sm:text-base min-h-[80px] sm:min-h-[100px]"
          />
        </div>

        <div className="grid gap-2 sm:gap-3">
          <Label className="text-sm sm:text-base">Email</Label>
          <Input
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="text-sm sm:text-base"
          />
        </div>

        <div className="grid gap-2 sm:gap-3">
          <Label className="text-sm sm:text-base">Upload Image</Label>
          <ImgDragAndDrop onImageUpload={handleImageUpload} />
        </div>

        <div className="grid gap-2 sm:gap-3">
          <Label className="text-sm sm:text-base">Objectives</Label>
          <Textarea
            value={objectives}
            onChange={(e) => setObjectives(e.target.value)}
            className="text-sm sm:text-base min-h-[80px] sm:min-h-[100px]"
          />
        </div>

        <div className="grid gap-2 sm:gap-3">
          <Label className="text-sm sm:text-base">Motivations</Label>
          <Textarea
            value={motivations}
            onChange={(e) => setMotivations(e.target.value)}
            className="text-sm sm:text-base min-h-[80px] sm:min-h-[100px]"
          />
        </div>

        <div className="grid gap-2 sm:gap-3">
          <Label className="text-sm sm:text-base">Qualifications</Label>
          <Textarea
            value={qualifications}
            onChange={(e) => setQualifications(e.target.value)}
            className="text-sm sm:text-base min-h-[80px] sm:min-h-[100px]"
          />
        </div>

        <div className="grid gap-2 sm:gap-3">
          <Label className="text-sm sm:text-base">Links</Label>
          {localLinks.map((link, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={link}
                onChange={(e) => updateLink(index, e.target.value)}
                placeholder="https://path/to/info"
                className="text-sm sm:text-base flex-1"
              />
              <Button
                onClick={() => removeLink(index)}
                size="icon"
                variant="destructive"
                className="flex-shrink-0 h-10 w-10 sm:h-11 sm:w-11"
              >
                <span className="text-sm sm:text-base">×</span>
              </Button>
            </div>
          ))}
          <Button 
            onClick={addLink} 
            variant="secondary"
            className="w-full sm:w-auto text-sm sm:text-base"
          >
            + Add Link
          </Button>
        </div>

        <div className="grid gap-2 sm:gap-3">
          <Label className="text-sm sm:text-base">Identities</Label>
          {localIdentities.map((identity, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={identity}
                onChange={(e) => updateIdentity(index, e.target.value)}
                placeholder="https://path/to/identity"
                className="text-sm sm:text-base flex-1"
              />
              <Button
                onClick={() => removeIdentity(index)}
                size="icon"
                variant="destructive"
                className="flex-shrink-0 h-10 w-10 sm:h-11 sm:w-11"
              >
                <span className="text-sm sm:text-base">×</span>
              </Button>
            </div>
          ))}
          <Button 
            onClick={addIdentity} 
            variant="secondary"
            className="w-full sm:w-auto text-sm sm:text-base"
          >
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

      <div className="space-y-2 sm:space-y-3">
        <Button
          onClick={onSubmit}
          disabled={
            loading ||
            !givenName ||
            !motivations ||
            !objectives ||
            !qualifications
          }
          className="w-full text-sm sm:text-base py-2 sm:py-2.5"
        >
          {loading
            ? "Loading..."
            : mode === "register"
            ? `Register DRep${isProxyMode ? " (Proxy)" : ""}`
            : `Update DRep${isProxyMode ? " (Proxy)" : ""}`}
        </Button>
        {isProxyMode && (
          <p className="text-xs sm:text-sm text-muted-foreground text-center px-2">
            This will create a multisig transaction for proxy DRep {mode === "register" ? "registration" : "update"}
          </p>
        )}
      </div>
    </div>
  );
}