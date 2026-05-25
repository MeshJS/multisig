import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit } from "@/lib/security/requestGuards";

/**
 * Cross-instance wallet list for the import wizard's "instance root + picker"
 * mode. Returns lightweight metadata (id, name, type) for every wallet the
 * caller is a signer of, so the destination instance can render a picker
 * before initiating the per-wallet nonce-sign round trip.
 *
 * Auth: caller passes their stake address as a query param. We only return
 * wallets where that address appears in signersStakeKeys or signersAddresses
 * — no proof of ownership is required because the response carries no
 * secrets, just public-style metadata.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/exportWallet/listMine" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).end();
  }

  const { address } = req.query;
  if (typeof address !== "string" || address.length === 0) {
    return res.status(400).json({ error: "Missing address" });
  }

  try {
    const wallets = await db.wallet.findMany({
      where: {
        OR: [
          { signersStakeKeys: { has: address } },
          { signersAddresses: { has: address } },
        ],
        isArchived: false,
      },
      select: {
        id: true,
        name: true,
        description: true,
        type: true,
        numRequiredSigners: true,
        signersAddresses: true,
      },
    });

    return res.status(200).json({
      wallets: wallets.map((w) => ({
        id: w.id,
        name: w.name,
        description: w.description ?? "",
        type: w.type,
        numRequiredSigners: w.numRequiredSigners,
        numSigners: w.signersAddresses.length,
      })),
    });
  } catch (error) {
    console.error("[exportWallet/listMine] Error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
