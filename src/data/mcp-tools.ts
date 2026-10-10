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
  scope:
    | "wallets:read"
    | "governance:read"
    | "ballots:write"
    | "documents:read"
    | "transactions:write"
    | "tasks:write";
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
    blurb:
      "UTxOs not already locked by a pending transaction — what you can actually spend.",
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
    blurb:
      "Find on-chain multisig registration metadata by participant key hash, script hash or wallet address.",
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
    blurb:
      "Active proposals you have not voted on yet — the outstanding decisions.",
  },
  {
    name: "ballot_upsert",
    scope: "ballots:write",
    blurb:
      "Create or update a ballot draft: a choice per proposal, plus rationale text.",
  },
  {
    name: "ballot_publish_rationale",
    scope: "ballots:write",
    blurb:
      "Publish a rationale to IPFS and record its anchor, ready for you to vote.",
  },
  {
    name: "document_list",
    scope: "documents:read",
    blurb:
      "Sign-off documents for a wallet, and who still needs to sign each one.",
  },
  {
    name: "document_get",
    scope: "documents:read",
    blurb:
      "One document in full: every version, its hash, and who approved it.",
  },
  {
    name: "transaction_preview",
    scope: "transactions:write",
    blurb:
      "Build an unsigned transaction and show it as a review card in chat. Nothing is saved, signed or sent.",
  },
  {
    name: "transaction_propose",
    scope: "transactions:write",
    blurb:
      "Create the previewed transaction for your signers to review and sign in the app. Still unsigned.",
  },
  {
    name: "multisig_review_pending_transaction",
    scope: "wallets:read",
    blurb:
      "Render any pending transaction as a review card: recipients, amounts, fee, and who has signed.",
  },
  {
    name: "task_list",
    scope: "wallets:read",
    blurb:
      "The project task board: tasks by column, assignees, due dates, recipients and payout state.",
  },
  {
    name: "task_upsert",
    scope: "tasks:write",
    blurb:
      "Create, edit or move a task and set its payment recipients. Records a task only; drafts no transaction.",
  },
  {
    name: "task_prepare_payout",
    scope: "transactions:write",
    blurb:
      "Preview one payout transaction for selected tasks as a review card; confirm it with transaction_propose.",
  },
];
