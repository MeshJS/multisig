export type ProposalMetadata = {
  bytes: string;
  cert_index: number;
  hash: string;
  json_metadata: {
    body: {
      title: string;
      abstract: string;
      motivation: string;
      rationale: string;
    };
    authors: {
      name: string;
    }[];
  };
  tx_hash: string;
  url: string;
  governance_type: string;
};

export type BlockfrostDrepInfo = {
  drep_id: string;
  hex: string;
  amount: string;
  active: boolean;
  active_epoch: number;
  has_script: boolean;
};

export type BlockfrostDrepMetadata = {
  drep_id: string; // DRep identifier
  hex: string; // Hexadecimal representation of the DRep
  url: string; // URL linking to the DRep's metadata file
  hash: string; // Hash of the metadata content
  json_metadata: {
    "@context": {
      CIP100: string; // CIP100 context URL
      CIP119: string; // CIP119 context URL
      hashAlgorithm: string; // CIP100 hash algorithm context
      body: {
        "@id": string; // CIP119 body context ID
        "@context": {
          references: {
            "@id": string; // CIP119 references ID
            "@container": string; // CIP119 container context
            "@context": {
              GovernanceMetadata: string; // CIP100 Governance Metadata Reference
              Other: string; // CIP100 Other Reference
              label: string; // CIP100 label context
              uri: string; // CIP100 URI context
            };
          };
          paymentAddress: string; // CIP119 payment address context
          givenName: string; // CIP119 given name context
          image: {
            "@id": string; // CIP119 image ID
            "@context": {
              ImageObject: string; // Schema.org context for images
            };
          };
          objectives: string; // CIP119 objectives context
          motivations: string; // CIP119 motivations context
          qualifications: string; // CIP119 qualifications context
        };
      };
    };
    hashAlgorithm: string; // Hash algorithm used (e.g., "blake2b-256")
    body: {
      paymentAddress: string; // Payment address of the DRep
      givenName: string; // DRep's name
      image?: {
        "@type": string; // Type of the object (e.g., "ImageObject")
        contentUrl: string; // URL to the image
        sha256: string; // SHA256 hash of the image
      };
      objectives?: string; // Objectives of the DRep
      motivations?: string; // Motivations of the DRep
      qualifications?: string; // Qualifications of the DRep
      references?: Array<{
        "@type": string; // Type of the reference (e.g., "Other", "Link")
        label: string; // Label of the reference
        uri: string; // URI of the reference
      }>;
    };
  };
  bytes: string; // Raw bytes representation of the metadata
};