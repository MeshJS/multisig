import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { buildWallet } from "@/utils/common";
import { MultisigWallet, type MultisigKey } from "@/utils/multisigSDK";
import { getProvider } from "@/utils/get-provider";
import { resolvePaymentKeyHash, resolveStakeKeyHash, type UTxO } from "@meshsdk/core";
import { getBalance } from "@/utils/getBalance";
import { addressToNetwork } from "@/utils/multisigSDK";
import type { Wallet as DbWallet } from "@prisma/client";
import { Decimal } from "@prisma/client/runtime/library";

interface WalletBalance {
  walletId: string;
  walletName: string;
  address: string;
  balance: Record<string, string>;
  adaBalance: number;
  isArchived: boolean;
  network: number; // 0 = testnet, 1 = mainnet
}

interface WalletFailure {
  walletId: string;
  errorType: string; // e.g., "wallet_build_failed", "utxo_fetch_failed", "balance_calculation_failed"
  errorMessage: string; // sanitized error message
  walletStructure?: {
    name: string;
    type: string;
    numRequiredSigners: number;
    signersCount: number;
    hasStakeCredential: boolean;
    hasScriptCbor: boolean;
    isArchived: boolean;
    verified: number;
    hasDRepKeys: boolean;
    // Character counts for key fields
    scriptCborLength: number;
    stakeCredentialLength: number;
    signersAddressesLength: number;
    signersStakeKeysLength: number;
    signersDRepKeysLength: number;
    signersDescriptionsLength: number;
  };
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
  snapshotsStored: number;
  isComplete: boolean;
  startedAt: string;
  lastUpdatedAt: string;
  // Network-specific data
  mainnetWallets: number;
  testnetWallets: number;
  mainnetAdaBalance: number;
  testnetAdaBalance: number;
  // Failure details
  failures: WalletFailure[];
}

interface BatchResponse {
  success: boolean;
  message: string;
  progress: BatchProgress;
  timestamp: string;
}

function getWalletStructure(wallet: DbWallet): WalletFailure['walletStructure'] {
  return {
    name: wallet.name ? wallet.name.substring(0, 5) + (wallet.name.length > 5 ? '...' : '') : 'N/A',
    type: wallet.type || 'unknown',
    numRequiredSigners: wallet.numRequiredSigners || 0,
    signersCount: wallet.signersAddresses?.length || 0,
    hasStakeCredential: !!wallet.stakeCredentialHash,
    hasScriptCbor: !!wallet.scriptCbor,
    isArchived: wallet.isArchived || false,
    verified: wallet.verified?.length || 0, // verified is String[] in schema
    hasDRepKeys: !!(wallet.signersDRepKeys && wallet.signersDRepKeys.length > 0),
    // Character counts for key fields
    scriptCborLength: wallet.scriptCbor?.length || 0,
    stakeCredentialLength: wallet.stakeCredentialHash?.length || 0,
    signersAddressesLength: wallet.signersAddresses?.length || 0,
    signersStakeKeysLength: wallet.signersStakeKeys?.length || 0,
    signersDRepKeysLength: wallet.signersDRepKeys?.length || 0,
    signersDescriptionsLength: wallet.signersDescriptions?.length || 0,
  };
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
    return res.status(401).json({ error: "Unauthorized" });
  }

  const { batchId, batchNumber, batchSize } = req.query;
  const startTime = new Date().toISOString();

  // Helper function to create error response
  const createErrorResponse = (message: string, batchNumber: number = 0, batchSize: number = 0) => ({
    success: false,
    message,
    progress: {
      batchId: (batchId as string) || 'invalid',
      totalBatches: 0,
      currentBatch: batchNumber,
      walletsInBatch: 0,
      processedInBatch: 0,
      failedInBatch: 0,
      totalProcessed: 0,
      totalFailed: 0,
      snapshotsStored: 0,
      isComplete: false,
      startedAt: startTime,
      lastUpdatedAt: new Date().toISOString(),
      mainnetWallets: 0,
      testnetWallets: 0,
      mainnetAdaBalance: 0,
      testnetAdaBalance: 0,
      failures: [],
    },
    timestamp: new Date().toISOString(),
  });

  // Validate batchId parameter
  if (!batchId || typeof batchId !== 'string' || batchId.trim().length === 0) {
    return res.status(400).json(createErrorResponse('batchId parameter is required and must be a non-empty string'));
  }

  if (batchId.length > 100) {
    return res.status(400).json(createErrorResponse('batchId parameter must be 100 characters or less'));
  }

  // Validate batchNumber parameter
  if (!batchNumber || typeof batchNumber !== 'string') {
    return res.status(400).json(createErrorResponse('batchNumber parameter is required and must be a string'));
  }

  const parsedBatchNumber = parseInt(batchNumber, 10);
  
  if (isNaN(parsedBatchNumber)) {
    return res.status(400).json(createErrorResponse('batchNumber must be a valid integer'));
  }

  if (parsedBatchNumber < 1) {
    return res.status(400).json(createErrorResponse('batchNumber must be greater than 0', parsedBatchNumber));
  }

  if (parsedBatchNumber > 10000) {
    return res.status(400).json(createErrorResponse('batchNumber must be 10000 or less', parsedBatchNumber));
  }

  // Validate batchSize parameter
  if (!batchSize || typeof batchSize !== 'string') {
    return res.status(400).json(createErrorResponse('batchSize parameter is required and must be a string'));
  }

  const parsedBatchSize = parseInt(batchSize, 10);
  
  if (isNaN(parsedBatchSize)) {
    return res.status(400).json(createErrorResponse('batchSize must be a valid integer'));
  }

  if (parsedBatchSize < 1) {
    return res.status(400).json(createErrorResponse('batchSize must be greater than 0', parsedBatchNumber, parsedBatchSize));
  }

  if (parsedBatchSize > 5) {
    return res.status(400).json(createErrorResponse('batchSize must be 5 or less', parsedBatchNumber, parsedBatchSize));
  }

  try {
    console.log(`🔄 Starting batch ${parsedBatchNumber} of balance snapshots...`);

    // Step 1: Get total wallet count and calculate batches
    const totalWallets = await db.wallet.count();
    const totalBatches = Math.ceil(totalWallets / parsedBatchSize);
    const currentBatch = parsedBatchNumber;
    const offset = (currentBatch - 1) * parsedBatchSize;

    console.log(`📊 Processing batch ${currentBatch}/${totalBatches} (${parsedBatchSize} wallets per batch)`);

    // Step 2: Fetch wallets for this batch
    const wallets: DbWallet[] = await db.wallet.findMany({
      skip: offset,
      take: parsedBatchSize,
      orderBy: { id: 'asc' }, // Consistent ordering
    });

    if (wallets.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No wallets found in this batch",
        progress: {
          batchId: (batchId as string) || `batch-${currentBatch}`,
          totalBatches,
          currentBatch,
          walletsInBatch: 0,
          processedInBatch: 0,
          failedInBatch: 0,
          totalProcessed: 0,
          totalFailed: 0,
          snapshotsStored: 0,
          isComplete: true,
          startedAt: startTime,
          lastUpdatedAt: new Date().toISOString(),
          // Network-specific data
          mainnetWallets: 0,
          testnetWallets: 0,
          mainnetAdaBalance: 0,
          testnetAdaBalance: 0,
          // Failure details
          failures: [],
        },
        timestamp: new Date().toISOString(),
      });
    }

    // Step 3: Process wallets in this batch
    const walletBalances: WalletBalance[] = [];
    const failures: WalletFailure[] = [];
    let processedInBatch = 0;
    let failedInBatch = 0;
    let mainnetWallets = 0;
    let testnetWallets = 0;
    let mainnetAdaBalance = 0;
    let testnetAdaBalance = 0;

    for (const wallet of wallets) {
      try {
        console.log(`  Processing wallet: (${wallet.id.slice(0, 8)}...)`);

        // Determine network from signer addresses
        let network = 1; // Default to mainnet
        if (wallet.signersAddresses.length > 0) {
          const signerAddr = wallet.signersAddresses[0]!;
          network = addressToNetwork(signerAddr);
        }

        // Build wallet conditionally: use MultisigSDK ordering if signersStakeKeys exist
        let walletAddress: string;
        try {
          const hasStakeKeys = !!(wallet.signersStakeKeys && wallet.signersStakeKeys.length > 0);
          if (hasStakeKeys) {
            // Build MultisigSDK wallet with ordered keys
            const keys: MultisigKey[] = [];
            wallet.signersAddresses.forEach((addr: string, i: number) => {
              if (!addr) return;
              try {
                keys.push({ keyHash: resolvePaymentKeyHash(addr), role: 0, name: wallet.signersDescriptions[i] || "" });
              } catch {}
            });
            wallet.signersStakeKeys?.forEach((stakeKey: string, i: number) => {
              if (!stakeKey) return;
              try {
                keys.push({ keyHash: resolveStakeKeyHash(stakeKey), role: 2, name: wallet.signersDescriptions[i] || "" });
              } catch {}
            });
            if (keys.length === 0 && !wallet.stakeCredentialHash) {
              throw new Error("No valid keys or stakeCredentialHash provided");
            }
            const mWallet = new MultisigWallet(
              wallet.name,
              keys,
              wallet.description ?? "",
              wallet.numRequiredSigners ?? 1,
              network,
              wallet.stakeCredentialHash as undefined | string,
              (wallet.type as any) || "atLeast"
            );
            walletAddress = mWallet.getScript().address;
          } else {
            const builtWallet = buildWallet(wallet, network);
            walletAddress = builtWallet.address;
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown wallet build error';
          console.error(`Failed to build wallet for ${wallet.id.slice(0, 8)}...:`, errorMessage);
          
          failures.push({
            walletId: wallet.id.slice(0, 8),
            errorType: "wallet_build_failed",
            errorMessage: "Unable to build wallet from provided data",
            walletStructure: getWalletStructure(wallet)
          });
          failedInBatch++;
          continue;
        }

        // Determine which address to use
        const blockchainProvider = getProvider(network);
        
        let utxos: UTxO[] = [];
        
        try {
          utxos = await blockchainProvider.fetchAddressUTxOs(walletAddress);
        } catch (utxoError) {
          const errorMessage = utxoError instanceof Error ? utxoError.message : 'Unknown UTxO fetch error';
          console.error(`Failed to fetch UTxOs for wallet ${wallet.id.slice(0, 8)}...:`, errorMessage);
          
          // Track UTxO fetch failures
          failures.push({
            walletId: wallet.id.slice(0, 8),
            errorType: "utxo_fetch_failed",
            errorMessage: "Failed to fetch UTxOs from blockchain",
            walletStructure: getWalletStructure(wallet)
          });
          failedInBatch++;
          continue;
        }
        
        // If we still have no UTxOs, try the other network as fallback
        if (utxos.length === 0) {
          const fallbackNetwork = network === 0 ? 1 : 0;
          try {
            const fallbackProvider = getProvider(fallbackNetwork);
            utxos = await fallbackProvider.fetchAddressUTxOs(walletAddress);
            console.log(`Successfully fetched ${utxos.length} UTxOs for wallet ${wallet.id.slice(0, 8)}... on fallback network ${fallbackNetwork}`);
          } catch (fallbackError) {
            const errorMessage = fallbackError instanceof Error ? fallbackError.message : 'Unknown fallback UTxO fetch error';
            console.error(`Failed to fetch UTxOs for wallet ${wallet.id.slice(0, 8)}... on fallback network ${fallbackNetwork}:`, errorMessage);
            
            // Track fallback UTxO fetch failures
            failures.push({
              walletId: wallet.id.slice(0, 8),
              errorType: "utxo_fetch_failed",
              errorMessage: "Failed to fetch UTxOs from both networks",
              walletStructure: getWalletStructure(wallet)
            });
            failedInBatch++;
            continue;
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
          network,
        };

        walletBalances.push(walletBalance);
        
        // Track network-specific data
        if (network === 1) {
          mainnetWallets++;
          mainnetAdaBalance += roundedAdaBalance;
        } else {
          testnetWallets++;
          testnetAdaBalance += roundedAdaBalance;
        }
        
        processedInBatch++;
        
        console.log(`    ✅ Balance: ${roundedAdaBalance} ADA (${network === 1 ? 'mainnet' : 'testnet'})`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error processing wallet ${wallet.id.slice(0, 8)}...:`, errorMessage);
        
        // Determine error type based on error message
        let errorType = "processing_failed";
        let sanitizedMessage = "Wallet processing failed";
        
        if (errorMessage.includes("fetchAddressUTxOs") || errorMessage.includes("UTxO")) {
          errorType = "utxo_fetch_failed";
          sanitizedMessage = "Failed to fetch UTxOs from blockchain";
        } else if (errorMessage.includes("serializeNativeScript") || errorMessage.includes("address")) {
          errorType = "address_generation_failed";
          sanitizedMessage = "Failed to generate wallet address";
        } else if (errorMessage.includes("balance") || errorMessage.includes("lovelace")) {
          errorType = "balance_calculation_failed";
          sanitizedMessage = "Failed to calculate wallet balance";
        }
        
        failures.push({
          walletId: wallet.id.slice(0, 8),
          errorType,
          errorMessage: sanitizedMessage,
          walletStructure: getWalletStructure(wallet)
        });
        
        failedInBatch++;
      }
    }

    // Step 4: Store snapshots for this batch
    let snapshotsStored = 0;
    if (walletBalances.length > 0) {
      console.log(`💾 Storing ${walletBalances.length} balance snapshots...`);
      
      const snapshotPromises = walletBalances.map(async (walletBalance: WalletBalance) => {
        try {
          await db.balanceSnapshot.create({
            data: {
              walletId: walletBalance.walletId,
              walletName: walletBalance.walletName,
              address: walletBalance.address,
              adaBalance: new Decimal(walletBalance.adaBalance),
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
    const totalProcessed = (currentBatch - 1) * parsedBatchSize + processedInBatch;
    const totalFailed = (currentBatch - 1) * parsedBatchSize + failedInBatch;

    console.log(`📊 Batch ${currentBatch}/${totalBatches} completed:`);
    console.log(`   • Processed: ${processedInBatch}/${wallets.length}`);
    console.log(`   • Failed: ${failedInBatch}`);
    console.log(`   • Snapshots stored: ${snapshotsStored}`);
    console.log(`   • Mainnet: ${mainnetWallets} wallets, ${Math.round(mainnetAdaBalance * 100) / 100} ADA`);
    console.log(`   • Testnet: ${testnetWallets} wallets, ${Math.round(testnetAdaBalance * 100) / 100} ADA`);
    console.log(`   • Overall progress: ${totalProcessed}/${totalWallets} wallets`);

    const progress: BatchProgress = {
      batchId: (batchId as string) || `batch-${currentBatch}`,
      totalBatches,
      currentBatch,
      walletsInBatch: wallets.length,
      processedInBatch,
      failedInBatch,
      totalProcessed,
      totalFailed,
      snapshotsStored,
      isComplete,
      startedAt: startTime,
      lastUpdatedAt: new Date().toISOString(),
      // Network-specific data
      mainnetWallets,
      testnetWallets,
      mainnetAdaBalance,
      testnetAdaBalance,
      // Failure details
      failures,
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
        batchId: (batchId as string) || `batch-${parsedBatchNumber}`,
        totalBatches: 0,
        currentBatch: parsedBatchNumber,
        walletsInBatch: 0,
        processedInBatch: 0,
        failedInBatch: 0,
        totalProcessed: 0,
        totalFailed: 0,
        snapshotsStored: 0,
        isComplete: false,
        startedAt: startTime,
        lastUpdatedAt: new Date().toISOString(),
        // Network-specific data
        mainnetWallets: 0,
        testnetWallets: 0,
        mainnetAdaBalance: 0,
        testnetAdaBalance: 0,
        // Failure details
        failures: [],
      },
      timestamp: new Date().toISOString(),
    });
  }
}
