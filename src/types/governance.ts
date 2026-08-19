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
      references?: Array<{
        "@type": string;
        label: string;
        uri: string;
      }>;
    };
    authors: {
      name: string;
    }[];
  };
  tx_hash: string;
  url: string;
  governance_type: string;
};

export type ProposalDetails = {
  id: string;
  tx_hash: string;
  cert_index: number;
  governance_type: string;
  deposit: string;
  return_address: string;
  governance_description: {
    tag: string;
  };
  ratified_epoch: number | null;
  enacted_epoch: number | null;
  dropped_epoch: number | null;
  expired_epoch: number | null;
  expiration: number | null;
};

export type ProposalParameters = {
  id: string;
  tx_hash: string;
  cert_index: number;
  parameters: Record<string, any>;
};

export type ProposalWithdrawal = {
  stake_address: string;
  amount: string;
};

/**
 * One on-chain vote cast by a DRep, joined with the proposal it voted on.
 * Served by /api/governance/drepVotes (sourced from Koios, which — unlike
 * Blockfrost — exposes the vote's rationale anchor and proposal link).
 */
export type DrepVoteHistoryItem = {
  proposalId: string;
  proposalTxHash: string;
  proposalIndex: number;
  voteTxHash: string;
  /** Unix seconds of the block containing the vote. */
  blockTime: number;
  vote: "Yes" | "No" | "Abstain";
  /** CIP-100/CIP-136 rationale anchor, when the DRep attached one. */
  metaUrl: string | null;
  metaHash: string | null;
  /** Snake_case governance action type (matches GovernanceTypeChip keys). */
  proposalType: string | null;
  proposalTitle: string | null;
};

export type DrepVoteHistoryResponse = {
  drepId: string;
  votes: DrepVoteHistoryItem[];
};

/**
 * Per-transaction governance activity, served by POST
 * /api/governance/txGovernance (Koios tx_info). Lets the token-flow
 * timeline badge votes and DRep certificates on arbitrary txs — Blockfrost
 * has no per-tx endpoint for either, and cross-referencing by a known DRep
 * id misses per-run DReps (the CI wallet registers, votes with, and retires
 * a fresh DRep every run).
 */
export type TxGovernanceRequest = {
  network: string | number;
  txHashes: string[];
};

export type TxGovernanceCert = {
  /** Koios cert type, e.g. "drep_registration" | "drep_retire" | "vote_delegation". */
  type: string;
  /** CIP-129 DRep id from the cert info, when present. */
  drepId: string | null;
};

export type TxGovernanceVote = {
  /** "DRep" | "SPO" | "ConstitutionalCommittee" — carried, never branched on. */
  voterRole: string;
  voteKind: "Yes" | "No" | "Abstain";
  proposalTxHash: string;
  proposalIndex: number;
  proposalTitle: string | null;
};

export type TxGovernanceItem = {
  txHash: string; // lowercased
  certs: TxGovernanceCert[];
  votes: TxGovernanceVote[];
};

export type TxGovernanceResponse = {
  items: TxGovernanceItem[];
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