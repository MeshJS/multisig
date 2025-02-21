export function getDRepMetadata(formState: {
    givenName: string;
    bio: string;
    motivations: string;
    objectives: string;
    qualifications: string;
    imageUrl: string;
    imageSha256: string;  // new field for the image digest
    links: string[];
    identities: string[];
  }, appWallet: { address: string }) {
    return {
      "@context": {
        "@language": "en-us",
        "CIP100": "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0100/README.md#",
        "CIP108": "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0108/README.md#",
        "CIP119": "https://github.com/cardano-foundation/CIPs/blob/master/CIP-0119/README.md#",
        "hashAlgorithm": "CIP100:hashAlgorithm",
        "body": {
          "@id": "CIP119:body",
          "@context": {
            "references": {
              "@id": "CIP119:references",
              "@container": "@set",
              "@context": {
                "GovernanceMetadata": "CIP100:GovernanceMetadataReference",
                "Other": "CIP100:OtherReference",
                "label": "CIP100:reference-label",
                "uri": "CIP100:reference-uri",
                "referenceHash": {
                  "@id": "CIP108:referenceHash",
                  "@context": {
                    "hashDigest": "CIP108:hashDigest",
                    "hashAlgorithm": "CIP100:hashAlgorithm"
                  }
                }
              }
            },
            "comment": "CIP100:comment",
            "externalUpdates": {
              "@id": "CIP100:externalUpdates",
              "@context": {
                "title": "CIP100:update-title",
                "uri": "CIP100:update-uri"
              }
            },
            "paymentAddress": "CIP119:paymentAddress",
            "givenName": "CIP119:givenName",
            "image": {
              "@id": "CIP119:image",
              "@context": {
                "ImageObject": "https://schema.org/ImageObject"
              }
            },
            "objectives": "CIP119:objectives",
            "motivations": "CIP119:motivations",
            "qualifications": "CIP119:qualifications",
            "title": "CIP108:title",
            "abstract": "CIP108:abstract",
            "rationale": "CIP108:rationale"
          }
        },
        "authors": {
          "@id": "CIP100:authors",
          "@container": "@set",
          "@context": {
            "name": "http://xmlns.com/foaf/0.1/name",
            "witness": {
              "@id": "CIP100:witness",
              "@context": {
                "witnessAlgorithm": "CIP100:witnessAlgorithm",
                "publicKey": "CIP100:publicKey",
                "signature": "CIP100:signature"
              }
            }
          }
        }
      },
      "hashAlgorithm": "blake2b-256",
      "body": {
        "title": `${formState.givenName} - DRep`,
        "abstract": formState.bio,
        "motivations": formState.motivations,
        "rationale": "",
        "paymentAddress": appWallet.address,
        "givenName": formState.givenName,
        "image": {
          "@type": "ImageObject",
          "contentUrl": formState.imageUrl,
          "sha256": formState.imageSha256  // include the digest here
        },
        "objectives": formState.objectives,
        "qualifications": formState.qualifications,
        "references": [
          ...formState.links
            .filter((link) => link.trim() !== "")
            .map((link) => ({ "@type": "Link", label: link, uri: link })),
          ...formState.identities
            .filter((id) => id.trim() !== "")
            .map((id) => ({ "@type": "Identity", label: id, uri: id }))
        ],
        "comment": formState.bio,
        "externalUpdates": []
      },
      "authors": [
        {
          "name": formState.givenName,
          "witness": {
            "witnessAlgorithm": "",
            "publicKey": "",
            "signature": ""
          }
        }
      ]
    };
  }