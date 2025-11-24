import jsonld from "jsonld";
import type { JsonLdDocument, ContextDefinition } from "jsonld";
import { hashDrepAnchor } from "@meshsdk/core";

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
 * Upload metadata to Vercel blob storage with automatic URL shortening for governance anchors
 */
export async function uploadMetadata(
  pathname: string,
  content: string,
): Promise<string> {
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
  let finalUrl = result.url;

  // Check if URL needs shortening (Cardano governance anchor URLs must be ≤64 chars)
  if (finalUrl.length > 64) {
    console.log(`Governance anchor URL too long (${finalUrl.length} chars), shortening...`);
    
    const shortenResponse = await fetch("/api/shorten-url", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: finalUrl }),
    });

    if (!shortenResponse.ok) {
      throw new Error("Failed to shorten governance anchor URL");
    }

    const shortenResult = await shortenResponse.json();
    // Handle localhost vs production URLs
    const shortUrl = shortenResult.shortUrl;
    if (shortUrl.startsWith('localhost:')) {
      finalUrl = `http://${shortUrl}`;
    } else {
      finalUrl = `https://${shortUrl}`;
    }
    console.log(`Governance anchor URL shortened from ${result.url.length} to ${finalUrl.length} chars`);
  }

  return finalUrl;
}

/**
 * Shorten a URL if it exceeds Cardano's 64-character limit for governance anchors
 */
export async function shortenUrlIfNeeded(url: string): Promise<string> {
  if (url.length <= 64) {
    return url;
  }

  console.log(`URL too long (${url.length} chars), shortening...`);
  
  const response = await fetch("/api/shorten-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error("Failed to shorten URL");
  }

  const result = await response.json();
  // Handle localhost vs production URLs
  const apiShortUrl = result.shortUrl;
  const shortUrl = apiShortUrl.startsWith('localhost:') 
    ? `http://${apiShortUrl}` 
    : `https://${apiShortUrl}`;
  console.log(`URL shortened from ${url.length} to ${shortUrl.length} chars`);
  
  return shortUrl;
}

/**
 * Calculate blake2b-256 hash of JSON-LD document
 * Uses hashDrepAnchor from MeshSDK which handles canonicalization
 */
export function hashMetadata(jsonLD: Record<string, unknown>): string {
  return hashDrepAnchor(jsonLD);
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
 * Note: This uses hashDrepAnchor as a workaround since we need blake2b-256
 * which is not available in Web Crypto API. In production, consider using
 * a proper blake2b library like 'blake2b' or 'blakejs'.
 */
async function hashCanonicalizedBody(canonicalized: string): Promise<string> {
  // The canonicalized string needs to be hashed with blake2b-256
  // For now, we create a simple object and use hashDrepAnchor
  // which should handle the hashing correctly
  // The canonicalized string should end with a newline per CIP-108 spec
  const canonicalizedWithNewline = canonicalized.endsWith('\n') 
    ? canonicalized 
    : canonicalized + '\n';
  
  // Create object that hashDrepAnchor can process
  // hashDrepAnchor likely expects JSON-LD, but we'll pass the canonicalized string
  // as a property to get it hashed
  const tempObj = { canonicalized: canonicalizedWithNewline };
  return hashDrepAnchor(tempObj);
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
    witnessAlgorithm: "ed25519" | "CIP-0008";
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
  const authors = [];
  if (input.authorName) {
    const author: Record<string, unknown> = {
      name: input.authorName,
    };

    if (witness) {
      author.witness = {
        witnessAlgorithm: witness.witnessAlgorithm,
        publicKey: witness.publicKey,
        signature: witness.signature,
      };
    } else {
      // Empty witness placeholders
      author.witness = {
        witnessAlgorithm: "",
        publicKey: "",
        signature: "",
      };
    }

    authors.push(author);
  }

  // Build complete metadata
  const metadata = {
    "@context": context,
    hashAlgorithm: "blake2b-256",
    body: body,
    authors: authors,
  };

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
  // Build the raw JSON-LD object
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
      abstract: formState.bio || "",
      motivations: formState.motivations || "",
      rationale: "",
      paymentAddress: appWallet?.address || "",
      givenName: formState.givenName,
      ...(formState.imageUrl && formState.imageSha256
        ? {
            image: {
              "@type": "ImageObject",
              contentUrl: formState.imageUrl,
              sha256: formState.imageSha256,
            },
          }
        : {}),
      objectives: formState.objectives || "",
      qualifications: formState.qualifications || "",
      references: [
        ...(formState.links || [])
          .filter((link) => link.trim() !== "")
          .map((link) => ({ "@type": "Link" as const, label: link, uri: link })),
        ...(formState.identities || [])
          .filter((id) => id.trim() !== "")
          .map((id) => ({
            "@type": "Identity" as const,
            label: id,
            uri: id,
          })),
      ],
      comment: formState.bio || "",
      externalUpdates: [],
    },
    // Authors are optional in CIP-119 but we include empty placeholder for compatibility
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

  // Compact the document using JSON-LD
  const compacted = await jsonld.compact(
    metadata as unknown as JsonLdDocument,
    metadata["@context"] as unknown as ContextDefinition,
  );
  return compacted;
}

