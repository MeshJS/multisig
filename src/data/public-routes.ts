export const publicRoutes = [
  "/",
  "/governance",
  "/governance/drep",
  "/governance/drep/[id]",
  "/features",
  "/roadmap",
  "/roadmap/graph",
  "/api-docs",
  "/dapps",
  "/bot-setup",
  // Reads this repo's own vault at build time and holds nothing user-specific,
  // so it renders without a connected wallet.
  "/vault",
  "/blog",
  "/blog/[slug]",
  // The import wizard renders before a wallet is connected so the user
  // can see what's available; per-tab actions (sign, submit) still gate
  // on a live wallet connection.
  "/wallets/import-wallet",
];
