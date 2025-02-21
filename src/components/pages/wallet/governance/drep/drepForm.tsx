import { Button } from "@/components/ui/button";
import UTxOSelector from "../../new-transaction/utxoSelector";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import ImgDragAndDrop from "@/components/common/ImgDragAndDrop";
import Link from "next/link";

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
  imageUrl: string;
  setImageUrl: (value: string) => void;
  imageSha256: string;
  setImageSha256: (value: string) => void;
  links: string[];
  setLinks: (value: string[]) => void;
  identities: string[];
  setIdentities: (value: string[]) => void;
  appWallet: any;
  network: number;
  manualUtxos: any[];
  setManualUtxos: (utxos: any[]) => void;
  setManualSelected: (value: boolean) => void;
  loading: boolean;
  onSubmit: () => void;
  mode: "register" | "update";
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
  imageUrl,
  setImageUrl,
  imageSha256,
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
}: DRepFormProps) {
  const addLink = () => setLinks([...links, ""]);
  const removeLink = (index: number) =>
    setLinks(links.filter((_, i) => i !== index));
  const updateLink = (index: number, value: string) => {
    const newLinks = [...links];
    newLinks[index] = value;
    setLinks(newLinks);
  };

  const addIdentity = () => setIdentities([...identities, ""]);
  const removeIdentity = (index: number) =>
    setIdentities(identities.filter((_, i) => i !== index));
  const updateIdentity = (index: number, value: string) => {
    const newIdentities = [...identities];
    newIdentities[index] = value;
    setIdentities(newIdentities);
  };

  // Update your image upload handler to capture both URL and digest
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
          <Label>Identities</Label>
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
          onClick={onSubmit}
          disabled={
            loading ||
            !givenName ||
            !motivations ||
            !objectives ||
            !qualifications
          }
        >
          {loading
            ? "Loading..."
            : mode === "register"
              ? "Register DRep"
              : "Update DRep"}
        </Button>
      </div>
    </div>
  );
}
