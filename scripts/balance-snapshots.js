#!/usr/bin/env node

/**
 * Balance Snapshots Script (JavaScript version)
 * 
 * This script fetches wallet balances and stores them as snapshots in the database.
 * It can be run locally for testing or by GitHub Actions for automated snapshots.
 * 
 * Usage:
 *   node scripts/balance-snapshots.js
 *   SNAPSHOT_AUTH_TOKEN=your_token node scripts/balance-snapshots.js
 * 
 * Environment Variables:
 *   - API_BASE_URL: Base URL for the API (default: http://localhost:3000)
 *   - SNAPSHOT_AUTH_TOKEN: Authentication token for API requests
 *   - BATCH_SIZE: Number of wallets to process per batch (default: 3)
 *   - DELAY_BETWEEN_REQUESTS: Delay between requests in seconds (default: 3)
 *   - DELAY_BETWEEN_BATCHES: Delay between batches in seconds (default: 15)
 *   - MAX_RETRIES: Maximum retries for failed requests (default: 3)
 *   - REQUEST_TIMEOUT: Request timeout in seconds (default: 30)
 */

class BalanceSnapshotService {
  constructor() {
    this.config = this.loadConfig();
    this.results = {
      walletsFound: 0,
      processedWallets: 0,
      failedWallets: 0,
      totalAdaBalance: 0,
      snapshotsStored: 0,
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
      batchSize: parseInt(process.env.BATCH_SIZE || '3'),
      delayBetweenRequests: parseInt(process.env.DELAY_BETWEEN_REQUESTS || '3'),
      delayBetweenBatches: parseInt(process.env.DELAY_BETWEEN_BATCHES || '15'),
      maxRetries: parseInt(process.env.MAX_RETRIES || '3'),
      requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '30'),
    };
  }

  async makeRequest(/** @type {string} */ url, /** @type {RequestInit} */ options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.requestTimeout * 1000);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Authorization': `Bearer ${this.config.authToken}`,
          'Content-Type': 'application/json',
          ...(options.headers || {}),
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return { data, status: response.status };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async delay(/** @type {number} */ seconds) {
    return new Promise(resolve => setTimeout(resolve, seconds * 1000));
  }

  async fetchWallets() {
    console.log('📋 Fetching all wallets...');
    
    const { data } = await this.makeRequest(
      `${this.config.apiBaseUrl}/api/v1/aggregatedBalances/wallets`
    );

    console.log(`✅ Found ${data.walletCount} wallets`);
    this.results.walletsFound = data.walletCount;

    if (data.walletCount === 0) {
      console.log('ℹ️ No wallets found, skipping snapshot process');
      return [];
    }

    return data.wallets;
  }

  async fetchWalletBalance(/** @type {any} */ wallet) {
    const params = new URLSearchParams({
      walletId: wallet.walletId,
      walletName: wallet.walletName,
      signersAddresses: JSON.stringify(wallet.signersAddresses),
      numRequiredSigners: wallet.numRequiredSigners.toString(),
      type: wallet.type,
      stakeCredentialHash: wallet.stakeCredentialHash || '',
      isArchived: wallet.isArchived.toString(),
      network: wallet.network.toString(),
    });

    const url = `${this.config.apiBaseUrl}/api/v1/aggregatedBalances/balance?${params}`;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const { data } = await this.makeRequest(url);
        console.log(`    ✅ Balance: ${data.walletBalance.adaBalance} ADA`);
        return data.walletBalance;
      } catch (error) {
        const isLastAttempt = attempt === this.config.maxRetries;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        if (errorMessage.includes('429')) {
          // Rate limited - wait longer before retry
          const retryDelay = this.config.delayBetweenRequests * attempt * 2;
          console.log(`    ⚠️ Rate limited (429). Waiting ${retryDelay}s before retry ${attempt}/${this.config.maxRetries}`);
          await this.delay(retryDelay);
        } else {
          console.log(`    ❌ Failed to fetch balance for wallet ${wallet.walletId}: ${errorMessage}`);
          if (isLastAttempt) {
            return null;
          }
        }
      }
    }

    return null;
  }

  async processWalletsInBatches(/** @type {any[]} */ wallets) {
    console.log(`💰 Fetching balances for ${wallets.length} wallets with rate limiting...`);
    console.log(`📊 Configuration: batch_size=${this.config.batchSize}, request_delay=${this.config.delayBetweenRequests}s, batch_delay=${this.config.delayBetweenBatches}s`);

    const walletBalances = [];
    const totalBatches = Math.ceil(wallets.length / this.config.batchSize);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const batchStart = batchIndex * this.config.batchSize;
      const batchEnd = Math.min(batchStart + this.config.batchSize, wallets.length);
      const batchWallets = wallets.slice(batchStart, batchEnd);

      console.log(`📦 Processing batch ${batchIndex + 1}/${totalBatches}: wallets ${batchStart + 1}-${batchEnd}`);

      for (let i = 0; i < batchWallets.length; i++) {
        const wallet = batchWallets[i];
        if (!wallet) continue;
        
        console.log(`  Processing wallet: ${wallet.walletName} (${wallet.walletId})`);

        const walletBalance = await this.fetchWalletBalance(wallet);
        
        if (walletBalance) {
          walletBalances.push(walletBalance);
          this.results.totalAdaBalance += walletBalance.adaBalance;
          this.results.processedWallets++;
        } else {
          this.results.failedWallets++;
        }

        // Delay between requests within a batch (except for the last request)
        if (i < batchWallets.length - 1) {
          await this.delay(this.config.delayBetweenRequests);
        }
      }

      // Delay between batches (except for the last batch)
      if (batchIndex < totalBatches - 1) {
        console.log(`  ⏳ Waiting ${this.config.delayBetweenBatches}s before next batch...`);
        await this.delay(this.config.delayBetweenBatches);
      }
    }

    console.log(`📊 Balance fetching completed. Failed wallets: ${this.results.failedWallets}`);
    console.log(`✅ Successfully processed: ${walletBalances.length} wallets`);

    return walletBalances;
  }

  async storeSnapshots(/** @type {any[]} */ walletBalances) {
    console.log('💾 Storing balance snapshots...');

    const { data } = await this.makeRequest(
      `${this.config.apiBaseUrl}/api/v1/aggregatedBalances/snapshots`,
      {
        method: 'POST',
        body: JSON.stringify({ walletBalances }),
      }
    );

    this.results.snapshotsStored = data.snapshotsStored;
    console.log(`✅ Successfully stored ${data.snapshotsStored} balance snapshots`);
  }

  async run() {
    const startTime = Date.now();
    
    try {
      console.log('🔄 Starting daily balance snapshot process...');

      // Step 1: Fetch all wallets
      const wallets = await this.fetchWallets();
      
      if (wallets.length === 0) {
        console.log('ℹ️ No wallets to process');
        return this.results;
      }

      // Step 2: Process wallets in batches
      const walletBalances = await this.processWalletsInBatches(wallets);

      // Step 3: Store snapshots
      if (walletBalances.length > 0) {
        await this.storeSnapshots(walletBalances);
      }

      // Calculate execution time
      this.results.executionTime = Math.round((Date.now() - startTime) / 1000);

      // Final summary
      console.log('\n🎉 Balance snapshot process completed successfully!');
      console.log(`📊 Summary:`);
      console.log(`   • Wallets found: ${this.results.walletsFound}`);
      console.log(`   • Processed: ${this.results.processedWallets}`);
      console.log(`   • Failed: ${this.results.failedWallets}`);
      console.log(`   • Snapshots stored: ${this.results.snapshotsStored}`);
      console.log(`   • Total TVL: ${Math.round(this.results.totalAdaBalance * 100) / 100} ADA`);
      console.log(`   • Execution time: ${this.results.executionTime}s`);

      return this.results;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('❌ Balance snapshot process failed:', errorMessage);
      throw error;
    }
  }
}

// Main execution
async function main() {
  try {
    const service = new BalanceSnapshotService();
    await service.run();
    process.exit(0);
  } catch (error) {
    console.error('❌ Script execution failed:', error);
    process.exit(1);
  }
}

// Export for use in other modules
export { BalanceSnapshotService };

// Run if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}