#!/usr/bin/env node

/**
 * Batch Snapshot Orchestrator
 * 
 * This script orchestrates the batch processing of wallet snapshots by calling
 * the server-side batch endpoint multiple times until all batches are complete.
 * It handles timeout issues by processing wallets in small batches.
 * 
 * Usage:
 *   node scripts/batch-snapshot-orchestrator.js
 *   SNAPSHOT_AUTH_TOKEN=your_token node scripts/batch-snapshot-orchestrator.js
 * 
 * Environment Variables:
 *   - API_BASE_URL: Base URL for the API (default: http://localhost:3000)
 *   - SNAPSHOT_AUTH_TOKEN: Authentication token for API requests
 *   - BATCH_SIZE: Number of wallets per batch (default: 10)
 *   - DELAY_BETWEEN_BATCHES: Delay between batches in seconds (default: 5)
 *   - MAX_RETRIES: Maximum retries for failed batches (default: 3)
 */

class BatchSnapshotOrchestrator {
  constructor() {
    this.config = this.loadConfig();
    this.results = {
      totalBatches: 0,
      completedBatches: 0,
      failedBatches: 0,
      totalWalletsProcessed: 0,
      totalWalletsFailed: 0,
      totalAdaBalance: 0,
      totalSnapshotsStored: 0,
      executionTime: 0,
    };
  }

  loadConfig() {
    const apiBaseUrl = process.env.API_BASE_URL || 'http://localhost:3000';
    const authToken = process.env.SNAPSHOT_AUTH_TOKEN;

    if (!authToken) {
      throw new Error('SNAPSHOT_AUTH_TOKEN environment variable is required');
    }

    return {
      apiBaseUrl,
      authToken,
      batchSize: parseInt(process.env.BATCH_SIZE || '10'),
      delayBetweenBatches: parseInt(process.env.DELAY_BETWEEN_BATCHES || '5'),
      maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
    };
  }

  async makeRequest(/** @type {string} */ url, /** @type {RequestInit} */ options = {}) {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.config.authToken}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return { data, status: response.status };
    } catch (error) {
      throw error;
    }
  }

  async delay(/** @type {number} */ seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  async processBatch(/** @type {number} */ batchNumber, /** @type {string} */ batchId) {
    console.log(`📦 Processing batch ${batchNumber}...`);

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const { data } = await this.makeRequest(
          `${this.config.apiBaseUrl}/api/v1/stats/run-snapshots-batch`,
          {
            method: 'POST',
            body: JSON.stringify({
              batchId,
              batchNumber,
              batchSize: this.config.batchSize,
            }),
          }
        );

        if (data.success) {
          console.log(`✅ Batch ${batchNumber} completed successfully`);
          console.log(`   • Processed: ${data.progress.processedInBatch}/${data.progress.walletsInBatch} wallets`);
          console.log(`   • Failed: ${data.progress.failedInBatch}`);
          console.log(`   • Snapshots stored: ${data.progress.snapshotsStored}`);
          console.log(`   • Batch ADA balance: ${Math.round(data.progress.totalAdaBalance * 100) / 100} ADA`);
          
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
        
        // Wait before retry
        await this.delay(this.config.delayBetweenBatches);
      }
    }

    return null;
  }

  async run() {
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
      this.results.totalAdaBalance += firstBatch.totalAdaBalance;
      this.results.totalSnapshotsStored += firstBatch.snapshotsStored;

      console.log(`📊 Total batches to process: ${this.results.totalBatches}`);

      // Process remaining batches
      for (let batchNumber = 2; batchNumber <= this.results.totalBatches; batchNumber++) {
        // Delay between batches to prevent overwhelming the server
        if (batchNumber > 2) {
          console.log(`⏳ Waiting ${this.config.delayBetweenBatches}s before next batch...`);
          await this.delay(this.config.delayBetweenBatches);
        }

        const batchProgress = await this.processBatch(batchNumber, batchId);
        
        if (batchProgress) {
          this.results.completedBatches++;
          this.results.totalWalletsProcessed += batchProgress.processedInBatch;
          this.results.totalWalletsFailed += batchProgress.failedInBatch;
          this.results.totalAdaBalance += batchProgress.totalAdaBalance;
          this.results.totalSnapshotsStored += batchProgress.snapshotsStored;
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
      console.log(`   • Total TVL: ${Math.round(this.results.totalAdaBalance * 100) / 100} ADA`);
      console.log(`   • Execution time: ${this.results.executionTime}s`);

      if (this.results.failedBatches > 0) {
        console.log(`⚠️ Warning: ${this.results.failedBatches} batches failed. You may need to retry those batches manually.`);
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
async function main() {
  try {
    const orchestrator = new BatchSnapshotOrchestrator();
    await orchestrator.run();
    process.exit(0);
  } catch (error) {
    console.error('❌ Orchestrator execution failed:', error);
    process.exit(1);
  }
}

// Export for use in other modules
export { BatchSnapshotOrchestrator };

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
