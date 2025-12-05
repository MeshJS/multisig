import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import PinataImgDragAndDrop from "@/components/common/PinataImgDragAndDrop";
import { getDRepMetadata } from "@/components/pages/wallet/governance/drep/drepMetadata";
import { hashDrepAnchor } from "@meshsdk/core";
import type { Wallet } from "@/types/wallet";

interface DRepSetupFormProps {
  appWallet: Wallet;
  onAnchorCreated: (anchorUrl: string, anchorHash: string) => void;
  loading?: boolean;
}

interface PinataUploadResponse {
  url: string;
  hash: string;
}

export default function DRepSetupForm({
  appWallet,
  onAnchorCreated,
  loading = false,
}: DRepSetupFormProps) {
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

  const [isCreatingAnchor, setIsCreatingAnchor] = useState(false);

  // Helper functions for managing dynamic arrays
  const addLink = () => setFormState(prev => ({ ...prev, links: [...prev.links, ""] }));
  const removeLink = (index: number) =>
    setFormState(prev => ({ ...prev, links: prev.links.filter((_, i) => i !== index) }));
  const updateLink = (index: number, value: string) => {
    setFormState(prev => {
      const newLinks = [...prev.links];
      newLinks[index] = value;
      return { ...prev, links: newLinks };
    });
  };

  const addIdentity = () => setFormState(prev => ({ ...prev, identities: [...prev.identities, ""] }));
  const removeIdentity = (index: number) =>
    setFormState(prev => ({ ...prev, identities: prev.identities.filter((_, i) => i !== index) }));
  const updateIdentity = (index: number, value: string) => {
    setFormState(prev => {
      const newIdentities = [...prev.identities];
      newIdentities[index] = value;
      return { ...prev, identities: newIdentities };
    });
  };

  // Image upload handler
  const handleImageUpload = useCallback((url: string, digest: string) => {
    setFormState(prev => ({
      ...prev,
      imageUrl: url,
      imageSha256: digest,
    }));
  }, []);

  // Create DRep anchor using Pinata (with Vercel Blob fallback)
  const createAnchor = async (): Promise<{ anchorUrl: string; anchorHash: string }> => {
    if (!appWallet) {
      throw new Error("Wallet not connected");
    }

    setIsCreatingAnchor(true);
    try {
      // Generate DRep metadata
      const drepMetadata = (await getDRepMetadata(
        formState,
        appWallet,
      )) as Record<string, unknown>;

      console.log("DRep metadata:", drepMetadata);

      // Try Pinata first, fallback to Vercel Blob
      let response = await fetch("/api/pinata/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: JSON.stringify(drepMetadata, null, 2),
          filename: `drep-${formState.givenName}-metadata.jsonld`,
        }),
      });

      let anchorUrl: string;

      if (!response.ok) {
        const errorData = await response.json();
        
        // If Pinata is not configured (503) or unavailable, fallback to Vercel Blob
        if (errorData.error === "Pinata configuration not available" || response.status === 503) {
          console.log("Pinata not configured, falling back to Vercel Blob storage");
          
          response = await fetch("/api/vercel-storage/put", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              pathname: `drep/${formState.givenName}-${Date.now()}.jsonld`,
              value: JSON.stringify(drepMetadata, null, 2),
            }),
          });

          if (!response.ok) {
            throw new Error("Failed to upload metadata to Vercel Blob storage");
          }

          const blobResult = await response.json();
          anchorUrl = blobResult.url;
        } else {
          throw new Error(errorData.error || "Failed to upload metadata");
        }
      } else {
        const uploadResult = (await response.json()) as PinataUploadResponse;
        // Use public IPFS gateway instead of custom gateway
        // Format: https://ipfs.io/ipfs/{cid}
        anchorUrl = `https://ipfs.io/ipfs/${uploadResult.hash}`;
      }

      // Generate anchor hash
      const anchorHash = hashDrepAnchor(drepMetadata);

      return { anchorUrl, anchorHash };
    } finally {
      setIsCreatingAnchor(false);
    }
  };

  const handleSubmit = async () => {
    try {
      const { anchorUrl, anchorHash } = await createAnchor();
      onAnchorCreated(anchorUrl, anchorHash);
    } catch (error) {
      console.error("Failed to create DRep anchor:", error);
      // You might want to show a toast or error message here
    }
  };

  const isFormValid = formState.givenName && formState.motivations && formState.objectives && formState.qualifications;

  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <h3 className="text-lg font-semibold">DRep Metadata Setup</h3>
        <p className="text-sm text-muted-foreground">
          Configure your DRep metadata that will be stored on IPFS (via Pinata) or Vercel Blob storage.
          This information will be publicly available and associated with your DRep registration.
        </p>
      </div>

      <fieldset className="grid gap-6">
        <div className="grid gap-3">
          <Label htmlFor="givenName">DRep Name *</Label>
          <Input
            id="givenName"
            placeholder="Name must be without spaces"
            value={formState.givenName}
            onChange={(e) => setFormState(prev => ({ ...prev, givenName: e.target.value }))}
          />
        </div>

        <div className="grid gap-3">
          <Label htmlFor="bio">Bio</Label>
          <Textarea
            id="bio"
            value={formState.bio}
            onChange={(e) => setFormState(prev => ({ ...prev, bio: e.target.value }))}
            placeholder="Tell us about yourself..."
          />
        </div>

        <div className="grid gap-3">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            placeholder="Enter your email"
            value={formState.email}
            onChange={(e) => setFormState(prev => ({ ...prev, email: e.target.value }))}
          />
        </div>

        <div className="grid gap-3">
          <Label>Upload Image</Label>
          <PinataImgDragAndDrop onImageUpload={handleImageUpload} />
        </div>

        <div className="grid gap-3">
          <Label htmlFor="objectives">Objectives *</Label>
          <Textarea
            id="objectives"
            value={formState.objectives}
            onChange={(e) => setFormState(prev => ({ ...prev, objectives: e.target.value }))}
            placeholder="What are your objectives as a DRep?"
          />
        </div>

        <div className="grid gap-3">
          <Label htmlFor="motivations">Motivations *</Label>
          <Textarea
            id="motivations"
            value={formState.motivations}
            onChange={(e) => setFormState(prev => ({ ...prev, motivations: e.target.value }))}
            placeholder="What motivates you to become a DRep?"
          />
        </div>

        <div className="grid gap-3">
          <Label htmlFor="qualifications">Qualifications *</Label>
          <Textarea
            id="qualifications"
            value={formState.qualifications}
            onChange={(e) => setFormState(prev => ({ ...prev, qualifications: e.target.value }))}
            placeholder="What qualifies you to be a DRep?"
          />
        </div>

        <div className="grid gap-3">
          <Label>Links</Label>
          {formState.links.map((link, index) => (
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
                type="button"
              >
                X
              </Button>
            </div>
          ))}
          <Button onClick={addLink} variant="secondary" type="button">
            + Add Link
          </Button>
        </div>

        <div className="grid gap-3">
          <Label>Identities</Label>
          {formState.identities.map((identity, index) => (
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
                type="button"
              >
                X
              </Button>
            </div>
          ))}
          <Button onClick={addIdentity} variant="secondary" type="button">
            + Add Identity
          </Button>
        </div>
      </fieldset>

      <div className="space-y-2">
        <Button
          onClick={handleSubmit}
          disabled={loading || isCreatingAnchor || !isFormValid}
          className="w-full"
        >
          {isCreatingAnchor
            ? "Creating DRep Metadata..."
            : loading
            ? "Processing..."
            : "Create DRep Metadata"}
        </Button>
        <p className="text-xs text-muted-foreground text-center">
          This will upload your metadata to IPFS (via Pinata) or Vercel Blob storage and generate the anchor for DRep registration.
        </p>
      </div>
    </div>
  );
}
