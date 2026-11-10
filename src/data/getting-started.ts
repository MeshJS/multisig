/** Shared content for the full guide and dashboard introduction. */
export const gettingStartedSections = [
  {
    id: "create-import",
    title: "1. Create or import a wallet",
    body: "Connect your Cardano wallet to sign in. Create a multisig wallet, choose its signers and approval threshold, and review the configuration together. If your team already has a wallet, use the import flow instead.",
    summary: "Create a shared wallet or import one your team already uses.",
    optional: false,
    links: [
      {
        href: "/wallets/new-wallet-flow/save",
        label: "Create a wallet",
      },
      {
        href: "/wallets/import-wallet",
        label: "Import a wallet",
      },
      {
        href: "/wallets",
        label: "My wallets",
      },
    ],
  },
  {
    id: "invite-signers",
    title: "2. Invite your signers",
    body: "Share the invitation link from the creation flow with your co-signers. Each signer connects their own wallet and checks their details. Review the signer list and required approvals before completing setup. Never share recovery phrases or private keys.",
    summary:
      "Invite your co-signers and review the approval threshold together.",
    optional: false,
    links: [],
  },
  {
    id: "first-transaction",
    title: "3. Review your first transaction",
    body: "Open your wallet and go to Transactions. When a proposed transaction is ready, check the recipients, amounts, fees, and other actions before signing. Your co-signers review it independently, and the required signatures must be collected before submission. Reading this guide does not require sending funds.",
    summary: "Check the recipients, amounts, fees, and actions before signing.",
    optional: false,
    links: [],
  },
  {
    id: "automation",
    title: "Optional: connect automation",
    body: "Connect an AI client or configure a bot with only the access it needs. MCP clients can prepare unsigned drafts with permission, but cannot sign or broadcast transactions.",
    summary: "Connect an AI client or bot with only the permissions it needs.",
    optional: true,
    links: [
      {
        href: "/docs/mcp",
        label: "MCP setup",
      },
      {
        href: "/bot-setup",
        label: "Bot Setup",
      },
    ],
  },
  {
    id: "documents",
    title: "Optional: review documents",
    body: "Open Documents in a selected wallet to create a document and request sign-off. Review the document version and signer requirements before approving. Use the public verifier to check a shared sign-off proof without connecting a wallet.",
    summary:
      "Review document versions and signer requirements before approving.",
    optional: true,
    links: [
      {
        href: "/verify",
        label: "Document verification",
      },
    ],
  },
];
