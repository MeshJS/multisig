import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { buildMultisigWallet } from "@/utils/common";
import { getProvider } from "@/utils/get-provider";
import { resolvePaymentKeyHash, serializeNativeScript } from "@meshsdk/core";
import type { UTxO, NativeScript } from "@meshsdk/core";
import { getBalance } from "@/utils/getBalance";
import { addressToNetwork } from "@/utils/multisigSDK";
import type { Wallet as DbWallet } from "@prisma/client";

interface WalletBalance {
  walletId: string;
  walletName: string;
  address: string;
  balance: Record<string, string>;
  adaBalance: number;
  isArchived: boolean;
}

interface BatchProgress {
  batchId: string;
  totalBatches: number;
  currentBatch: number;
  walletsInBatch: number;
  processedInBatch: number;
  failedInBatch: number;
  totalProcessed: number;
  totalFailed: number;
  totalAdaBalance: number;
  snapshotsStored: number;
  isComplete: boolean;
  startedAt: string;
  lastUpdatedAt: string;
}

interface BatchResponse {
  success: boolean;
  message: string;
  progress: BatchProgress;
  timestamp: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BatchResponse | { error: string }>,
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
      authTokenProvided: !!authToken,
      timestamp: new Date().toISOString()
    });
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { batchId, batchNumber, batchSize = 10 } = req.body;
  const startTime = new Date().toISOString();

  try {
    console.log(`🔄 Starting batch ${batchNumber || 1} of balance snapshots...`);

    // Step 1: Get total wallet count and calculate batches
    const totalWallets = await db.wallet.count();
    const totalBatches = Math.ceil(totalWallets / batchSize);
    const currentBatch = batchNumber || 1;
    const offset = (currentBatch - 1) * batchSize;

    console.log(`📊 Processing batch ${currentBatch}/${totalBatches} (${batchSize} wallets per batch)`);

    // Step 2: Fetch wallets for this batch
    const wallets: DbWallet[] = await db.wallet.findMany({
      skip: offset,
      take: batchSize,
      orderBy: { id: 'asc' }, // Consistent ordering
    });

    if (wallets.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No wallets found in this batch",
        progress: {
          batchId: batchId || `batch-${currentBatch}`,
          totalBatches,
          currentBatch,
          walletsInBatch: 0,
          processedInBatch: 0,
          failedInBatch: 0,
          totalProcessed: 0,
          totalFailed: 0,
          totalAdaBalance: 0,
          snapshotsStored: 0,
          isComplete: true,
          startedAt: startTime,
          lastUpdatedAt: new Date().toISOString(),
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Step 3: Process wallets in this batch
    const walletBalances: WalletBalance[] = [];
    let processedInBatch = 0;
    let failedInBatch = 0;
    let totalAdaBalance = 0;

    for (const wallet of wallets) {
      try {
        console.log(`  Processing wallet: (${wallet.id.slice(0, 8)}...)`);

        // Determine network from signer addresses
        let network = 1; // Default to mainnet
        if (wallet.signersAddresses.length > 0) {
          const signerAddr = wallet.signersAddresses[0]!;
          network = addressToNetwork(signerAddr);
        }

        // Build multisig wallet for address determination
        const walletData = {
          id: wallet.id,
          name: wallet.name,
          signersAddresses: wallet.signersAddresses,
          numRequiredSigners: wallet.numRequiredSigners!,
          type: wallet.type || "atLeast",
          stakeCredentialHash: wallet.stakeCredentialHash,
          isArchived: wallet.isArchived,
          description: wallet.description,
          signersStakeKeys: wallet.signersStakeKeys,
          signersDRepKeys: wallet.signersDRepKeys,
          signersDescriptions: wallet.signersDescriptions,
          clarityApiKey: wallet.clarityApiKey,
          drepKey: null,
          scriptType: null,
          scriptCbor: wallet.scriptCbor,
          verified: wallet.verified,
        };

        const mWallet = buildMultisigWallet(walletData, network);
        if (!mWallet) {
          console.error(`Failed to build multisig wallet for ${wallet.id.slice(0, 8)}...`);
          failedInBatch++;
          continue;
        }

        // Generate addresses from the built wallet
        const nativeScript = {
          type: wallet.type || "atLeast",
          scripts: wallet.signersAddresses.map((addr: string) => ({
            type: "sig",
            keyHash: resolvePaymentKeyHash(addr),
          })),
        };
        if (nativeScript.type == "atLeast") {
          //@ts-ignore
          nativeScript.required = wallet.numRequiredSigners!;
        }

        const paymentAddress = serializeNativeScript(
          nativeScript as NativeScript,
          wallet.stakeCredentialHash as undefined | string,
          network,
        ).address;

        const stakeableAddress = mWallet.getScript().address;

        // Determine which address to use
        const blockchainProvider = getProvider(network);
        
        let paymentUtxos: UTxO[] = [];
        let stakeableUtxos: UTxO[] = [];
        
        try {
          paymentUtxos = await blockchainProvider.fetchAddressUTxOs(paymentAddress);
          stakeableUtxos = await blockchainProvider.fetchAddressUTxOs(stakeableAddress);
        } catch (utxoError) {
          console.error(`Failed to fetch UTxOs for wallet ${wallet.id.slice(0, 8)}...:`, utxoError);
          // Continue with empty UTxOs
        }

        const paymentAddrEmpty = paymentUtxos.length === 0;
        let walletAddress = paymentAddress;
        
        if (paymentAddrEmpty && mWallet.stakingEnabled()) {
          walletAddress = stakeableAddress;
        }

        // Use the UTxOs from the selected address
        let utxos: UTxO[] = walletAddress === stakeableAddress ? stakeableUtxos : paymentUtxos;
        
        // If we still have no UTxOs, try the other network as fallback
        if (utxos.length === 0) {
          const fallbackNetwork = network === 0 ? 1 : 0;
          try {
            const fallbackProvider = getProvider(fallbackNetwork);
            utxos = await fallbackProvider.fetchAddressUTxOs(walletAddress);
            console.log(`Successfully fetched ${utxos.length} UTxOs for wallet ${wallet.id.slice(0, 8)}... on fallback network ${fallbackNetwork}`);
          } catch (fallbackError) {
            console.error(`Failed to fetch UTxOs for wallet ${wallet.id.slice(0, 8)}... on fallback network ${fallbackNetwork}:`, fallbackError);
            // Continue with empty UTxOs - this wallet will show 0 balance
          }
        }
        
        // Get balance for this wallet
        const balance = getBalance(utxos);
        
        // Calculate ADA balance
        const adaBalance = balance.lovelace ? parseInt(balance.lovelace) / 1000000 : 0;
        const roundedAdaBalance = Math.round(adaBalance * 100) / 100;

        const walletBalance: WalletBalance = {
          walletId: wallet.id,
          walletName: wallet.name,
          address: walletAddress,
          balance,
          adaBalance: roundedAdaBalance,
          isArchived: wallet.isArchived,
        };

        walletBalances.push(walletBalance);
        totalAdaBalance += roundedAdaBalance;
        processedInBatch++;
        
        console.log(`    ✅ Balance: ${roundedAdaBalance} ADA`);

      } catch (error) {
        console.error(`Error processing wallet ${wallet.id.slice(0, 8)}...:`, error);
        failedInBatch++;
      }
    }

    // Step 4: Store snapshots for this batch
    let snapshotsStored = 0;
    if (walletBalances.length > 0) {
      console.log(`💾 Storing ${walletBalances.length} balance snapshots...`);
      
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
          console.error('Failed to store snapshot for wallet %s:', walletBalance.walletId.slice(0, 8) + '...', error);
          return 0;
        }
      });

      const snapshotResults = await Promise.all(snapshotPromises);
      snapshotsStored = snapshotResults.reduce((sum: number, result: number) => sum + result, 0);
      
      console.log(`✅ Successfully stored ${snapshotsStored} balance snapshots`);
    }

    // Step 5: Calculate progress
    const isComplete = currentBatch >= totalBatches;
    const totalProcessed = (currentBatch - 1) * batchSize + processedInBatch;
    const totalFailed = (currentBatch - 1) * batchSize + failedInBatch;

    console.log(`📊 Batch ${currentBatch}/${totalBatches} completed:`);
    console.log(`   • Processed: ${processedInBatch}/${wallets.length}`);
    console.log(`   • Failed: ${failedInBatch}`);
    console.log(`   • Snapshots stored: ${snapshotsStored}`);
    console.log(`   • Batch ADA balance: ${Math.round(totalAdaBalance * 100) / 100} ADA`);
    console.log(`   • Overall progress: ${totalProcessed}/${totalWallets} wallets`);

    const progress: BatchProgress = {
      batchId: batchId || `batch-${currentBatch}`,
      totalBatches,
      currentBatch,
      walletsInBatch: wallets.length,
      processedInBatch,
      failedInBatch,
      totalProcessed,
      totalFailed,
      totalAdaBalance,
      snapshotsStored,
      isComplete,
      startedAt: startTime,
      lastUpdatedAt: new Date().toISOString(),
    };

    const response: BatchResponse = {
      success: true,
      message: isComplete 
        ? `All ${totalBatches} batches completed successfully` 
        : `Batch ${currentBatch}/${totalBatches} completed. Call next batch with batchNumber: ${currentBatch + 1}`,
      progress,
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(response);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Batch snapshot process failed:', errorMessage);
    
    res.status(500).json({
      success: false,
      message: `Batch snapshot process failed: ${errorMessage}`,
      progress: {
        batchId: batchId || `batch-${batchNumber || 1}`,
        totalBatches: 0,
        currentBatch: batchNumber || 1,
        walletsInBatch: 0,
        processedInBatch: 0,
        failedInBatch: 0,
        totalProcessed: 0,
        totalFailed: 0,
        totalAdaBalance: 0,
        snapshotsStored: 0,
        isComplete: false,
        startedAt: startTime,
        lastUpdatedAt: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  }
}
