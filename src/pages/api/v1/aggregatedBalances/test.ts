import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import type { NextApiRequest, NextApiResponse } from "next";
import { BalanceSnapshotService } from "../../../../../scripts/balance-snapshots.js";

interface TestResponse {
  message: string;
  timestamp: string;
  endpoints: {
    wallets: string;
    balance: string;
    snapshots: string;
  };
  usage: {
    wallets: string;
    balance: string;
    snapshots: string;
  };
  realData?: {
    walletsFound: number;
    processedWallets: number;
    failedWallets: number;
    totalAdaBalance: number;
    snapshotsStored: number;
    executionTime: number;
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TestResponse | { error: string }>,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
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
      query: req.query
    });
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Set up environment for the script
    const baseUrl = process.env.INTERNAL_BASE_URL || 'http://localhost:3000';
    process.env.API_BASE_URL = baseUrl;
    process.env.SNAPSHOT_AUTH_TOKEN = authToken;

    // Run the balance snapshot service
    const service = new BalanceSnapshotService();
    const results = await service.run();

    const response: TestResponse = {
      message: "AggregatedBalances API Test Endpoint - Real Data Test using BalanceSnapshotService",
      timestamp: new Date().toISOString(),
      endpoints: {
        wallets: `${baseUrl}/api/v1/aggregatedBalances/wallets - Status: success`,
        balance: `${baseUrl}/api/v1/aggregatedBalances/balance - Status: success`,
        snapshots: `${baseUrl}/api/v1/aggregatedBalances/snapshots - Status: success`,
      },
      usage: {
        wallets: "GET - Returns all wallet information without balances",
        balance: "GET - Fetches balance for a single wallet (requires query params)",
        snapshots: "POST - Stores balance snapshots in database (requires body with walletBalances)",
      },
      realData: {
        walletsFound: results.walletsFound,
        processedWallets: results.processedWallets,
        failedWallets: results.failedWallets,
        totalAdaBalance: Math.round(results.totalAdaBalance * 100) / 100,
        snapshotsStored: results.snapshotsStored,
        executionTime: results.executionTime,
      },
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error in test handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
}
