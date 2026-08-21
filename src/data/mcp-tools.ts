/**
 * The MCP tool surface, for display.
 *
 * A plain data file with no imports on purpose: the real registry in
 * `src/lib/mcp/tools.ts` pulls the API handlers (and, transitively, the Mesh
 * WASM), so it must never reach a client bundle. `src/__tests__/mcpTools.test.ts`
 * asserts this list matches the registry name-for-name and scope-for-scope, so
 * it cannot drift.
 */

export type McpToolSummary = {
  name: string;
  scope: "wallets:read" | "governance:read" | "ballots:write";
  /** One line, phrased for someone deciding whether to connect. */
  blurb: string;
};

export const MCP_TOOL_SUMMARIES: McpToolSummary[] = [
  {
    name: "multisig_whoami",
    scope: "wallets:read",
    blurb: "Which account and permissions the connection is acting with.",
  },
  {
    name: "multisig_list_wallets",
    scope: "wallets:read",
    blurb: "Your multisig wallets and their ids.",
  },
  {
    name: "multisig_list_pending_transactions",
    scope: "wallets:read",
    blurb: "Transactions waiting for signatures, and how many they still need.",
  },
  {
    name: "multisig_list_free_utxos",
    scope: "wallets:read",
    blurb: "UTxOs not already locked by a pending transaction — what you can actually spend.",
  },
  {
    name: "multisig_list_proxies",
    scope: "wallets:read",
    blurb: "Active Plutus proxy scripts attached to a wallet.",
  },
  {
    name: "multisig_proxy_drep_info",
    scope: "wallets:read",
    blurb: "Whether a proxy's DRep credential is registered on-chain.",
  },
  {
    name: "multisig_lookup_wallet",
    scope: "wallets:read",
    blurb: "Find on-chain multisig registration metadata by participant key hash.",
  },
  {
    name: "governance_list_active_proposals",
    scope: "governance:read",
    blurb: "Governance proposals still open, with titles and abstracts.",
  },
  {
    name: "governance_list_ballots",
    scope: "governance:read",
    blurb: "Your team's internal decision log — how signers decided, and why.",
  },
  {
    name: "governance_vote_history",
    scope: "governance:read",
    blurb: "Votes your DRep has actually cast on-chain.",
  },
  {
    name: "governance_open_proposals",
    scope: "governance:read",
    blurb: "Active proposals you have not voted on yet — the outstanding decisions.",
  },
  {
    name: "ballot_upsert",
    scope: "ballots:write",
    blurb: "Create or update a ballot draft: a choice per proposal, plus rationale text.",
  },
  {
    name: "ballot_publish_rationale",
    scope: "ballots:write",
    blurb: "Publish a rationale to IPFS and record its anchor, ready for you to vote.",
  },
];
