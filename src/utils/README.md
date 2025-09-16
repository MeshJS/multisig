# Utils Directory

A comprehensive collection of utility functions, SDK implementations, and helper modules for the multisig wallet application. This directory contains core business logic, Cardano blockchain interactions, and API client configurations.

## Core SDK & Blockchain Utilities

### `multisigSDK.ts`
- **Purpose**: Core multisig wallet SDK implementation using native scripts
- **Features**:
  - `MultisigWallet` class for creating and managing multisig wallets
  - Native script generation for payment, staking, and DRep roles
  - Address generation and script serialization
  - CIP-1854 compliant key sorting and script building
  - DRep ID generation (CIP-105 and CIP-129 formats)
  - JSON metadata generation for wallet information
- **Key Classes**:
  - `MultisigWallet`: Main wallet class with script generation
  - `MultisigKey`: Interface for wallet keys with roles
- **Key Functions**:
  - `paymentKeyHash()`: Extract payment key hash from address
  - `stakeKeyHash()`: Extract stake key hash from stake address
  - `addressToNetwork()`: Determine network from address format
  - `checkValidAddress()`: Validate Cardano addresses
  - `checkValidStakeKey()`: Validate stake keys
- **Dependencies**: @meshsdk/core, @meshsdk/core-cst

### `common.ts`
- **Purpose**: Wallet building utilities and database integration
- **Features**:
  - `buildMultisigWallet()`: Convert database wallet to MultisigWallet instance
  - `buildWallet()`: Create complete wallet object with address and metadata
  - Address validation and key hash extraction
  - Network detection and UTxO integration
  - DRep ID generation and metadata handling
- **Key Functions**:
  - `buildMultisigWallet()`: Database to SDK wallet conversion
  - `buildWallet()`: Complete wallet object creation
- **Dependencies**: @meshsdk/core, @meshsdk/core-cst, Prisma client

### `get-provider.ts`
- **Purpose**: Blockchain provider configuration for different networks
- **Features**:
  - Blockfrost provider setup for mainnet and preprod
  - Environment-based API key selection
  - Network-specific provider instantiation
- **Key Functions**:
  - `getProvider(network)`: Returns configured Blockfrost provider
- **Dependencies**: @meshsdk/core, environment variables

### `get-tx-builder.ts`
- **Purpose**: Transaction builder configuration and setup
- **Features**:
  - Mesh transaction builder initialization
  - Network-specific configuration (mainnet/preprod)
  - Provider integration for fetcher and evaluator
  - Verbose logging for development
- **Key Functions**:
  - `getTxBuilder(network)`: Returns configured transaction builder
- **Dependencies**: @meshsdk/core, get-provider utility

## API & Client Utilities

### `api.ts`
- **Purpose**: Client-side tRPC API configuration and type inference
- **Features**:
  - tRPC client setup with Next.js integration
  - HTTP batch linking for optimized requests
  - Superjson transformer for complex data types
  - Development logging and error handling
  - Type inference helpers for inputs and outputs
- **Key Exports**:
  - `api`: tRPC client with React Query hooks
  - `RouterInputs`: Type inference for API inputs
  - `RouterOutputs`: Type inference for API outputs
- **Dependencies**: @trpc/client, @trpc/next, superjson

### `apiServer.ts`
- **Purpose**: Server-side tRPC client for internal API calls
- **Features**:
  - Server-side tRPC proxy client
  - HTTP batch linking for server-to-server communication
  - Environment-based URL configuration
  - Development logging and error handling
- **Key Exports**:
  - `apiServer`: Server-side tRPC proxy client
- **Dependencies**: @trpc/client, superjson

### `swagger.ts`
- **Purpose**: OpenAPI/Swagger documentation configuration
- **Features**:
  - Complete API documentation for v1 endpoints
  - JWT Bearer authentication scheme
  - Detailed endpoint specifications with request/response schemas
  - Parameter validation and error response documentation
- **API Endpoints Documented**:
  - `/api/v1/nativeScript`: Get native scripts for multisig wallet
  - `/api/v1/freeUtxos`: Get unblocked UTxOs for wallet
  - `/api/v1/addTransaction`: Submit external transaction
  - `/api/v1/submitDatum`: Submit signable payload
  - `/api/v1/walletIds`: Get wallet IDs for address
  - `/api/v1/lookupMultisigWallet`: Lookup wallet metadata
  - `/api/v1/getNonce`: Request authentication nonce
  - `/api/v1/authSigner`: Verify signature and get token
- **Dependencies**: swagger-jsdoc

## Data Processing & Formatting

### `strings.ts`
- **Purpose**: String manipulation and formatting utilities
- **Features**:
  - Address truncation with configurable prefix/suffix lengths
  - Number formatting with comma separators
  - Lovelace to ADA conversion with proper formatting
  - Date formatting for display purposes
- **Key Functions**:
  - `getFirstAndLast()`: Truncate strings with ellipsis
  - `numberWithCommas()`: Add comma separators to numbers
  - `lovelaceToAda()`: Convert lovelace to ADA with symbol
  - `dateToFormatted()`: Format dates for display
- **Dependencies**: None (pure utility functions)

### `getBalance.ts`
- **Purpose**: UTxO balance calculation and processing
- **Features**:
  - Balance aggregation from UTxO arrays
  - Multi-asset balance calculation
  - Lovelace balance extraction and conversion
  - Asset unit mapping and quantity summation
- **Key Functions**:
  - `getBalance()`: Calculate balance map from UTxOs
  - `getBalanceFromUtxos()`: Extract ADA balance from UTxOs
- **Dependencies**: @meshsdk/core (UTxO type)

### `jsonLdParser.ts`
- **Purpose**: JSON-LD data extraction and parsing
- **Features**:
  - JSON-LD value extraction with fallback handling
  - Support for nested object structures
  - Type-safe value extraction from complex JSON-LD
- **Key Functions**:
  - `extractJsonLdValue()`: Extract values from JSON-LD with fallback
- **Dependencies**: None (pure utility functions)

## Security & Authentication

### `signing.ts`
- **Purpose**: Cryptographic signing utilities for multisig operations
- **Features**:
  - Multi-role signing support (payment, staking, DRep)
  - Nonce generation and signature verification
  - Address-based signing with role-specific handling
  - Signature validation and verification
- **Key Functions**:
  - `sign()`: Sign payload with wallet and role-specific address
- **Dependencies**: @meshsdk/core (signing utilities)

## Architecture Patterns

### SDK Integration
- **Mesh SDK**: Core Cardano blockchain interactions
- **Native Scripts**: CIP-1854 compliant multisig script generation
- **Provider Pattern**: Network-specific blockchain provider configuration
- **Builder Pattern**: Transaction and wallet building utilities

### API Architecture
- **tRPC Integration**: Type-safe API client configuration
- **Server/Client Separation**: Different configurations for server and client
- **Batch Processing**: HTTP batch linking for optimized requests
- **Type Inference**: Automatic type generation from API schemas

### Data Processing
- **UTxO Processing**: Balance calculation and asset aggregation
- **Address Validation**: Comprehensive address and key validation
- **Format Conversion**: Lovelace/ADA, date formatting, string manipulation
- **JSON-LD Parsing**: Structured data extraction and processing

## Error Handling

### Validation Functions
- Address validation with try-catch error handling
- Stake key validation with proper error reporting
- Network detection with fallback mechanisms
- UTxO processing with empty array handling

### SDK Error Handling
- Script generation error handling with detailed logging
- Wallet building error handling with fallback values
- Provider configuration error handling
- Transaction builder error handling

## Dependencies

### Core Dependencies
- **@meshsdk/core**: Cardano blockchain SDK
- **@meshsdk/core-cst**: Cardano serialization utilities
- **@trpc/client**: Type-safe API client
- **@trpc/next**: Next.js tRPC integration
- **superjson**: Data serialization
- **swagger-jsdoc**: API documentation

### Environment Variables
- `NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD`: Preprod network API key
- `NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET`: Mainnet network API key
- `VERCEL_URL`: Deployment URL for server-side API calls
- `PORT`: Development server port

## Usage Examples

### Creating a Multisig Wallet
```typescript
import { MultisigWallet } from '@/utils/multisigSDK';

const wallet = new MultisigWallet(
  "My Wallet",
  keys,
  "Description",
  2, // required signers
  1  // mainnet
);
const script = wallet.getScript();
```

### Building from Database
```typescript
import { buildWallet } from '@/utils/common';

const wallet = buildWallet(dbWallet, network, utxos);
```

### API Client Usage
```typescript
import { api } from '@/utils/api';

const { data } = await api.wallet.getAll.useQuery();
```

### Balance Calculation
```typescript
import { getBalance } from '@/utils/getBalance';

const balance = getBalance(utxos);
const adaBalance = getBalanceFromUtxos(utxos);
```

This utils directory provides the foundational utilities that power the entire multisig wallet application, from blockchain interactions to API communications and data processing.
