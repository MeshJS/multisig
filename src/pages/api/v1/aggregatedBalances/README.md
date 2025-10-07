# AggregatedBalances API Routes

This directory contains the modular API routes for handling wallet balance aggregation and snapshots. These endpoints are designed to work together to provide comprehensive wallet balance tracking with rate limiting and error handling capabilities.

## Authentication

All endpoints require authentication using the `SNAPSHOT_AUTH_TOKEN` environment variable:
- **Header**: `Authorization: Bearer <token>`
- **Environment Variable**: `SNAPSHOT_AUTH_TOKEN`

## Routes

### `/api/v1/aggregatedBalances/wallets`
- **Method**: GET
- **Purpose**: Returns all wallet information without fetching balances or building wallet objects
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

### `/api/v1/aggregatedBalances/balance`
- **Method**: GET
- **Purpose**: Fetches balance for a single wallet (builds wallet and generates addresses internally)
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

### `/api/v1/aggregatedBalances/snapshots`
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

### `/api/v1/aggregatedBalances/test`
- **Method**: GET
- **Purpose**: Comprehensive test endpoint that validates all sub-routes with real data
- **Authentication**: Required (Bearer token)
- **Response**: 
  ```json
  {
    "message": "string",
    "timestamp": "string",
    "endpoints": {
      "wallets": "string",
      "balance": "string", 
      "snapshots": "string"
    },
    "usage": {
      "wallets": "string",
      "balance": "string",
      "snapshots": "string"
    },
    "realData": {
      "walletsFound": number,
      "processedWallets": number,
      "failedWallets": number,
      "totalAdaBalance": number,
      "sampleWallet": {
        "id": "string",
        "name": "string",
        "adaBalance": number
      },
      "snapshotsStored": number
    }
  }
  ```

## Features

The modular approach provides several advantages:

1. **Rate Limit Mitigation**: Individual wallet balance requests can be spaced out to respect API limits
2. **Better Error Handling**: Failed wallet processing doesn't affect other wallets
3. **Modularity**: Each endpoint has a single responsibility
4. **Comprehensive Testing**: The test endpoint validates the entire workflow with real data
5. **Fallback Network Support**: Balance endpoint tries alternative networks if primary fails
6. **Batch Processing**: Snapshots endpoint handles multiple wallets efficiently

## GitHub Actions Integration

The daily balance snapshots workflow (`.github/workflows/daily-balance-snapshots.yml`) uses these endpoints in sequence:

1. **Fetch Wallets**: Uses `/wallets` to get all wallet information
2. **Process Balances**: Uses `/balance` for each wallet with rate limiting:
   - Batch size: 3 wallets per batch
   - Delay between requests: 3 seconds
   - Delay between batches: 15 seconds
   - Max retries: 3 attempts
3. **Store Snapshots**: Uses `/snapshots` to persist all collected balances

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
