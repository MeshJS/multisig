/**
 * JSON Schemas for the MCP tool inputs.
 *
 * These are hand-written and hand-checked against the handlers in
 * `src/pages/api/v1/`. They are deliberately NOT generated from
 * `src/utils/swagger.ts`: that file is a hand-maintained 1600-line literal with
 * `apis: []`, and it has already drifted from the handlers it documents, so it
 * is not a safe source of truth.
 *
 * Every schema sets `additionalProperties: false` — the SDK validates against
 * these with ajv before a tool body runs, so a typo'd argument fails loudly
 * instead of being silently dropped.
 */

export type JsonSchema = Record<string, unknown>;

const walletId = {
  type: "string",
  minLength: 1,
  description:
    "Wallet UUID from the multisig database (not a Cardano address).",
} as const;

const network = {
  type: "string",
  enum: ["0", "1"],
  description: 'Cardano network: "0" = preprod, "1" = mainnet.',
} as const;

export const EMPTY_INPUT: JsonSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export const WALLET_ONLY_INPUT: JsonSchema = {
  type: "object",
  properties: { walletId },
  required: ["walletId"],
  additionalProperties: false,
};

export const DOCUMENT_LIST_INPUT: JsonSchema = {
  type: "object",
  properties: {
    walletId,
    includeArchived: {
      type: "boolean",
      default: false,
      description: "Include archived documents. Off by default.",
    },
  },
  required: ["walletId"],
  additionalProperties: false,
};

export const DOCUMENT_GET_INPUT: JsonSchema = {
  type: "object",
  properties: {
    documentId: {
      type: "string",
      description:
        "Document id, as returned by document_list in the documentId field.",
    },
  },
  required: ["documentId"],
  additionalProperties: false,
};

export const FREE_UTXOS_INPUT: JsonSchema = {
  type: "object",
  properties: {
    walletId,
    fresh: {
      type: "boolean",
      default: false,
      description:
        "Bypass any cached chain state and re-read UTxOs from the provider.",
    },
  },
  required: ["walletId"],
  additionalProperties: false,
};

export const PROXY_DREP_INFO_INPUT: JsonSchema = {
  type: "object",
  properties: {
    walletId,
    proxyId: {
      type: "string",
      minLength: 1,
      description: "Proxy id, as returned by multisig_list_proxies.",
    },
  },
  required: ["walletId", "proxyId"],
  additionalProperties: false,
};

export const LOOKUP_WALLET_INPUT: JsonSchema = {
  type: "object",
  properties: {
    pubKeyHashes: {
      type: "array",
      items: { type: "string", pattern: "^[0-9a-f]{56}$" },
      minItems: 1,
      maxItems: 50,
      description:
        "Payment public key hashes (56 lowercase hex chars each) to match against on-chain CIP-1854 registration metadata.",
    },
    network,
  },
  required: ["pubKeyHashes"],
  additionalProperties: false,
};

export const ACTIVE_PROPOSALS_INPUT: JsonSchema = {
  type: "object",
  properties: {
    network,
    // Capped well below the endpoint's own limit of 100: it does an N+1 fan-out
    // of Blockfrost + IPFS anchor fetches, one per proposal, and a large page
    // can approach the platform's 60s request ceiling.
    count: {
      type: "integer",
      minimum: 1,
      maximum: 25,
      default: 10,
      description: "Number of proposals to fetch (max 25).",
    },
    page: { type: "integer", minimum: 1, default: 1 },
    order: { type: "string", enum: ["asc", "desc"], default: "desc" },
    details: {
      type: "boolean",
      default: false,
      description: "Include extended per-proposal detail fields.",
    },
  },
  additionalProperties: false,
};

export const BALLOT_UPSERT_INPUT: JsonSchema = {
  type: "object",
  properties: {
    walletId,
    ballotId: {
      type: "string",
      description:
        "Existing ballot id. Strongly preferred when updating — matching by name is ambiguous and errors if two ballots share one.",
    },
    ballotName: {
      type: "string",
      description: "Fallback lookup by name when ballotId is unknown.",
    },
    proposals: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        properties: {
          proposalId: {
            type: "string",
            minLength: 1,
            description:
              "Governance proposal id, in <txHash>#<certIndex> form.",
          },
          proposalTitle: {
            type: "string",
            description:
              "Human-readable proposal title. Required by the handler.",
          },
          choice: {
            type: "string",
            enum: ["Yes", "No", "Abstain"],
          },
          rationaleComment: {
            type: "string",
            description: "Draft rationale text. Stored as a draft only.",
          },
        },
        required: ["proposalId", "proposalTitle", "choice"],
        additionalProperties: false,
      },
    },
  },
  required: ["walletId", "proposals"],
  additionalProperties: false,
};

export const WALLET_BALLOTS_INPUT: JsonSchema = {
  type: "object",
  properties: { walletId },
  required: ["walletId"],
  additionalProperties: false,
};

export const VOTE_HISTORY_INPUT: JsonSchema = {
  type: "object",
  properties: {
    walletId,
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 100,
      default: 25,
      description: "Most recent votes to return, newest first.",
    },
  },
  required: ["walletId"],
  additionalProperties: false,
};

export const OPEN_PROPOSALS_INPUT: JsonSchema = {
  type: "object",
  properties: {
    walletId,
    count: {
      type: "integer",
      minimum: 1,
      maximum: 25,
      default: 10,
      description: "Active proposals to consider (max 25).",
    },
    includeVoted: {
      type: "boolean",
      default: false,
      description:
        "Include proposals this wallet's DRep has already voted on, annotated with the vote. Off by default, so the result is the outstanding decisions.",
    },
  },
  required: ["walletId"],
  additionalProperties: false,
};

export const PUBLISH_RATIONALE_INPUT: JsonSchema = {
  type: "object",
  properties: {
    walletId,
    ballotId: {
      type: "string",
      minLength: 1,
      description: "Ballot id, as returned by governance_list_ballots.",
    },
    proposalId: {
      type: "string",
      minLength: 1,
      description:
        "Governance proposal id (<txHash>#<certIndex>) on that ballot.",
    },
    summary: {
      type: "string",
      maxLength: 300,
      description:
        "Short stance and reason, plain text, max 300 chars. Defaults to the rationale already drafted on the ballot.",
    },
    rationaleStatement: {
      type: "string",
      description:
        "The full argument; markdown allowed. Defaults to the rationale already drafted on the ballot.",
    },
    precedentDiscussion: { type: "string" },
    counterargumentDiscussion: { type: "string" },
    conclusion: { type: "string", description: "Plain text, no markdown." },
    references: {
      type: "array",
      maxItems: 20,
      items: {
        type: "object",
        properties: {
          label: { type: "string", minLength: 1 },
          uri: { type: "string", minLength: 1 },
        },
        required: ["label", "uri"],
        additionalProperties: false,
      },
    },
  },
  required: ["walletId", "ballotId", "proposalId"],
  additionalProperties: false,
};
