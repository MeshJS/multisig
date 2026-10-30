import type { NextApiRequest, NextApiResponse } from "next";
import { getProvider } from "@/utils/get-provider";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { applyRateLimit } from "@/lib/security/requestGuards";
import { TTL_MS, getLabel1854Registrations } from "@/lib/server/label1854Index";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  if (!applyRateLimit(req, res, { keySuffix: "v1/lookupMultisigWallet", maxRequests: 30 })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { pubKeyHashes, network = "1" } = req.query;

  if (typeof pubKeyHashes !== "string") {
    return res
      .status(400)
      .json({ error: "Missing or invalid pubKeyHashes parameter" });
  }

  const hashes = pubKeyHashes
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[0-9a-f]{56}$/.test(s));

  if (hashes.length === 0) {
    return res.status(400).json({ error: "No valid pubKeyHashes provided" });
  }
  if (hashes.length > 50) {
    return res.status(400).json({ error: "Too many pubKeyHashes (max 50)" });
  }

  const networkId = parseInt(network as string, 10);
  if (networkId !== 0 && networkId !== 1) {
    return res.status(400).json({ error: "Invalid network (expected 0 or 1)" });
  }

  try {
    // One shared, cached sweep of the whole label serves every lookup — see
    // label1854Index.ts for why the filtering below can't be pushed upstream.
    const { items: response, fetchedAt } = await getLabel1854Registrations(
      networkId,
      () => getProvider(networkId),
    );

    const validItems = response.filter((item: any) => {
      const participants = item.json_metadata?.participants;
      return participants && Object.keys(participants).length > 0;
    });

    const matchedItems = validItems.filter((item: any) => {
      const participants = item.json_metadata.participants;
      return Object.keys(participants).some((hash: string) =>
        hashes.includes(hash.toLowerCase()),
      );
    });

    // Let browsers/CDNs keep the answer only for what is left of the server
    // snapshot's TTL, so the two caches don't stack.
    const maxAge = Math.max(
      0,
      Math.floor((TTL_MS - (Date.now() - fetchedAt)) / 1000),
    );
    res.setHeader(
      "Cache-Control",
      `public, max-age=${maxAge}, stale-while-revalidate=120`,
    );
    res.status(200).json(matchedItems);
  } catch (error) {
    console.error("lookupWallet error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
