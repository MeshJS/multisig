#!/usr/bin/env node

/**
 * Batch Snapshot Orchestrator
 * 
 * This script orchestrates the batch processing of wallet snapshots by calling
 * the server-side batch endpoint multiple times until all batches are complete.
 * It handles timeout issues by processing wallets in small batches.
 * 
 * Usage:
 *   npx tsx scripts/batch-snapshot-orchestrator.ts
 *   SNAPSHOT_AUTH_TOKEN=your_token npx tsx scripts/batch-snapshot-orchestrator.ts
 * 
 * Environment Variables:
 *   - API_BASE_URL: Base URL for the API (default: http://localhost:3000)
 *   - SNAPSHOT_AUTH_TOKEN: Authentication token for API requests
 *   - BATCH_SIZE: Number of wallets per batch (default: 5)
 *   - DELAY_BETWEEN_BATCHES: Delay between batches in seconds (default: 10)
 *   - MAX_RETRIES: Maximum retries for failed batches (default: 3)
 *   - REQUEST_TIMEOUT: Request timeout in seconds (default: 45)
 */

interface BatchProgress {
  processedInBatch: number;
  walletsInBatch: number;
  failedInBatch: number;
  snapshotsStored: number;
  totalBatches: number;
  // Network-specific data
  mainnetWallets: number;
  testnetWallets: number;
  mainnetAdaBalance: number;
  testnetAdaBalance: number;
  // Failure details
  failures: Array<{
    walletId: string;
    errorType: string;
    errorMessage: string;
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
      hasClarityApiKey: boolean;
      // Character counts for key fields
      scriptCborLength: number;
      stakeCredentialLength: number;
      signersAddressesLength: number;
      signersStakeKeysLength: number;
      signersDRepKeysLength: number;
      signersDescriptionsLength: number;
      clarityApiKeyLength: number;
    };
  }>;
}

interface BatchResponse {
  success: boolean;
  message?: string;
  progress: BatchProgress;
}

interface BatchResults {
  totalBatches: number;
  completedBatches: number;
  failedBatches: number;
  totalWalletsProcessed: number;
  totalWalletsFailed: number;
  totalSnapshotsStored: number;
  executionTime: number;
  // Network-specific data
  totalMainnetWallets: number;
  totalTestnetWallets: number;
  totalMainnetAdaBalance: number;
  totalTestnetAdaBalance: number;
  // Failure tracking
  allFailures: Array<{
    walletId: string;
    errorType: string;
    errorMessage: string;
    batchNumber: number;
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
      hasClarityApiKey: boolean;
      // Character counts for key fields
      scriptCborLength: number;
      stakeCredentialLength: number;
      signersAddressesLength: number;
      signersStakeKeysLength: number;
      signersDRepKeysLength: number;
      signersDescriptionsLength: number;
      clarityApiKeyLength: number;
    };
  }>;
  failureSummary: Record<string, number>;
}

interface BatchConfig {
  apiBaseUrl: string;
  authToken: string;
  batchSize: number;
  delayBetweenBatches: number;
  maxRetries: number;
  requestTimeout: number; // in seconds
}

interface ApiResponse<T> {
  data: T;
  status: number;
}

class BatchSnapshotOrchestrator {
  private config: BatchConfig;
  private results: BatchResults;

  constructor() {
    this.config = this.loadConfig();
    this.results = {
      totalBatches: 0,
      completedBatches: 0,
      failedBatches: 0,
      totalWalletsProcessed: 0,
      totalWalletsFailed: 0,
      totalSnapshotsStored: 0,
      executionTime: 0,
      // Network-specific data
      totalMainnetWallets: 0,
      totalTestnetWallets: 0,
      totalMainnetAdaBalance: 0,
      totalTestnetAdaBalance: 0,
      // Failure tracking
      allFailures: [],
      failureSummary: {},
    };
  }

  private loadConfig(): BatchConfig {
    const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
    const authToken = process.env.SNAPSHOT_AUTH_TOKEN;

    if (!authToken) {
      throw new Error('SNAPSHOT_AUTH_TOKEN environment variable is required');
    }

    if (authToken.trim().length === 0) {
      throw new Error('SNAPSHOT_AUTH_TOKEN environment variable cannot be empty');
    }

    // Validate API base URL format
    try {
      new URL(apiBaseUrl);
    } catch (error) {
      throw new Error(`Invalid API_BASE_URL format: ${apiBaseUrl}`);
    }

    // Parse and validate numeric environment variables
    const batchSize = this.parseAndValidateNumber(process.env.BATCH_SIZE || '5', 'BATCH_SIZE', 1, 10);
    const delayBetweenBatches = this.parseAndValidateNumber(process.env.DELAY_BETWEEN_BATCHES || '10', 'DELAY_BETWEEN_BATCHES', 1, 300);
    const maxRetries = this.parseAndValidateNumber(process.env.MAX_RETRIES || '3', 'MAX_RETRIES', 1, 10);
    const requestTimeout = this.parseAndValidateNumber(process.env.REQUEST_TIMEOUT || '45', 'REQUEST_TIMEOUT', 10, 300);

    return {
      apiBaseUrl,
      authToken,
      batchSize,
      delayBetweenBatches,
      maxRetries,
      requestTimeout,
    };
  }

  private parseAndValidateNumber(value: string, name: string, min: number, max: number): number {
    const parsed = parseInt(value, 10);
    
    if (isNaN(parsed)) {
      throw new Error(`${name} must be a valid integer, got: ${value}`);
    }
    
    if (parsed < min || parsed > max) {
      throw new Error(`${name} must be between ${min} and ${max}, got: ${parsed}`);
    }
    
    return parsed;
  }

  private async makeRequest<T>(url: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    try {
      // Add configurable timeout to prevent hanging requests
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeout * 1000);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${this.config.authToken}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });
      
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json() as T;
      return { data, status: response.status };
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Request timeout after ${this.config.requestTimeout} seconds`);
      }
      throw error;
    }
  }

  private async delay(seconds: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  private getFriendlyErrorName(errorType: string): string {
    const errorMap: Record<string, string> = {
      'wallet_build_failed': 'Wallet Build Failed',
      'utxo_fetch_failed': 'UTxO Fetch Failed',
      'address_generation_failed': 'Address Generation Failed',
      'balance_calculation_failed': 'Balance Calculation Failed',
      'processing_failed': 'General Processing Failed',
    };
    return errorMap[errorType] || errorType;
  }

  private async processBatch(batchNumber: number, batchId: string): Promise<BatchProgress | null> {
    console.log(`📦 Processing batch ${batchNumber}...`);

    // Validate inputs
    if (!Number.isInteger(batchNumber) || batchNumber < 1) {
      throw new Error(`Invalid batchNumber: ${batchNumber}. Must be a positive integer.`);
    }

    if (!batchId || typeof batchId !== 'string' || batchId.trim().length === 0) {
      throw new Error(`Invalid batchId: ${batchId}. Must be a non-empty string.`);
    }

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const url = new URL(`${this.config.apiBaseUrl}/api/v1/stats/run-snapshots-batch`);
        url.searchParams.set('batchId', batchId);
        url.searchParams.set('batchNumber', batchNumber.toString());
        url.searchParams.set('batchSize', this.config.batchSize.toString());

        const { data } = await this.makeRequest<BatchResponse>(url.toString(), {
          method: 'POST',
        });

        if (data.success) {
          console.log(`✅ Batch ${batchNumber} completed successfully`);
          console.log(`   • Processed: ${data.progress.processedInBatch}/${data.progress.walletsInBatch} wallets`);
          console.log(`   • Failed: ${data.progress.failedInBatch}`);
          console.log(`   • Snapshots stored: ${data.progress.snapshotsStored}`);
          console.log(`   • Mainnet: ${data.progress.mainnetWallets} wallets, ${Math.round(data.progress.mainnetAdaBalance * 100) / 100} ADA`);
          console.log(`   • Testnet: ${data.progress.testnetWallets} wallets, ${Math.round(data.progress.testnetAdaBalance * 100) / 100} ADA`);
          
          // Show failures for this batch
          if (data.progress.failures.length > 0) {
            console.log(`   ❌ Failures in this batch:`);
            data.progress.failures.forEach((failure, index) => {
              console.log(`      ${index + 1}. ${failure.walletId}... - ${failure.errorMessage}`);
              if (failure.walletStructure) {
                const structure = failure.walletStructure;
                console.log(`         📋 Wallet Structure:`);
                console.log(`            • Name: ${structure.name} (${structure.name.length} chars)`);
                console.log(`            • Type: ${structure.type} (${structure.type.length} chars)`);
                console.log(`            • Required Signers: ${structure.numRequiredSigners}/${structure.signersCount}`);
                console.log(`            • Has Stake Credential: ${structure.hasStakeCredential} (${structure.stakeCredentialLength} chars)`);
                console.log(`            • Has Script CBOR: ${structure.hasScriptCbor} (${structure.scriptCborLength} chars)`);
                console.log(`            • Is Archived: ${structure.isArchived}`);
                console.log(`            • Verified Count: ${structure.verified}`);
                console.log(`            • Has DRep Keys: ${structure.hasDRepKeys} (${structure.signersDRepKeysLength} items)`);
                console.log(`            • Has Clarity API Key: ${structure.hasClarityApiKey} (${structure.clarityApiKeyLength} chars)`);
                console.log(`            • Signers Addresses: ${structure.signersAddressesLength} items`);
                console.log(`            • Signers Stake Keys: ${structure.signersStakeKeysLength} items`);
                console.log(`            • Signers Descriptions: ${structure.signersDescriptionsLength} items`);
              }
            });
          }
          
          return data.progress;
        } else {
          throw new Error(data.message || 'Batch processing failed');
        }
      } catch (error) {
        const isLastAttempt = attempt === this.config.maxRetries;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        console.log(`    ⚠️ Batch ${batchNumber} attempt ${attempt}/${this.config.maxRetries} failed: ${errorMessage}`);
        
        if (isLastAttempt) {
          console.error(`❌ Batch ${batchNumber} failed after ${this.config.maxRetries} attempts`);
          return null;
        }
        
        // For 405 errors (Method Not Allowed), wait longer as it might be a server-side issue
        const waitTime = errorMessage.includes('405') ? this.config.delayBetweenBatches * 2 : this.config.delayBetweenBatches;
        console.log(`    ⏳ Waiting ${waitTime}s before retry...`);
        await this.delay(waitTime);
      }
    }

    return null;
  }

  public async run(): Promise<BatchResults> {
    const startTime = Date.now();
    const batchId = `snapshot-${Date.now()}`;
    
    try {
      console.log('🔄 Starting batch snapshot orchestration...');
      console.log(`📊 Configuration: batch_size=${this.config.batchSize}, delay=${this.config.delayBetweenBatches}s`);

      // First, get the total number of batches by processing batch 1
      console.log('📋 Determining total batches...');
      const firstBatch = await this.processBatch(1, batchId);
      
      if (!firstBatch) {
        throw new Error('Failed to process first batch');
      }

      this.results.totalBatches = firstBatch.totalBatches;
      this.results.completedBatches = 1;
      this.results.totalWalletsProcessed += firstBatch.processedInBatch;
      this.results.totalWalletsFailed += firstBatch.failedInBatch;
      this.results.totalSnapshotsStored += firstBatch.snapshotsStored;
      
      // Accumulate network-specific data
      this.results.totalMainnetWallets += firstBatch.mainnetWallets;
      this.results.totalTestnetWallets += firstBatch.testnetWallets;
      this.results.totalMainnetAdaBalance += firstBatch.mainnetAdaBalance;
      this.results.totalTestnetAdaBalance += firstBatch.testnetAdaBalance;
      
      // Accumulate failures
      firstBatch.failures.forEach(failure => {
        this.results.allFailures.push({
          walletId: failure.walletId,
          errorType: failure.errorType,
          errorMessage: failure.errorMessage,
          batchNumber: 1,
          walletStructure: failure.walletStructure
        });
        this.results.failureSummary[failure.errorType] = (this.results.failureSummary[failure.errorType] || 0) + 1;
      });

      console.log(`📊 Total batches to process: ${this.results.totalBatches}`);

      // Process remaining batches
      for (let batchNumber = 2; batchNumber <= this.results.totalBatches; batchNumber++) {
        // Delay between batches to prevent overwhelming the server
        console.log(`⏳ Waiting ${this.config.delayBetweenBatches}s before next batch...`);
        await this.delay(this.config.delayBetweenBatches);

        const batchProgress = await this.processBatch(batchNumber, batchId);
        
        if (batchProgress) {
          this.results.completedBatches++;
          this.results.totalWalletsProcessed += batchProgress.processedInBatch;
          this.results.totalWalletsFailed += batchProgress.failedInBatch;
          this.results.totalSnapshotsStored += batchProgress.snapshotsStored;
          
          // Accumulate network-specific data
          this.results.totalMainnetWallets += batchProgress.mainnetWallets;
          this.results.totalTestnetWallets += batchProgress.testnetWallets;
          this.results.totalMainnetAdaBalance += batchProgress.mainnetAdaBalance;
          this.results.totalTestnetAdaBalance += batchProgress.testnetAdaBalance;
          
          // Accumulate failures
          batchProgress.failures.forEach(failure => {
            this.results.allFailures.push({
              walletId: failure.walletId,
              errorType: failure.errorType,
              errorMessage: failure.errorMessage,
              batchNumber,
              walletStructure: failure.walletStructure
            });
            this.results.failureSummary[failure.errorType] = (this.results.failureSummary[failure.errorType] || 0) + 1;
          });
        } else {
          this.results.failedBatches++;
          console.error(`❌ Batch ${batchNumber} failed completely`);
        }

        // Show progress
        const progressPercent = Math.round((batchNumber / this.results.totalBatches) * 100);
        console.log(`📈 Progress: ${batchNumber}/${this.results.totalBatches} batches (${progressPercent}%)`);
      }

      // Calculate execution time
      this.results.executionTime = Math.round((Date.now() - startTime) / 1000);

      // Final summary
      console.log('\n🎉 Batch snapshot orchestration completed!');
      console.log(`📊 Final Summary:`);
      console.log(`   • Total batches: ${this.results.totalBatches}`);
      console.log(`   • Completed: ${this.results.completedBatches}`);
      console.log(`   • Failed: ${this.results.failedBatches}`);
      console.log(`   • Wallets processed: ${this.results.totalWalletsProcessed}`);
      console.log(`   • Wallets failed: ${this.results.totalWalletsFailed}`);
      console.log(`   • Snapshots stored: ${this.results.totalSnapshotsStored}`);
      console.log(`   • Execution time: ${this.results.executionTime}s`);
      
      // Network-specific breakdown
      console.log(`\n🌐 Network Breakdown:`);
      console.log(`   📈 Mainnet:`);
      console.log(`      • Wallets: ${this.results.totalMainnetWallets}`);
      console.log(`      • TVL: ${Math.round(this.results.totalMainnetAdaBalance * 100) / 100} ADA`);
      console.log(`   🧪 Testnet:`);
      console.log(`      • Wallets: ${this.results.totalTestnetWallets}`);
      console.log(`      • TVL: ${Math.round(this.results.totalTestnetAdaBalance * 100) / 100} ADA`);
      
      // Failure analysis
      if (this.results.totalWalletsFailed > 0) {
        console.log(`\n❌ Failure Summary:`);
        console.log(`   • Total failed wallets: ${this.results.totalWalletsFailed}`);
        
        // Show failure summary by type
        Object.entries(this.results.failureSummary).forEach(([errorType, count]) => {
          const friendlyName = this.getFriendlyErrorName(errorType);
          console.log(`   • ${friendlyName}: ${count} wallets`);
        });
      }

      if (this.results.failedBatches > 0) {
        console.log(`\n⚠️ Warning: ${this.results.failedBatches} batches failed. You may need to retry those batches manually.`);
      }

      return this.results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Batch snapshot orchestration failed:', errorMessage);
      throw error;
    }
  }
}

// Main execution
async function main(): Promise<void> {
  try {
    const orchestrator = new BatchSnapshotOrchestrator();
    await orchestrator.run();
    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Orchestrator execution failed:', errorMessage);
    process.exit(1);
  }
}

// Export for use in other modules
export { BatchSnapshotOrchestrator, type BatchResults, type BatchProgress, type BatchConfig };

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
