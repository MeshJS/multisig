import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import type { NextApiRequest, NextApiResponse } from "next";

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
    sampleWallet?: {
      id: string;
      name: string;
      adaBalance?: number;
    };
    snapshotsStored?: number;
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
    // Test endpoints by making actual HTTP requests to fetch real data
    const baseUrl = process.env.INTERNAL_BASE_URL || 'http://localhost:3000';
    const endpoints = {
      wallets: `${baseUrl}/api/v1/aggregatedBalances/wallets`,
      balance: `${baseUrl}/api/v1/aggregatedBalances/balance`,
      snapshots: `${baseUrl}/api/v1/aggregatedBalances/snapshots`,
    };

    const headers = {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json',
    };

    // Test wallets endpoint
    let walletsStatus = 'unknown';
    let walletsData = null;
    let sampleWallet = null;
    
    try {
      const walletsResponse = await fetch(endpoints.wallets, { headers });
      
      if (walletsResponse.ok) {
        walletsData = await walletsResponse.json();
        walletsStatus = `success (${walletsData.walletCount} wallets found)`;
        
        // Get a sample wallet for testing
        if (walletsData.wallets && walletsData.wallets.length > 0) {
          sampleWallet = walletsData.wallets[0];
        }
      } else {
        walletsStatus = `failed (${walletsResponse.status})`;
      }
    } catch (error) {
      walletsStatus = `error: ${(error as Error).message}`;
    }

    // Test balance endpoint if we have a sample wallet
    let balanceStatus = 'skipped (no sample wallet)';
    let balanceData = null;
    
    if (sampleWallet) {
      try {
        const balanceUrl = `${endpoints.balance}?${new URLSearchParams({
          walletId: sampleWallet.walletId,
          walletName: sampleWallet.walletName,
          signersAddresses: JSON.stringify(sampleWallet.signersAddresses),
          numRequiredSigners: sampleWallet.numRequiredSigners.toString(),
          type: sampleWallet.type,
          stakeCredentialHash: sampleWallet.stakeCredentialHash || '',
          isArchived: sampleWallet.isArchived.toString(),
          network: sampleWallet.network.toString(),
          paymentAddress: sampleWallet.paymentAddress,
          stakeableAddress: sampleWallet.stakeableAddress,
        })}`;
        
        const balanceResponse = await fetch(balanceUrl, { headers });
        
        if (balanceResponse.ok) {
          balanceData = await balanceResponse.json();
          balanceStatus = `success (${balanceData.walletBalance.adaBalance} ADA)`;
        } else {
          balanceStatus = `failed (${balanceResponse.status})`;
        }
      } catch (error) {
        balanceStatus = `error: ${(error as Error).message}`;
      }
    }

    // Collect all wallet balances for snapshots
    const allWalletBalances = [];
    let totalAdaBalance = 0;
    let processedWallets = 0;
    let failedWallets = 0;

    if (walletsData && walletsData.wallets && walletsData.wallets.length > 0) {
      console.log(`Processing ${walletsData.wallets.length} wallets for balance fetching...`);
      
      for (const wallet of walletsData.wallets) {
        try {
          const balanceUrl = `${endpoints.balance}?${new URLSearchParams({
            walletId: wallet.walletId,
            walletName: wallet.walletName,
            signersAddresses: JSON.stringify(wallet.signersAddresses),
            numRequiredSigners: wallet.numRequiredSigners.toString(),
            type: wallet.type,
            stakeCredentialHash: wallet.stakeCredentialHash || '',
            isArchived: wallet.isArchived.toString(),
            network: wallet.network.toString(),
          })}`;
          
          const balanceResponse = await fetch(balanceUrl, { headers });
          
          if (balanceResponse.ok) {
            const balanceData = await balanceResponse.json();
            const walletBalance = balanceData.walletBalance;
            
            allWalletBalances.push(walletBalance);
            totalAdaBalance += walletBalance.adaBalance;
            processedWallets++;
            
            console.log(`✅ Processed wallet ${wallet.walletName}: ${walletBalance.adaBalance} ADA`);
          } else {
            console.error(`❌ Failed to fetch balance for wallet ${wallet.walletName}: ${balanceResponse.status}`);
            failedWallets++;
          }
        } catch (error) {
          console.error(`❌ Error processing wallet ${wallet.walletName}:`, error);
          failedWallets++;
        }
      }
    }

    // Test snapshots endpoint with real wallet balances
    let snapshotsStatus = 'unknown';
    let snapshotsData = null;
    
    try {
      const snapshotsResponse = await fetch(endpoints.snapshots, {
        method: 'POST',
        headers,
        body: JSON.stringify({ walletBalances: allWalletBalances }),
      });
      
      if (snapshotsResponse.ok) {
        snapshotsData = await snapshotsResponse.json();
        snapshotsStatus = `success (${snapshotsData.snapshotsStored} snapshots stored)`;
      } else {
        snapshotsStatus = `failed (${snapshotsResponse.status})`;
      }
    } catch (error) {
      snapshotsStatus = `error: ${(error as Error).message}`;
    }


    const response: TestResponse = {
      message: "AggregatedBalances API Test Endpoint - Real Data Test",
      timestamp: new Date().toISOString(),
      endpoints: {
        wallets: `${endpoints.wallets} - Status: ${walletsStatus}`,
        balance: `${endpoints.balance} - Status: ${balanceStatus}`,
        snapshots: `${endpoints.snapshots} - Status: ${snapshotsStatus}`,
      },
      usage: {
        wallets: "GET - Returns all wallet information without balances",
        balance: "GET - Fetches balance for a single wallet (requires query params)",
        snapshots: "POST - Stores balance snapshots in database (requires body with walletBalances)",
      },
      ...(walletsData && {
        realData: {
          walletsFound: walletsData.walletCount || 0,
          processedWallets,
          failedWallets,
          totalAdaBalance: Math.round(totalAdaBalance * 100) / 100,
          ...(sampleWallet && {
            sampleWallet: {
              id: sampleWallet.walletId,
              name: sampleWallet.walletName,
              ...(balanceData && { adaBalance: balanceData.walletBalance.adaBalance }),
            },
          }),
          ...(snapshotsData && { snapshotsStored: snapshotsData.snapshotsStored }),
        },
      }),
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
