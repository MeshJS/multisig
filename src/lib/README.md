# Lib Directory

A comprehensive collection of utility libraries, state management stores, and middleware for the multisig wallet application. This directory contains core infrastructure components that support the entire application architecture.

## Core Utilities

### `utils.ts`
- **Purpose**: Provides utility functions for CSS class management
- **Features**:
  - Combines `clsx` and `tailwind-merge` for optimal CSS class handling
  - Merges Tailwind CSS classes with proper precedence
  - Handles conditional class application
- **Key Function**: `cn()` - Merges and deduplicates CSS classes
- **Dependencies**: clsx, tailwind-merge

### `verifyJwt.ts`
- **Purpose**: JWT token verification for authentication
- **Features**:
  - Verifies JWT tokens using secret key
  - Extracts user address from token payload
  - Handles token validation errors gracefully
  - Returns null on invalid tokens
- **Key Function**: `verifyJwt(token: string)` - Verifies and extracts address from JWT
- **Dependencies**: jsonwebtoken
- **Environment**: Requires `JWT_SECRET` environment variable

### `cors.ts`
- **Purpose**: CORS middleware configuration for API routes
- **Features**:
  - Configurable allowed origins from environment variables
  - Supports wildcard (*) and specific origin lists
  - Handles preflight OPTIONS requests
  - Includes detailed CORS debugging logs
  - Supports credentials and custom headers
- **Configuration**:
  - `CORS_ORIGINS` environment variable for allowed origins
  - Methods: GET, POST, OPTIONS
  - Headers: Content-Type, Authorization
- **Dependencies**: cors, init-middleware

### `init-middleware.ts`
- **Purpose**: Middleware initialization wrapper for Next.js API routes
- **Features**:
  - Wraps middleware functions in Promise-based interface
  - Handles middleware errors and results
  - Provides consistent middleware pattern
- **Key Function**: `initMiddleware(middleware)` - Wraps middleware for async handling

## State Management (Zustand Stores)

### User Store (`zustand/user.ts`)
- **Purpose**: Manages user authentication and personal data
- **State**:
  - `userAddress`: Current user's wallet address
  - `user`: Complete user object from database
  - `userAssets`: User's personal wallet assets
  - `userAssetMetadata`: Asset metadata for user's assets
  - `pastWallet`: Previously accessed wallet for navigation
- **Features**:
  - Persistent storage for navigation state
  - Asset management for user's personal wallet
  - User authentication state management
- **Persistence**: Partial persistence (only `pastWallet`)

### Site Store (`zustand/site.ts`)
- **Purpose**: Manages global application state
- **State**:
  - `network`: Current Cardano network (0: preprod, 1: mainnet)
  - `randomState`: Random state for forcing re-renders
  - `loading`: Global loading state
  - `alert`: Global alert message
- **Features**:
  - Network switching functionality
  - Global loading state management
  - Alert system for user notifications
  - Random state for component refresh triggers

### Wallets Store (`zustand/wallets.ts`)
- **Purpose**: Manages multisig wallet data and blockchain information
- **State**:
  - `walletsUtxos`: UTxO data for each wallet
  - `walletTransactions`: On-chain transactions for each wallet
  - `walletLastUpdated`: Last sync timestamp for each wallet
  - `walletAssets`: Available assets in wallets
  - `walletAssetMetadata`: Metadata for wallet assets
  - `drepInfo`: DRep information for governance
- **Features**:
  - IndexedDB persistence for offline data
  - Per-wallet data organization
  - Asset metadata management
  - DRep governance data
- **Persistence**: Full persistence via IndexedDB

## Local Storage (IndexedDB)

### `indexeddb.ts`
- **Purpose**: IndexedDB integration for offline data persistence
- **Features**:
  - Dexie-based database management
  - Zustand storage adapter for persistence
  - Local data read/write operations
  - Configurable database and store names
- **Database Structure**:
  - Database: "mesh-multisig"
  - Store: "multisig" (id, data)
- **Key Functions**:
  - `writeLocalData()`: Write data to IndexedDB
  - `readLocalData()`: Read data from IndexedDB
  - `zustandStorage`: Storage adapter for Zustand persistence
- **Dependencies**: dexie, idb-keyval, zustand/middleware

## Discord Integration

### `discord/sendDiscordMessage.ts`
- **Purpose**: Sends Discord notifications to users
- **Features**:
  - Bulk message sending to multiple Discord users
  - Integration with Discord API via internal endpoint
  - Error handling for failed message delivery
- **Key Function**: `sendDiscordMessage(discordIds, message)`
- **Use Cases**: Transaction reminders, governance notifications

### `discord/getDiscordAvatar.ts`
- **Purpose**: Retrieves Discord user avatars
- **Features**:
  - Fetches user avatar URLs from Discord API
  - Handles custom and default avatars
  - Supports animated avatars (GIF format)
  - Fallback to default avatar on errors
- **Key Function**: `getDiscordAvatar(discordId)`
- **Avatar Types**:
  - Custom avatars (PNG/GIF)
  - Default avatars (numbered 0-4)
  - Animated avatars (GIF with 'a_' prefix)

## Architecture Patterns

### State Management Pattern
The application uses Zustand for state management with a clear separation of concerns:
- **User Store**: Personal user data and authentication
- **Site Store**: Global application state
- **Wallets Store**: Multisig wallet and blockchain data

### Persistence Strategy
- **User Store**: Partial persistence (navigation state only)
- **Site Store**: No persistence (session-only)
- **Wallets Store**: Full persistence via IndexedDB

### Middleware Pattern
- Consistent middleware initialization for Next.js API routes
- Promise-based middleware handling
- Error handling and result processing

## Environment Configuration

### Required Environment Variables
- `JWT_SECRET`: Secret key for JWT token verification
- `CORS_ORIGINS`: Comma-separated list of allowed origins or "*" for all

### Optional Environment Variables
- Database and storage configurations
- Discord API configurations
- Network-specific settings

## Error Handling

### JWT Verification
- Returns null on invalid tokens
- Throws error if JWT_SECRET is not configured
- Handles malformed token gracefully

### CORS Handling
- Detailed logging for debugging
- Graceful fallback for missing origins
- Error responses for unauthorized origins

### Discord Integration
- Fallback to default avatars on API failures
- Error handling for message delivery failures
- Graceful degradation for missing Discord data

## Performance Considerations

### IndexedDB Optimization
- Efficient data storage and retrieval
- Minimal data serialization overhead
- Optimized for large wallet datasets

### State Management
- Selective persistence to reduce storage overhead
- Efficient state updates with Zustand
- Minimal re-renders through proper state structure

### CORS Performance
- Efficient origin checking
- Minimal middleware overhead
- Cached origin validation

## Security Features

### JWT Security
- Secure token verification with secret key
- Proper error handling to prevent information leakage
- Environment-based secret management

### CORS Security
- Configurable origin restrictions
- Credential support for authenticated requests
- Proper preflight handling

### Data Persistence
- Secure local storage with IndexedDB
- Encrypted data storage capabilities
- Access control through browser security

## Integration Points

### Next.js Integration
- API route middleware support
- Server-side rendering compatibility
- Environment variable access

### Mesh SDK Integration
- Cardano-specific data types
- UTxO and transaction handling
- Asset metadata management

### Discord API Integration
- User avatar retrieval
- Message sending capabilities
- Error handling and fallbacks

## Testing Considerations

### Unit Testing
- Pure functions for easy testing
- Mockable dependencies
- Clear input/output contracts

### Integration Testing
- State store testing with Zustand
- IndexedDB testing with test databases
- CORS testing with different origins

### Error Testing
- JWT validation error scenarios
- CORS rejection testing
- Discord API failure testing

## Best Practices

### State Management
- Keep stores focused on specific domains
- Use proper TypeScript typing
- Implement selective persistence

### Error Handling
- Graceful degradation for external services
- Proper error logging and monitoring
- User-friendly error messages

### Performance
- Optimize data structures for large datasets
- Use efficient persistence strategies
- Minimize unnecessary re-renders

### Security
- Secure environment variable handling
- Proper CORS configuration
- Safe local storage practices
