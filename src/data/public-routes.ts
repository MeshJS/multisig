export const publicRoutes = [
  "/",
  "/governance",
  "/governance/drep",
  "/governance/drep/[id]",
  "/features",
  "/api-docs",
  "/dapps",
  // The import wizard renders before a wallet is connected so the user
  // can see what's available; per-tab actions (sign, submit) still gate
  // on a live wallet connection.
  "/wallets/import-wallet",
];
