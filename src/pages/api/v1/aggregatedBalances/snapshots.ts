import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";

interface WalletBalance {
  walletId: string;
  walletName: string;
  address: string;
  balance: Record<string, string>;
  adaBalance: number;
  isArchived: boolean;
}

interface SnapshotsResponse {
  snapshotsStored: number;
  totalWallets: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SnapshotsResponse | { error: string }>,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Verify authentication for all requests
  const authToken = req.headers.authorization?.replace('Bearer ', '');
  const expectedToken = process.env.SNAPSHOT_AUTH_TOKEN;
  
  if (!expectedToken) {
    console.error('SNAPSHOT_AUTH_TOKEN environment variable not set');
    return res.status(500).json({ error: "Server configuration error" });
  }
  
  if (!authToken || authToken !== expectedToken) {
    console.warn('Unauthorized request attempt', {
      ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      authToken: authToken ? 'present' : 'missing',
      body: req.body
    });
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { walletBalances } = req.body;

  // Validate required parameters
  if (!walletBalances || !Array.isArray(walletBalances)) {
    return res.status(400).json({ error: "Missing or invalid walletBalances array" });
  }

  try {
    // Store individual wallet snapshots
    const snapshotPromises = walletBalances.map(async (walletBalance: WalletBalance) => {
      try {
        await (db as any).balanceSnapshot.create({
          data: {
            walletId: walletBalance.walletId,
            walletName: walletBalance.walletName,
            address: walletBalance.address,
            adaBalance: walletBalance.adaBalance,
            assetBalances: walletBalance.balance,
            isArchived: walletBalance.isArchived,
          },
        });
        return 1;
      } catch (error) {
        console.error(`Failed to store snapshot for wallet ${walletBalance.walletId}:`, error);
        return 0;
      }
    });

    const results = await Promise.all(snapshotPromises);
    const snapshotsStored = results.reduce((sum: number, result: number) => sum + result, 0);
    
    console.log(`Stored ${snapshotsStored} balance snapshots out of ${walletBalances.length} wallets`);

    const response: SnapshotsResponse = {
      snapshotsStored,
      totalWallets: walletBalances.length,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error in snapshots handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
}
