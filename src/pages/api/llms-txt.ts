import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host = req.headers.host ?? "multisig.meshjs.dev";
  const origin = `${proto}://${host}`;

  const body = `# Mesh Multisig

A Cardano multisig wallet platform. Sign transactions collaboratively,
participate in governance, and integrate bots and AI agents into wallet
workflows.

## Primary docs

- Bot setup guide (for AI agents): ${origin}/api/v1/botSetupGuide
- Bot setup page (HTML rendering of same guide): ${origin}/bot-setup
- API reference (OpenAPI / Swagger): ${origin}/api-docs

## Key bot endpoints

- POST ${origin}/api/v1/botRegister — bot self-registers, returns claim code
- GET  ${origin}/api/v1/botPickupSecret?pendingBotId=... — bot retrieves credentials after human claim
- POST ${origin}/api/v1/botAuth — exchange secret for short-lived JWT
- GET  ${origin}/api/v1/botMe — bot self-info including owner address
- GET  ${origin}/api/v1/walletIds?address=... — wallets the authenticated bot can access

## Wallet transfer (cross-instance)

- POST ${origin}/api/v1/wallet/transfer/import — receive a wallet definition exported from another instance
- GET  ${origin}/api/v1/wallet/transfer/export?walletId=... — export a wallet (owner JWT required)

## How to onboard an AI agent

1. Fetch ${origin}/api/v1/botSetupGuide and follow the five-phase flow.
2. The agent reports pendingBotId and claimCode to its human operator.
3. The human approves and grants scopes in the UI at ${origin}/user.
4. The agent picks up its secret and authenticates.
`;

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).send(body);
}
