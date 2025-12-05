import jsonld from "jsonld";
import type { JsonLdDocument, ContextDefinition } from "jsonld";
import { hashDrepAnchor } from "@meshsdk/core";
import { blake2b } from "blakejs";

/**
 * CIP-108 Governance Action Metadata
 */
export interface GovActionMetadataInput {
  title: string; // max 100 chars
  abstract: string; // max 500 chars
  motivation: string; // max 2000 chars
  rationale: string; // max 2000 chars
  references?: Array<{
    "@type": "GovernanceMetadata" | "Other";
    label: string;
    uri: string;
    referenceHash?: {
      hashDigest: string;
      hashAlgorithm: "blake2b-256";
    };
  }>;
  authorName?: string;
  authorAddress?: string;
}

/**
 * CIP-119 DRep Metadata
 */
export interface DRepMetadataInput {
  givenName: string;
  bio?: string;
  motivations?: string;
  objectives?: string;
  qualifications?: string;
  imageUrl?: string;
  imageSha256?: string;
  links?: string[];
  identities?: string[];
  paymentAddress?: string;
}

/**
 * Upload metadata to Pinata (default) or Vercel blob storage
 * Tries Pinata first, falls back to Vercel Blob if Pinata is not configured or fails
 */
export async function uploadMetadata(
  pathname: string,
  content: string,
): Promise<string> {
  let finalUrl: string;
  
  // Try Pinata first (default for governance actions and DRep)
  try {
    const filename = pathname.split('/').pop() || 'metadata.jsonld';
    const pinataResponse = await fetch("/api/pinata/upload", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content,
        filename,
      }),
    });

    if (pinataResponse.ok) {
      const pinataResult = (await pinataResponse.json()) as { url: string; hash: string };
      // Use public IPFS gateway instead of custom gateway
      // Format: https://ipfs.io/ipfs/{cid}
      finalUrl = `https://ipfs.io/ipfs/${pinataResult.hash}`;
      console.log("Metadata uploaded to Pinata:", finalUrl);
    } else {
      const errorData = await pinataResponse.json().catch(() => ({ error: "Unknown error" }));
      
      // If Pinata is not configured, fall back to Vercel Blob
      if (errorData.error === "Pinata configuration not available" || pinataResponse.status === 503) {
        console.log("Pinata not configured, falling back to Vercel Blob storage");
        throw new Error("PINATA_FALLBACK");
      } else {
        throw new Error(errorData.error || "Failed to upload to Pinata");
      }
    }
  } catch (error) {
    // Fall back to Vercel Blob if Pinata fails or is not configured
    if (error instanceof Error && error.message === "PINATA_FALLBACK") {
      const response = await fetch("/api/vercel-storage/put", {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pathname,
          value: content,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to upload metadata: ${response.statusText}`);
      }

      const result = (await response.json()) as { url: string };
      finalUrl = result.url;
      console.log("Metadata uploaded to Vercel Blob:", finalUrl);
    } else {
      throw error;
    }
  }

  return finalUrl;
}


/**
 * Calculate blake2b-256 hash of JSON-LD document for governance action metadata
 * Per CIP-100 and CIP-108: The hash MUST be the blake2b-256 hash of the canonicalized JSON-LD document.
 * 
 * The process per CIP-100/CIP-108:
 * 1. Canonicalize the full JSON-LD document using URDNA2015 algorithm (produces N-Quads format)
 * 2. Hash the canonicalized bytes (UTF-8 encoded) with blake2b-256
 * 
 * This implementation correctly follows the specification:
 * - Uses URDNA2015 canonicalization algorithm
 * - Produces N-Quads format (application/n-quads)
 * - Hashes the canonicalized string bytes with blake2b-256
 */
export async function hashMetadata(jsonLD: Record<string, unknown>): Promise<string> {
  // Step 1: Canonicalize the JSON-LD document per CIP-100/CIP-108
  // This produces N-Quads format, not JSON
  const canonicalized = await jsonld.canonize(
    jsonLD as unknown as JsonLdDocument,
    {
      algorithm: "URDNA2015",
      format: "application/n-quads",
    },
  );
  
  // Step 2: Hash the canonicalized string bytes with blake2b-256
  // The canonicalized string is in UTF-8 encoding
  // blake2b from blakejs: blake2b(input, key, outlen) where outlen=32 for blake2b-256
  const hashBytes = blake2b(canonicalized, undefined, 32);
  
  // Convert the hash bytes to hex string
  return Buffer.from(hashBytes).toString("hex");
}

/**
 * Canonicalize JSON-LD body for witness signing
 * Following CIP-108 test vector process
 */
export async function canonicalizeBody(
  bodyDoc: Record<string, unknown>,
): Promise<string> {
  const canonicalized = await jsonld.canonize(
    bodyDoc as unknown as JsonLdDocument,
    {
      algorithm: "URDNA2015",
      format: "application/n-quads",
    },
  );
  return canonicalized;
}

/**
 * Calculate blake2b-256 hash of canonicalized body
 * This hash is used for witness signing according to CIP-108
 * 
 * Per CIP-108: The witness signature signs the blake2b-256 hash of the canonicalized body.
 * The canonicalized string (in N-Quads format) should be hashed directly as UTF-8 bytes.
 * 
 * This implementation correctly follows CIP-108:
 * - Hashes the canonicalized N-Quads string bytes directly
 * - Uses blake2b-256 (32-byte output)
 */
async function hashCanonicalizedBody(canonicalized: string): Promise<string> {
  // Per CIP-108 spec, the canonicalized string should end with a newline
  const canonicalizedWithNewline = canonicalized.endsWith('\n') 
    ? canonicalized 
    : canonicalized + '\n';
  
  // Hash the canonicalized string bytes with blake2b-256
  // blake2b(input, key, outlen) where outlen=32 for blake2b-256
  const hashBytes = blake2b(canonicalizedWithNewline, undefined, 32);
  
  // Convert the hash bytes to hex string
  return Buffer.from(hashBytes).toString("hex");
}

/**
 * Generate body hash for witness signing
 * Following CIP-108 test vector: body-only doc -> canonicalize -> hash
 */
export async function generateBodyHashForWitness(
  context: Record<string, unknown>,
  body: Record<string, unknown>,
): Promise<string> {
  // Build body-only document
  const bodyDoc = {
    "@context": context,
    body: body,
  };

  // Canonicalize
  const canonicalized = await canonicalizeBody(bodyDoc);

  // Hash the canonicalized body
  // Note: We need blake2b-256 specifically. For now using hashDrepAnchor as approximation
  // In production, you should use a proper blake2b-256 library like 'blake2b'
  const hash = await hashCanonicalizedBody(canonicalized);
  return hash;
}

/**
 * Generate CIP-108 compliant Governance Action metadata
 * Following the schema from https://cips.cardano.org/cip/cip-0108/annex/test-vector
 */
export async function generateGovActionMetadata(
  input: GovActionMetadataInput,
  witness?: {
    witnessAlgorithm: "ed25519";
    publicKey: string;
    signature: string;
  },
): Promise<Record<string, unknown>> {
  // Validate character limits
  if (input.title.length > 100) {
    throw new Error("Title must be max 100 characters");
  }
  if (input.abstract.length > 500) {
    throw new Error("Abstract must be max 500 characters");
  }
  if (input.motivation.length > 2000) {
    throw new Error("Motivation must be max 2000 characters");
  }
  if (input.rationale.length > 2000) {
    throw new Error("Rationale must be max 2000 characters");
  }

  // Build context
  const context = {
    "@language": "en-us",
    CIP100: "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
    CIP108: "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0108/README.md#",
    hashAlgorithm: "CIP100:hashAlgorithm",
    body: {
      "@id": "CIP108:body",
      "@context": {
        title: "CIP108:title",
        abstract: "CIP108:abstract",
        motivation: "CIP108:motivation",
        rationale: "CIP108:rationale",
        references: {
          "@id": "CIP108:references",
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
  };

  // Build body
  const body: Record<string, unknown> = {
    title: input.title,
    abstract: input.abstract,
    motivation: input.motivation,
    rationale: input.rationale,
  };

  if (input.references && input.references.length > 0) {
    body.references = input.references;
  }

  // Build body-only document for canonicalization
  const bodyDoc = {
    "@context": context,
    body: body,
  };

  // Build authors array
  // Per CIP-100: authors are optional, but if present, each author MUST have a witness
  // Per CIP-108: The witness authenticates the author's endorsement
  // We only include authors if we have a valid witness
  const authors = [];
  if (input.authorName && witness) {
    const author: Record<string, unknown> = {
      name: input.authorName,
      witness: {
        witnessAlgorithm: witness.witnessAlgorithm, // Must be "ed25519" per CIP-100
        publicKey: witness.publicKey,
        signature: witness.signature,
      },
    };
    authors.push(author);
  }
  // Note: If no witness is provided, we omit authors entirely per CIP-100

  // Build complete metadata per CIP-100 and CIP-108
  // Per CIP-100: @context, hashAlgorithm, body are required
  // Per CIP-100: authors is optional but recommended for authentication
  const metadata: Record<string, unknown> = {
    "@context": context,
    hashAlgorithm: "blake2b-256", // Per CIP-100: MUST be "blake2b-256"
    body: body,
  };
  
  // Only include authors if we have at least one author with a witness
  // Per CIP-100: authors is optional, but if present, each MUST have a witness
  if (authors.length > 0) {
    metadata.authors = authors;
  }

  // Compact the document using JSON-LD
  const compacted = await jsonld.compact(
    metadata as unknown as JsonLdDocument,
    context as unknown as ContextDefinition,
  );

  return compacted;
}

/**
 * Generate CIP-119 compliant DRep metadata
 * Following the schema provided
 */
/**
 * Remove empty values from an object recursively
 * Per CIP-100: empty strings, empty arrays, and empty objects should be omitted
 */
function removeEmptyValues(obj: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    // Skip empty strings
    if (value === "") {
      continue;
    }
    
    // Skip empty arrays
    if (Array.isArray(value)) {
      if (value.length === 0) {
        continue;
      }
      // Recursively clean array items
      const cleanedArray = value
        .map((item) => typeof item === "object" && item !== null && !Array.isArray(item)
          ? removeEmptyValues(item as Record<string, unknown>)
          : item)
        .filter((item) => {
          // Remove empty objects from arrays
          if (typeof item === "object" && item !== null && !Array.isArray(item)) {
            return Object.keys(item).length > 0;
          }
          return item !== "";
        });
      if (cleanedArray.length > 0) {
        cleaned[key] = cleanedArray;
      }
      continue;
    }
    
    // Recursively clean nested objects
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const cleanedObj = removeEmptyValues(value as Record<string, unknown>);
      // Only include if object has at least one property
      // Special case: ImageObject must have contentUrl, not just @type
      if (cleanedObj["@type"] === "ImageObject" && !cleanedObj.contentUrl) {
        continue; // Skip ImageObject without contentUrl
      }
      if (Object.keys(cleanedObj).length > 0) {
        cleaned[key] = cleanedObj;
      }
      continue;
    }
    
    // Include non-empty primitive values
    cleaned[key] = value;
  }
  
  return cleaned;
}

export async function getDRepMetadata(
  formState: {
    givenName: string;
    bio?: string;
    motivations?: string;
    objectives?: string;
    qualifications?: string;
    imageUrl?: string;
    imageSha256?: string;
    links?: string[];
    identities?: string[];
  },
  appWallet?: { address: string },
): Promise<Record<string, unknown>> {
  // Build the body object, only including non-empty fields
  // Per CIP-119: DRep metadata should NOT include CIP-108 fields (title, abstract, rationale)
  // CIP-119 fields: givenName (required), motivations, objectives, qualifications, paymentAddress, image
  const body: Record<string, unknown> = {
    givenName: formState.givenName,
  };

  // Add optional CIP-119 fields only if they have values
  // Note: CIP-119 does NOT have "abstract" or "title" - those are CIP-108 fields
  if (formState.bio && formState.bio.trim()) {
    // Use comment for bio (CIP-100 field, not CIP-108 abstract)
    body.comment = formState.bio.trim();
  }

  if (formState.motivations && formState.motivations.trim()) {
    body.motivations = formState.motivations.trim();
  }

  if (formState.objectives && formState.objectives.trim()) {
    body.objectives = formState.objectives.trim();
  }

  if (formState.qualifications && formState.qualifications.trim()) {
    body.qualifications = formState.qualifications.trim();
  }

  if (appWallet?.address && appWallet.address.trim()) {
    body.paymentAddress = appWallet.address.trim();
  }

  // Add image only if URL is provided and valid
  // Per CIP-119: image must have contentUrl (required), sha256 is optional
  const imageUrl = formState.imageUrl?.trim();
  if (imageUrl && imageUrl.length > 0) {
    const imageObj: Record<string, unknown> = {
      "@type": "ImageObject",
      contentUrl: imageUrl,
    };
    const imageSha256 = formState.imageSha256?.trim();
    if (imageSha256 && imageSha256.length > 0) {
      imageObj.sha256 = imageSha256;
    }
    // Ensure contentUrl exists before adding image
    if (imageObj.contentUrl) {
      body.image = imageObj;
    }
  }

  // Build references array from links and identities
  const references: Array<Record<string, unknown>> = [];
  
  if (formState.links && formState.links.length > 0) {
    formState.links
      .filter((link) => link.trim() !== "")
      .forEach((link) => {
        references.push({
          "@type": "Link",
          label: link.trim(),
          uri: link.trim(),
        });
      });
  }

  if (formState.identities && formState.identities.length > 0) {
    formState.identities
      .filter((id) => id.trim() !== "")
      .forEach((id) => {
        references.push({
          "@type": "Identity",
          label: id.trim(),
          uri: id.trim(),
        });
      });
  }

  if (references.length > 0) {
    body.references = references;
  }

  // Build externalUpdates array (empty arrays should be omitted per CIP-100)
  // Only include if there are actual updates

  // Build the raw JSON-LD object
  const metadata: Record<string, unknown> = {
    "@context": {
      "@language": "en-us",
      CIP100:
        "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
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
              Link: "CIP100:LinkReference",
              Identity: "CIP100:IdentityReference",
              label: "CIP100:reference-label",
              uri: "CIP100:reference-uri",
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
            },
          },
          objectives: "CIP119:objectives",
          motivations: "CIP119:motivations",
          qualifications: "CIP119:qualifications",
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
    body: body,
  };

  // Per CIP-100: authors are optional and should only be included if they have valid witnesses
  // Since we don't have witness signing implemented here, we omit authors entirely
  // Authors can be added later when witness signing is implemented

  // Remove empty values to ensure canonical form
  const cleanedMetadata = removeEmptyValues(metadata);

  // Compact the document using JSON-LD
  const compacted = await jsonld.compact(
    cleanedMetadata as unknown as JsonLdDocument,
    cleanedMetadata["@context"] as unknown as ContextDefinition,
  );
  
  return compacted;
}

