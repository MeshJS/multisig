# Stats API Routes

This directory contains the API route for handling wallet balance snapshots using a batch processing system to avoid timeout issues.

## Overview

The batch processing system addresses timeout issues when processing large numbers of wallets by:

- **Solves**: Timeout issues with large wallet counts
- **Improves**: Reliability, monitoring, and error handling
- **Adds**: Comprehensive progress tracking and TVL reporting
- **Consolidates**: All snapshot functionality into a single, efficient endpoint
- **Enhances**: Type safety, input validation, and configurable timeouts

## Authentication

The endpoint requires authentication using the `SNAPSHOT_AUTH_TOKEN` environment variable:
- **Header**: `Authorization: Bearer <token>`
- **Environment Variable**: `SNAPSHOT_AUTH_TOKEN`

## Route

### `/api/v1/stats/run-snapshots-batch`
- **Method**: POST
- **Purpose**: Processes a batch of wallets for balance snapshots (main endpoint)
- **Authentication**: Required (Bearer token)
- **Content-Type**: `application/json`
- **Body**: 
  ```json
  {
    "batchId": "string",
    "batchNumber": number,
    "batchSize": number
  }
  ```
- **Query Parameters**:
  - `batchId`: Unique identifier for the batch session
  - `batchNumber`: Current batch number (1-based, must be ≥ 1)
  - `batchSize`: Number of wallets per batch (1-5)
- **Response**: 
  ```json
  {
    "success": boolean,
    "message": "string",
    "progress": {
      "batchId": "string",
      "totalBatches": number,
      "currentBatch": number,
      "walletsInBatch": number,
      "processedInBatch": number,
      "failedInBatch": number,
      "totalProcessed": number,
      "totalFailed": number,
      "snapshotsStored": number,
      "isComplete": boolean,
      "startedAt": "string",
      "lastUpdatedAt": "string",
      "mainnetWallets": number,
      "testnetWallets": number,
      "mainnetAdaBalance": number,
      "testnetAdaBalance": number,
      "failures": [
        {
          "walletId": "string",
          "errorType": "string",
          "errorMessage": "string",
          "walletStructure": {
            "name": "string",
            "type": "string",
            "numRequiredSigners": number,
            "signersCount": number,
            "hasStakeCredential": boolean,
            "hasScriptCbor": boolean,
            "isArchived": boolean,
            "verified": number,
            "hasDRepKeys": boolean,
            "hasClarityApiKey": boolean
          }
        }
      ]
    },
    "timestamp": "string"
  }
  ```

## Batch Processing System

The new system processes wallets in small batches to avoid timeout issues:

### How It Works
1. **Batch Processing**: Wallets are processed in configurable batches (default: 5 wallets per batch)
2. **Progress Tracking**: Each batch returns detailed progress information including network-specific data
3. **Resumable**: Can restart from any batch number if needed
4. **Fault Tolerant**: Failed batches can be retried individually
5. **Input Validation**: Comprehensive validation for batch parameters
6. **Error Tracking**: Detailed error reporting with wallet structure information

### Orchestrator Script
The `scripts/batch-snapshot-orchestrator.ts` script manages the entire process:
- Automatically processes all batches sequentially
- Handles retries for failed batches with exponential backoff
- Provides comprehensive progress reporting with emojis and detailed statistics
- Configurable batch size, delays, retry attempts, and request timeouts
- Calculates and reports total TVL (Total Value Locked) across all wallets
- Tracks execution time and provides final summary
- Exports the `BatchSnapshotOrchestrator` class for programmatic use
- Enhanced error handling with detailed failure analysis

### Configuration
- **`API_BASE_URL`**: Base URL for the API (default: http://localhost:3000)
- **`SNAPSHOT_AUTH_TOKEN`**: Authentication token for API requests (required)
- **`BATCH_SIZE`**: Wallets per batch (default: 5, range: 1-5)
- **`DELAY_BETWEEN_BATCHES`**: Seconds between batches (default: 10)
- **`MAX_RETRIES`**: Retry attempts for failed batches (default: 3)
- **`REQUEST_TIMEOUT`**: Request timeout in seconds (default: 60)

## GitHub Actions Integration

The daily balance snapshots workflow (`.github/workflows/daily-balance-snapshots.yml`) uses:
1. **Batch Orchestrator**: Runs `scripts/batch-snapshot-orchestrator.ts`
2. **No Timeout Issues**: Each batch completes within configurable timeout
3. **Comprehensive Reporting**: Detailed progress and final statistics
4. **Enhanced Configuration**: Configurable batch size, delays, retries, and timeouts
5. **Manual Trigger**: Currently configured for manual triggering only (schedule disabled for testing)

**Note**: The workflow is currently set to manual trigger only. To enable daily automatic snapshots, uncomment the schedule section in the workflow file.

## Error Handling

- **401 Unauthorized**: Invalid or missing authentication token
- **400 Bad Request**: Missing required parameters or invalid batch parameters
- **405 Method Not Allowed**: Incorrect HTTP method
- **500 Internal Server Error**: Server-side processing errors

### Error Types Tracked
- **`wallet_build_failed`**: Unable to build multisig wallet from provided data
- **`utxo_fetch_failed`**: Failed to fetch UTxOs from blockchain
- **`address_generation_failed`**: Failed to generate wallet address
- **`balance_calculation_failed`**: Failed to calculate wallet balance
- **`processing_failed`**: General processing failure

## Database Schema

The snapshots are stored in the `balanceSnapshot` table with the following structure:
- `id`: Unique identifier (auto-generated)
- `walletId`: Wallet identifier
- `walletName`: Human-readable wallet name
- `address`: Wallet address used for balance calculation
- `adaBalance`: ADA balance in ADA units (Decimal type)
- `assetBalances`: JSON object containing all asset balances
- `isArchived`: Whether the wallet is archived
- `snapshotDate`: Timestamp of snapshot creation (auto-generated)

## Testing

You can test the batch processing system by running the orchestrator script directly:

```bash
# Set your authentication token
export SNAPSHOT_AUTH_TOKEN=your_token_here

# Run the orchestrator (uses localhost by default)
npx tsx scripts/batch-snapshot-orchestrator.ts

# Or with custom configuration
API_BASE_URL=https://your-api-url.com \
BATCH_SIZE=5 \
DELAY_BETWEEN_BATCHES=10 \
MAX_RETRIES=3 \
REQUEST_TIMEOUT=60 \
npx tsx scripts/batch-snapshot-orchestrator.ts
```

The orchestrator will:
- Process all wallets in configurable batches
- Provide detailed progress reporting with network-specific data
- Handle retries for failed batches with configurable timeouts
- Show comprehensive final statistics including total TVL
- Track and report detailed failure information

## Recent Improvements

### Type Safety & Validation
- **Fixed Decimal Type**: Proper handling of Decimal types in database operations
- **Input Validation**: Comprehensive validation for batch parameters (batch number ≥ 1, batch size 1-100)
- **Error Tracking**: Enhanced error handling with detailed wallet structure information

### Configuration & Reliability
- **Configurable Timeouts**: Request timeout now configurable via `REQUEST_TIMEOUT` environment variable
- **Enhanced Error Handling**: UTxO fetch failures are now properly tracked and reported
- **Network-Specific Reporting**: Separate tracking for mainnet and testnet wallets and balances
- **Improved Documentation**: Updated documentation to reflect all recent changes