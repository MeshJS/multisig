# Stats API Routes

This directory contains the API routes for handling wallet balance snapshots using a batch processing system to avoid timeout issues.

## Recent Updates

This batch processing system addresses timeout issues when processing large numbers of wallets:

- **Solves**: Timeout issues with large wallet counts
- **Improves**: Reliability, monitoring, and error handling
- **Adds**: Comprehensive progress tracking and TVL reporting

## Authentication

All endpoints require authentication using the `SNAPSHOT_AUTH_TOKEN` environment variable:
- **Header**: `Authorization: Bearer <token>`
- **Environment Variable**: `SNAPSHOT_AUTH_TOKEN`

## Routes

### `/api/v1/stats/wallets`
- **Method**: GET
- **Purpose**: Returns all wallet information for batch processing
- **Authentication**: Required (Bearer token)
- **Response**: 
  ```json
  {
    "wallets": [
      {
        "walletId": "string",
        "walletName": "string",
        "description": "string|null",
        "signersAddresses": ["string"],
        "signersStakeKeys": ["string"],
        "signersDRepKeys": ["string"],
        "signersDescriptions": ["string"],
        "numRequiredSigners": number,
        "verified": ["string"],
        "scriptCbor": "string",
        "stakeCredentialHash": "string|null",
        "type": "string",
        "isArchived": boolean,
        "clarityApiKey": "string|null",
        "network": number
      }
    ],
    "walletCount": number,
    "activeWalletCount": number,
    "archivedWalletCount": number
  }
  ```

### `/api/v1/stats/balance`
- **Method**: GET
- **Purpose**: Fetches balance for a single wallet (used internally by batch processing)
- **Authentication**: Required (Bearer token)
- **Query Parameters**: 
  - `walletId` (required) - Wallet ID
  - `walletName` (required) - Wallet name
  - `signersAddresses` (required) - JSON array of signer addresses
  - `numRequiredSigners` (required) - Number of required signers
  - `type` (required) - Wallet type
  - `stakeCredentialHash` (optional) - Stake credential hash
  - `isArchived` (required) - Whether wallet is archived
  - `network` (required) - Network ID (0=testnet, 1=mainnet)
- **Response**: 
  ```json
  {
    "walletBalance": {
      "walletId": "string",
      "walletName": "string",
      "address": "string",
      "balance": {
        "lovelace": "string",
        "assetId": "quantity"
      },
      "adaBalance": number,
      "isArchived": boolean
    }
  }
  ```

### `/api/v1/stats/snapshots`
- **Method**: POST
- **Purpose**: Stores balance snapshots in the database
- **Authentication**: Required (Bearer token)
- **Content-Type**: `application/json`
- **Body**: 
  ```json
  {
    "walletBalances": [
      {
        "walletId": "string",
        "walletName": "string",
        "address": "string", 
        "balance": {
          "lovelace": "string",
          "assetId": "quantity"
        },
        "adaBalance": number,
        "isArchived": boolean
      }
    ]
  }
  ```
- **Response**: 
  ```json
  {
    "snapshotsStored": number,
    "totalWallets": number
  }
  ```

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
      "totalAdaBalance": number,
      "snapshotsStored": number,
      "isComplete": boolean,
      "startedAt": "string",
      "lastUpdatedAt": "string"
    },
    "timestamp": "string"
  }
  ```

## Batch Processing System

The new system processes wallets in small batches to avoid timeout issues:

### How It Works
1. **Batch Processing**: Wallets are processed in configurable batches (default: 10 wallets per batch)
2. **Progress Tracking**: Each batch returns detailed progress information
3. **Resumable**: Can restart from any batch number if needed
4. **Fault Tolerant**: Failed batches can be retried individually

### Orchestrator Script
The `scripts/batch-snapshot-orchestrator.js` script manages the entire process:
- Automatically processes all batches sequentially
- Handles retries for failed batches with exponential backoff
- Provides comprehensive progress reporting with emojis and detailed statistics
- Configurable batch size, delays, and retry attempts
- Calculates and reports total TVL (Total Value Locked) across all wallets
- Tracks execution time and provides final summary
- Exports the `BatchSnapshotOrchestrator` class for programmatic use

### Configuration
- **`API_BASE_URL`**: Base URL for the API (default: http://localhost:3000)
- **`SNAPSHOT_AUTH_TOKEN`**: Authentication token for API requests (required)
- **`BATCH_SIZE`**: Wallets per batch (default: 10)
- **`DELAY_BETWEEN_BATCHES`**: Seconds between batches (default: 5)
- **`MAX_RETRIES`**: Retry attempts for failed batches (default: 3)

## GitHub Actions Integration

The daily balance snapshots workflow (`.github/workflows/daily-balance-snapshots.yml`) uses:
1. **Batch Orchestrator**: Runs `scripts/batch-snapshot-orchestrator.js`
2. **No Timeout Issues**: Each batch completes in under 30 seconds
3. **Comprehensive Reporting**: Detailed progress and final statistics
4. **Manual Trigger**: Currently configured for manual triggering only (schedule disabled for testing)

**Note**: The workflow is currently set to manual trigger only. To enable daily automatic snapshots, uncomment the schedule section in the workflow file.

## Error Handling

- **401 Unauthorized**: Invalid or missing authentication token
- **400 Bad Request**: Missing required parameters
- **405 Method Not Allowed**: Incorrect HTTP method
- **500 Internal Server Error**: Server-side processing errors

## Database Schema

The snapshots are stored in the `balanceSnapshot` table with the following structure:
- `walletId`: Wallet identifier
- `walletName`: Human-readable wallet name
- `address`: Wallet address used for balance calculation
- `adaBalance`: ADA balance in ADA units
- `assetBalances`: JSON object containing all asset balances
- `isArchived`: Whether the wallet is archived
- `createdAt`: Timestamp of snapshot creation

## Testing

You can test the batch processing system by running the orchestrator script directly:

```bash
# Set your authentication token
export SNAPSHOT_AUTH_TOKEN=your_token_here

# Run the orchestrator (uses localhost by default)
node scripts/batch-snapshot-orchestrator.js

# Or with custom configuration
API_BASE_URL=https://your-api-url.com \
BATCH_SIZE=5 \
DELAY_BETWEEN_BATCHES=10 \
MAX_RETRIES=5 \
node scripts/batch-snapshot-orchestrator.js
```

The orchestrator will:
- Process all wallets in configurable batches
- Provide detailed progress reporting
- Handle retries for failed batches
- Show comprehensive final statistics including total TVL