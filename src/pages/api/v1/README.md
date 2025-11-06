# API v1 Directory

A comprehensive REST API implementation for the multisig wallet application, providing secure endpoints for wallet management, transaction handling, authentication, and blockchain interactions. This API follows RESTful principles with JWT-based authentication and comprehensive error handling.

## Authentication & Security

### JWT-Based Authentication

- **Bearer Token Authentication**: All endpoints require valid JWT tokens
- **Address-Based Authorization**: Token payload contains user address for authorization
- **Session Management**: 1-hour token expiration with automatic renewal
- **CORS Support**: Cross-origin resource sharing enabled for web clients
- **Address Validation**: Strict address matching between token and request parameters

### Security Features

- **Input Validation**: Comprehensive parameter validation and sanitization
- **Error Handling**: Detailed error responses without sensitive information exposure
- **Rate Limiting**: Built-in protection against abuse (via CORS and validation)
- **Signature Verification**: Cryptographic signature validation for sensitive operations

## Core API Endpoints

### Transaction Management

#### `addTransaction.ts` - POST `/api/v1/addTransaction`

- **Purpose**: Submit external transactions for multisig wallet processing
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - Transaction submission with CBOR and JSON formats
  - Automatic blockchain submission for single-signer wallets
  - Multisig transaction queuing for multi-signer wallets
  - Address validation and authorization
  - Callback URL support for external integrations
- **Request Body**:
  - `walletId`: Wallet identifier
  - `address`: Signer address
  - `txCbor`: Transaction in CBOR format
  - `txJson`: Transaction in JSON format
  - `description`: Optional transaction description
  - `callbackUrl`: Optional callback URL
- **Response**: Transaction object with ID, state, and metadata
- **Error Handling**: 400 (validation), 401 (auth), 403 (authorization), 500 (server)

#### `signTransaction.ts` - POST `/api/v1/signTransaction`

- **Purpose**: Record a signature for a pending multisig transaction
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - Signature tracking with duplicate and rejection safeguards
  - Wallet membership validation and JWT address enforcement
  - Threshold detection with automatic submission when the final signature is collected
- **Request Body**:
  - `walletId`: Wallet identifier
  - `transactionId`: Pending transaction identifier
  - `address`: Signer address
  - `signedTx`: CBOR transaction payload after applying the signature
- **Response**: Updated transaction record with threshold status metadata; includes `txHash` when submission succeeds
- **Error Handling**: 400 (validation), 401 (auth), 403 (authorization), 404 (not found), 409 (duplicate/rejected), 502 (submission failure), 500 (server)

#### `pendingTransactions.ts` - GET `/api/v1/pendingTransactions`

- **Purpose**: Retrieve all pending multisig transactions for a wallet
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - Wallet ownership validation and JWT address enforcement
  - Pending transaction listing with signature status metadata
  - Supports multisig coordination for outstanding approvals
- **Query Parameters**:
  - `walletId`: Wallet identifier
  - `address`: Requester address (must match JWT payload)
- **Response**: Array of pending transaction objects with signature state details
- **Error Handling**: 400 (validation), 401 (auth), 403 (authorization), 404 (not found), 405 (method), 500 (server)

#### `submitDatum.ts` - POST `/api/v1/submitDatum`

- **Purpose**: Submit signable payloads for multisig signature collection
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - Cryptographic signature verification
  - Signable payload creation and management
  - Multi-signature collection workflow
  - Remote origin tracking for external integrations
  - Callback URL support for completion notifications
- **Request Body**:
  - `walletId`: Wallet identifier
  - `address`: Signer address
  - `datum`: Signable payload data
  - `signature`: Cryptographic signature
  - `key`: Public key for signature verification
  - `description`: Optional description
  - `callbackUrl`: Optional callback URL
- **Response**: Signable object with ID, signatures, and state
- **Error Handling**: 400 (validation), 401 (auth/signature), 403 (authorization), 500 (server)

### Wallet Management

#### `walletIds.ts` - GET `/api/v1/walletIds`

- **Purpose**: Retrieve all wallet IDs and names for a user address
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - User wallet enumeration
  - Address-based authorization
  - Wallet metadata retrieval
  - Empty result handling
- **Query Parameters**:
  - `address`: User address for wallet lookup
- **Response**: Array of wallet objects with ID and name
- **Error Handling**: 400 (validation), 401 (auth), 403 (authorization), 404 (not found), 500 (server)

#### `nativeScript.ts` - GET `/api/v1/nativeScript`

- **Purpose**: Generate native scripts for multisig wallet operations
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - Multisig script generation for different roles
  - Payment, staking, and DRep script support
  - Wallet validation and construction
  - Role-based script filtering
- **Query Parameters**:
  - `walletId`: Wallet identifier
  - `address`: User address for authorization
- **Response**: Array of script objects with type and script data
- **Error Handling**: 400 (validation), 401 (auth), 403 (authorization), 404 (not found), 500 (server)

#### `lookupMultisigWallet.ts` - GET `/api/v1/lookupMultisigWallet`

- **Purpose**: Lookup multisig wallet metadata using public key hashes
- **Authentication**: Not required (public endpoint)
- **Features**:
  - Blockchain metadata querying
  - CIP-1854 metadata label support
  - Public key hash matching
  - Network-specific queries
- **Query Parameters**:
  - `pubKeyHashes`: Comma-separated public key hashes
  - `network`: Network identifier (optional, defaults to mainnet)
- **Response**: Array of matching metadata items
- **Error Handling**: 400 (validation), 500 (server)

### UTxO Management

#### `freeUtxos.ts` - GET `/api/v1/freeUtxos`

- **Purpose**: Retrieve unblocked UTxOs for a multisig wallet
- **Authentication**: Required (JWT Bearer token)
- **Features**:
  - UTxO fetching from blockchain
  - Pending transaction filtering
  - Double-spend prevention
  - Network-specific UTxO retrieval
  - Address validation and authorization
- **Query Parameters**:
  - `walletId`: Wallet identifier
  - `address`: User address for authorization
- **Response**: Array of free UTxO objects
- **Error Handling**: 400 (validation), 401 (auth), 403 (authorization), 404 (not found), 500 (server)

### Authentication Endpoints

#### `getNonce.ts` - GET `/api/v1/getNonce`

- **Purpose**: Request authentication nonce for address-based signing
- **Authentication**: Not required (public endpoint)
- **Features**:
  - Cryptographically secure nonce generation
  - User address validation
  - Nonce storage and management
  - Duplicate nonce prevention
- **Query Parameters**:
  - `address`: User address for nonce generation
- **Response**: Nonce object with value
- **Error Handling**: 400 (validation), 404 (user not found), 500 (server)

#### `authSigner.ts` - POST `/api/v1/authSigner`

- **Purpose**: Verify signed nonce and return JWT bearer token
- **Authentication**: Not required (public endpoint)
- **Features**:
  - Cryptographic signature verification
  - JWT token generation
  - Nonce cleanup after verification
  - Secure token expiration
- **Request Body**:
  - `address`: User address
  - `signature`: Signed nonce signature
  - `key`: Public key for verification
- **Response**: JWT token object
- **Error Handling**: 400 (validation), 401 (signature), 500 (server)

### Utility Endpoints

#### `og.ts` - GET `/api/v1/og`

- **Purpose**: Extract Open Graph metadata from URLs
- **Authentication**: Not required (public endpoint)
- **Features**:
  - HTML parsing and metadata extraction
  - Open Graph protocol support
  - Fallback to standard meta tags
  - Title, description, image, and site name extraction
- **Query Parameters**:
  - `url`: URL to extract metadata from
- **Response**: Metadata object with title, description, image, siteName, and url
- **Error Handling**: 400 (validation), 500 (server)

## API Architecture

### Request/Response Patterns

- **RESTful Design**: Standard HTTP methods and status codes
- **JSON Format**: All requests and responses use JSON
- **Error Consistency**: Standardized error response format
- **CORS Support**: Cross-origin requests enabled

### Authentication Flow

1. **Nonce Request**: Client requests nonce for address
2. **Signature Generation**: Client signs nonce with private key
3. **Token Exchange**: Client exchanges signature for JWT token
4. **API Access**: Client uses JWT token for authenticated requests

### Error Handling

- **HTTP Status Codes**: Proper status code usage
- **Error Messages**: Descriptive error messages
- **Validation Errors**: Detailed parameter validation
- **Security Errors**: Authentication and authorization failures
- **Server Errors**: Internal server error handling

### Database Integration

- **Prisma ORM**: Type-safe database operations
- **Transaction Management**: Database transaction handling
- **Data Validation**: Input validation and sanitization
- **Error Recovery**: Graceful error handling and recovery

## Security Considerations

### Input Validation

- **Parameter Validation**: All input parameters validated
- **Type Checking**: Strict type validation for all inputs
- **Address Validation**: Cardano address format validation
- **Signature Verification**: Cryptographic signature validation

### Authorization

- **Address Matching**: Token address must match request address
- **Wallet Access**: Users can only access their own wallets
- **Resource Protection**: Sensitive operations require authentication
- **Session Management**: Token expiration and renewal

### Data Protection

- **Sensitive Data**: No sensitive data in error messages
- **Logging**: Comprehensive logging without sensitive information
- **CORS**: Proper cross-origin resource sharing configuration
- **Rate Limiting**: Protection against abuse and DoS attacks

## Dependencies

### Core Dependencies

- **Next.js API Routes**: Server-side API implementation
- **Prisma**: Database ORM and query builder
- **jsonwebtoken**: JWT token generation and verification
- **@meshsdk/core**: Cardano blockchain interactions
- **@meshsdk/core-cst**: Cryptographic signature verification

### Utility Dependencies

- **crypto**: Node.js cryptographic functions
- **cors**: Cross-origin resource sharing
- **fetch**: HTTP client for external requests

## Environment Variables

### Required Variables

- `JWT_SECRET`: Secret key for JWT token generation
- `NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD`: Preprod network API key
- `NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET`: Mainnet network API key

### Database Configuration

- Database connection via Prisma configuration
- Environment-specific database URLs
- Connection pooling and optimization

## Usage Examples

### Authentication Flow

```typescript
// 1. Request nonce
const nonceResponse = await fetch("/api/v1/getNonce?address=addr1...");
const { nonce } = await nonceResponse.json();

// 2. Sign nonce and get token
const signature = await wallet.signData(nonce, address);
const tokenResponse = await fetch("/api/v1/authSigner", {
  method: "POST",
  body: JSON.stringify({ address, signature, key: publicKey }),
});
const { token } = await tokenResponse.json();
```

### Transaction Submission

```typescript
const response = await fetch("/api/v1/addTransaction", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    walletId: "wallet-id",
    address: "addr1...",
    txCbor: "tx-cbor-data",
    txJson: "tx-json-data",
    description: "Transaction description",
  }),
});
```

### UTxO Retrieval

```typescript
const response = await fetch(
  "/api/v1/freeUtxos?walletId=wallet-id&address=addr1...",
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
);
const freeUtxos = await response.json();
```

This API v1 directory provides a comprehensive, secure, and well-documented REST API for multisig wallet operations, supporting the entire application ecosystem with robust authentication, transaction management, and blockchain integration.
