import jsonld from "jsonld";
import type { JsonLdDocument, ContextDefinition } from "jsonld";

// CIP-119 character limits
const MAX_TEXT_LENGTH = 1000;

// Valid reference types per CIP-119 schema
const VALID_REFERENCE_TYPES = ["GovernanceMetadata", "Other", "Link", "Identity"] as const;

// Helper function to truncate text to max length
function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

// Return type for DRep metadata with both compacted and normalized forms
export interface DRepMetadataResult {
  compacted: Record<string, unknown>;
  normalized: string; // Canonicalized N-Quads format for hashing
}

// Explicitly declare that this function returns a Promise containing a JSON‑LD document.
// (You can adjust the return type if you have a more precise interface.)
export async function getDRepMetadata(
  formState: {
    givenName: string;
    bio: string;
    motivations: string;
    objectives: string;
    qualifications: string;
    imageUrl: string;
    imageSha256: string;
    links: string[];
    identities: string[];
  },
  appWallet: { address: string }
): Promise<DRepMetadataResult> {
  // Validate and truncate text fields per CIP-119 requirements
  const objectives = truncateText(formState.objectives, MAX_TEXT_LENGTH);
  const motivations = truncateText(formState.motivations, MAX_TEXT_LENGTH);
  const qualifications = truncateText(formState.qualifications, MAX_TEXT_LENGTH);

  // Build the raw JSON‑LD object
  const metadata = {
    "@context": {
      "@language": "en-us",
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
              Other: "CIP100:OtherReference",
              label: "CIP100:reference-label",
              uri: "CIP100:reference-uri",
              referenceHash: {
                "@id": "CIP108:referenceHash",
                "@context": {
                  hashDigest: "CIP108:hashDigest",
                  hashAlgorithm: "CIP100:hashAlgorithm",
                },
              },
            },
          },
          comment: "CIP100:comment",
          externalUpdates: {
            "@id": "CIP100:externalUpdates",
            "@context": {
              title: "CIP100:update-title",
              uri: "CIP100:update-uri",
            },
          },
          paymentAddress: "CIP119:paymentAddress",
          givenName: "CIP119:givenName",
          image: {
            "@id": "CIP119:image",
            "@context": {
              ImageObject: "https://schema.org/ImageObject",
              contentUrl: "https://schema.org/contentUrl",
              sha256: "https://schema.org/sha256",
            },
          },
          objectives: "CIP119:objectives",
          motivations: "CIP119:motivations",
          qualifications: "CIP119:qualifications",
          title: "CIP108:title",
          abstract: "CIP108:abstract",
          rationale: "CIP108:rationale",
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
    hashAlgorithm: "blake2b-256",
    body: {
      title: `${formState.givenName} - DRep`,
      abstract: formState.bio,
      motivations: motivations,
      rationale: "",
      paymentAddress: appWallet.address,
      givenName: formState.givenName,
      ...(formState.imageUrl && 
          formState.imageSha256 && 
          formState.imageUrl.trim() !== "" && 
          formState.imageSha256.trim() !== "" ? {
        image: {
          "@type": "ImageObject",
          contentUrl: formState.imageUrl.trim(),
          sha256: formState.imageSha256.trim(),
        }
      } : {}),
      objectives: objectives,
      qualifications: qualifications,
      references: [
        ...formState.links
          .filter((link) => link.trim() !== "")
          .map((link) => ({ 
            "@type": "Link" as const, 
            label: link, 
            uri: link 
          })),
        ...formState.identities
          .filter((id) => id.trim() !== "")
          .map((id) => ({ 
            "@type": "Identity" as const, 
            label: id, 
            uri: id 
          })),
      ],
      comment: formState.bio,
      externalUpdates: [],
    },
    authors: [
      {
        name: formState.givenName,
        witness: {
          witnessAlgorithm: "",
          publicKey: "",
          signature: "",
        },
      },
    ],
  };

  // Expand first to ensure all properties are preserved, then compact
  // This ensures that properties like contentUrl and sha256 are not lost
  const expanded = await jsonld.expand(
    metadata as unknown as JsonLdDocument
  );

  // Compact the JSON-LD document for readability
  const compacted = await jsonld.compact(
    expanded as unknown as JsonLdDocument,
    metadata["@context"] as unknown as ContextDefinition
  );

  // Normalize (canonicalize) the JSON-LD document per CIP-100/CIP-119
  // This produces a canonical form that should be used for hashing
  const normalized = await jsonld.normalize(
    compacted as unknown as JsonLdDocument,
    {
      algorithm: "URDNA2015",
      format: "application/n-quads",
    }
  );

  // Return both the compacted (for upload) and normalized (for hashing) versions
  return {
    compacted,
    normalized,
  };
}