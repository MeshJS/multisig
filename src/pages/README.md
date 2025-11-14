# Pages Directory

A comprehensive Next.js pages directory containing all application routes, API endpoints, and page components. This directory implements the file-based routing system for the multisig wallet application with both client-side pages and server-side API routes.

## Application Structure

### Core Application Files

#### `_app.tsx`
- **Purpose**: Root application component with global providers and configuration
- **Features**:
  - Global dark mode detection and theme management
  - Provider setup (Mesh SDK, NextAuth, Nostr Chat)
  - Global styles and font configuration
  - Toast notifications and meta tags
  - tRPC integration for type-safe API calls
- **Providers**:
  - `MeshProvider`: Cardano wallet integration
  - `SessionProvider`: NextAuth authentication
  - `NostrChatProvider`: Decentralized chat functionality
- **Styling**: Geist Sans font, global CSS, Mesh SDK styles, Swagger UI styles

#### `_document.tsx`
- **Purpose**: Custom document structure for HTML head and body
- **Features**: Custom HTML document configuration for Next.js

### Main Application Pages

#### `index.tsx`
- **Purpose**: Homepage with conditional rendering based on user authentication
- **Features**:
  - Renders wallet list for authenticated users
  - Shows homepage for unauthenticated users
  - Uses `useUser` hook for authentication state

#### `api-docs.tsx`
- **Purpose**: Interactive API documentation using Swagger UI
- **Features**:
  - Dynamic Swagger UI loading (no SSR)
  - Glassmorphism design with backdrop blur
  - Globe background component
  - Full API specification display
  - Interactive endpoint testing

#### `globe.tsx`
- **Purpose**: 3D globe component for visual backgrounds
- **Features**: Interactive 3D globe rendering for page backgrounds

## Wallet Management Pages

### Wallet Listing and Creation

#### `wallets/index.tsx`
- **Purpose**: Main wallet listing page
- **Features**: Displays all user wallets with management options

#### `wallets/new-wallet/index.tsx`
- **Purpose**: New wallet creation page
- **Features**: Wallet creation form and configuration

#### `wallets/new-wallet/[id].tsx`
- **Purpose**: Dynamic wallet creation with specific ID
- **Features**: Wallet creation with pre-configured parameters

#### `wallets/new-wallet-flow/`
- **Purpose**: Multi-step wallet creation flow
- **Structure**:
  - `create/[id].tsx`: Wallet creation step
  - `ready/[id].tsx`: Wallet ready confirmation
  - `save/index.tsx`: Wallet save and backup

### Wallet Invitations

#### `wallets/invite/[id].tsx`
- **Purpose**: Wallet invitation acceptance page
- **Features**: Accept wallet invitations with dynamic ID

#### `wallets/invite/info/[id].tsx`
- **Purpose**: Wallet invitation information page
- **Features**: Display invitation details and instructions

### Individual Wallet Pages

#### `wallets/[wallet]/index.tsx`
- **Purpose**: Main wallet dashboard
- **Features**: Wallet overview, balance, and quick actions

#### `wallets/[wallet]/info/index.tsx`
- **Purpose**: Wallet information and settings
- **Features**: Wallet details, signer management, configuration

#### `wallets/[wallet]/assets/index.tsx`
- **Purpose**: Wallet asset management
- **Features**: View and manage wallet assets

#### `wallets/[wallet]/chat/index.tsx`
- **Purpose**: Wallet-specific chat interface
- **Features**: Decentralized chat for wallet participants

#### `wallets/[wallet]/dapps/index.tsx`
- **Purpose**: DApp integration page
- **Features**: Connect and interact with decentralized applications

#### `wallets/[wallet]/signing/index.tsx`
- **Purpose**: Transaction signing interface
- **Features**: Sign pending transactions and signables

#### `wallets/[wallet]/staking/index.tsx`
- **Purpose**: Staking management page
- **Features**: Delegate stake and manage staking operations

### Transaction Management

#### `wallets/[wallet]/transactions/index.tsx`
- **Purpose**: Transaction history and management
- **Features**: View all transactions, pending transactions, and transaction details

#### `wallets/[wallet]/transactions/new/index.tsx`
- **Purpose**: New transaction creation
- **Features**: Create new multisig transactions with UTxO selection

#### `wallets/[wallet]/transactions/deposit/index.tsx`
- **Purpose**: Wallet deposit interface
- **Features**: Deposit funds from personal wallet to multisig wallet

### Governance Pages

#### `wallets/[wallet]/governance/index.tsx`
- **Purpose**: Wallet governance dashboard
- **Features**: DRep management, proposal voting, ballot creation

#### `wallets/[wallet]/governance/register/index.tsx`
- **Purpose**: DRep registration page
- **Features**: Register as a DRep with metadata and certificates

#### `wallets/[wallet]/governance/update/index.tsx`
- **Purpose**: DRep information update
- **Features**: Update DRep metadata and information

#### `wallets/[wallet]/governance/drep/index.tsx`
- **Purpose**: DRep discovery and management
- **Features**: Find and manage DRep information

#### `wallets/[wallet]/governance/drep/[id]/index.tsx`
- **Purpose**: Specific DRep information page
- **Features**: View detailed DRep information and voting history

#### `wallets/[wallet]/governance/proposal/[id]/index.tsx`
- **Purpose**: Individual proposal page
- **Features**: View proposal details, vote on proposals, add to ballots

#### `wallets/[wallet]/governance/clarity/create-action.tsx`
- **Purpose**: Clarity governance action creation
- **Features**: Create complex governance actions through Clarity platform

## Global Governance Pages

#### `governance/index.tsx`
- **Purpose**: Global governance overview
- **Features**: System-wide governance information and DRep directory

#### `governance/drep/index.tsx`
- **Purpose**: Global DRep directory
- **Features**: Browse and discover DReps across the network

#### `governance/drep/[id]/index.tsx`
- **Purpose**: Individual DRep profile page
- **Features**: View DRep information, voting history, and statistics

## Feature Pages

#### `dapps/index.tsx`
- **Purpose**: DApp integration hub
- **Features**: Discover and connect with Cardano DApps

#### `features/index.tsx`
- **Purpose**: Application features showcase
- **Features**: Highlight key application features and capabilities

## API Routes

### Authentication API

#### `api/auth/[...nextauth].ts`
- **Purpose**: NextAuth.js authentication handler
- **Features**: OAuth providers, session management, JWT handling

#### `api/auth/discord/callback.ts`
- **Purpose**: Discord OAuth callback handler
- **Features**: Discord authentication flow completion

### Discord Integration API

#### `api/discord/send-message.ts`
- **Purpose**: Send Discord notifications
- **Features**:
  - Create DM channels with users
  - Send messages via Discord Bot API
  - Bulk message sending to multiple users
  - Error handling for failed deliveries

#### `api/discord/get-user.ts`
- **Purpose**: Retrieve Discord user information
- **Features**: Fetch user data, avatar information, and profile details

### GitHub Integration API

#### `api/github/create-issue.ts`
- **Purpose**: Create GitHub issues programmatically
- **Features**: Automated issue creation for bug reports and feature requests

### Core API Routes

#### `api/trpc/[trpc].ts`
- **Purpose**: tRPC API handler
- **Features**:
  - Type-safe API endpoints
  - Request/response validation
  - Error handling and logging
  - Development error details

#### `api/swagger.ts`
- **Purpose**: API specification endpoint
- **Features**: Serves OpenAPI/Swagger specification for API documentation

### V1 API Endpoints

#### `api/v1/lookupMultisigWallet.ts`
- **Purpose**: Lookup multisig wallets by public key hashes
- **Features**:
  - Search wallets by participant public keys
  - Network-specific wallet discovery
  - Metadata filtering and validation
  - CORS support for cross-origin requests

#### `api/v1/addTransaction.ts`
- **Purpose**: Add new transactions to the system
- **Features**: Transaction creation and validation

#### `api/v1/authSigner.ts`
- **Purpose**: Authenticate wallet signers
- **Features**: Signer verification and authentication

#### `api/v1/freeUtxos.ts`
- **Purpose**: Retrieve available UTxOs
- **Features**: UTxO availability checking and filtering

#### `api/v1/getNonce.ts`
- **Purpose**: Generate cryptographic nonces
- **Features**: Nonce generation for transaction signing

#### `api/v1/nativeScript.ts`
- **Purpose**: Native script operations
- **Features**: Script creation and validation

#### `api/v1/og.ts`
- **Purpose**: Open Graph metadata generation
- **Features**: Dynamic OG tags for social media sharing

#### `api/v1/submitDatum.ts`
- **Purpose**: Submit transaction datums
- **Features**: Datum submission and validation

#### `api/v1/walletIds.ts`
- **Purpose**: Retrieve wallet identifiers
- **Features**: Wallet ID management and lookup

### Storage API

#### `api/ipfs/put.ts`
- **Purpose**: Store data in IPFS via Pinata
- **Features**: JSON data storage with duplicate detection, user/wallet tracking

#### `api/vercel-storage/image/put.ts`
- **Purpose**: Store images in Vercel storage
- **Features**: Image upload and storage

#### `api/vercel-storage/image/exists.ts`
- **Purpose**: Check image existence in storage
- **Features**: Image availability checking

## Routing Architecture

### File-Based Routing
- **Dynamic Routes**: `[wallet]`, `[id]` for parameterized routes
- **Nested Routes**: Hierarchical page structure
- **API Routes**: Server-side endpoints in `/api` directory

### Route Patterns
- **Wallet Routes**: `/wallets/[wallet]/[feature]`
- **Governance Routes**: `/governance/[type]/[id]`
- **API Routes**: `/api/[version]/[endpoint]`

### Authentication Flow
- **Public Routes**: Homepage, features, API docs
- **Protected Routes**: Wallet management, governance
- **Conditional Rendering**: Based on authentication state

## Page Component Pattern

### Consistent Structure
All pages follow a consistent pattern:
```typescript
import PageComponent from "@/components/pages/[feature]";

export default function Page() {
  return <PageComponent />;
}
```

### Component Separation
- **Pages**: Route definitions and basic structure
- **Components**: Actual page logic and UI in `/components/pages/`
- **Hooks**: Data fetching and state management

## API Architecture

### REST API (V1)
- **Endpoints**: Traditional REST endpoints in `/api/v1/`
- **CORS Support**: Cross-origin request handling
- **Error Handling**: Consistent error responses

### tRPC API
- **Type Safety**: End-to-end type safety
- **Validation**: Request/response validation
- **Error Handling**: Structured error responses

### Authentication
- **NextAuth.js**: OAuth and session management
- **JWT Tokens**: Secure token-based authentication
- **Discord Integration**: Discord OAuth flow

## Performance Optimizations

### Dynamic Imports
- **Swagger UI**: Dynamic loading to avoid SSR issues
- **Heavy Components**: Lazy loading for better performance

### API Optimization
- **CORS Handling**: Efficient preflight request handling
- **Error Logging**: Development-only detailed error logging
- **Response Caching**: Appropriate caching headers

## Security Features

### CORS Configuration
- **Origin Validation**: Configurable allowed origins
- **Method Restrictions**: Limited HTTP methods
- **Header Validation**: Controlled request headers

### Authentication Security
- **JWT Verification**: Secure token validation
- **Session Management**: Secure session handling
- **OAuth Integration**: Secure third-party authentication

### API Security
- **Input Validation**: Request parameter validation
- **Error Handling**: Secure error responses
- **Rate Limiting**: Protection against abuse

## Integration Points

### External Services
- **Discord API**: User notifications and avatars
- **GitHub API**: Issue creation and management
- **Vercel Storage**: File and data storage

### Blockchain Integration
- **Mesh SDK**: Cardano wallet operations
- **Blockfrost**: Blockchain data access
- **Nostr**: Decentralized chat functionality

### Development Tools
- **Swagger UI**: API documentation and testing
- **tRPC**: Type-safe API development
- **NextAuth**: Authentication management

## Best Practices

### Page Organization
- **Logical Grouping**: Related pages in subdirectories
- **Consistent Naming**: Clear and descriptive file names
- **Component Separation**: Pages as thin wrappers

### API Design
- **RESTful Patterns**: Consistent API design
- **Error Handling**: Proper HTTP status codes
- **Documentation**: Comprehensive API documentation

### Security
- **Input Validation**: Validate all inputs
- **Authentication**: Secure authentication flows
- **CORS Configuration**: Proper cross-origin handling
