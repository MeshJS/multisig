# Mesh Multi-Sig Wallet

A comprehensive, enterprise-grade multi-signature wallet solution built on Cardano, designed for teams, DAOs, and organizations to securely manage treasury funds and participate in governance.

[![Next.js](https://img.shields.io/badge/Next.js-16.0.7-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5.3-blue)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.17.1-2D3748)](https://www.prisma.io/)
[![Mesh SDK](https://img.shields.io/badge/Mesh%20SDK-1.9.0--beta.87-orange)](https://meshjs.dev/)
[![License](https://img.shields.io/github/license/MeshJS/multisig)](LICENSE.md)

## Features

### Multi-Signature Wallet Management
- Create wallets with customizable signer requirements
- Flexible signing thresholds ("all", "any", or "at least N")
- Signer management with descriptive labels and verification
- Wallet migration to new configurations
- Multi-asset support for ADA and custom tokens

### Transaction Management
- Intuitive transaction creation interface
- Manual or automatic UTxO selection
- CSV import/export for bulk operations
- ADA Handle resolution support
- Send all assets in one transaction

### Governance & DRep Integration
- Register as a Delegated Representative
- View and vote on Cardano governance proposals
- Team collaboration for governance decisions
- On-chain transparency for all actions

### Staking & Delegation
- Delegate to any Cardano stake pool
- Withdraw staking rewards through multi-sig
- Register and deregister stake addresses
- Secure multi-sig staking operations

### Collaboration
- Real-time Nostr-based chat
- Discord integration for notifications
- Signer verification via message signing
- Automated transaction alerts

### Developer Features
- RESTful API with Swagger documentation
- Type-safe tRPC integration
- JWT authentication
- PostgreSQL database with Prisma ORM

## Architecture

### Frontend
- **Next.js 16** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling
- **Radix UI** - Accessible components
- **Zustand** - State management

### Backend
- **tRPC** - End-to-end typesafe APIs
- **Prisma** - Database ORM with PostgreSQL
- **NextAuth.js** - Authentication system
- **JWT** - Token-based authentication

### Blockchain
- **Mesh SDK** - Cardano blockchain interaction
- **Native Scripts** - Multi-signature script generation
- **UTxO Management** - Advanced transaction handling

## Documentation Graph

This graph shows internal module relationships in this repository. Arrows mean "imports/depends on".

```mermaid
graph TD

  pages["src/pages"]

  components_common["src/components/common"]

  components_multisig["src/components/multisig"]

  components_ui["src/components/ui"]

  hooks["src/hooks"]

  lib["src/lib"]

  utils["src/utils"]

  types["src/types"]

  data["src/data"]

  config_wallet["src/config/wallet.ts"]

  server_api["src/server/api"]

  server_auth["src/server/auth.ts"]

  server_db["src/server/db.ts"]

  prisma["prisma/*"]


  subgraph legend["Legend"]
    l1["A --> B means A imports/depends on B"]
    l2["Click nodes to open local paths"]
  end


  %% Frontend relationships
  pages --> components_common
  pages --> components_multisig
  pages --> components_ui

  components_common --> hooks
  components_multisig --> hooks
  components_ui --> hooks

  components_common --> utils
  components_multisig --> utils
  components_ui --> utils

  hooks --> lib
  hooks --> types

  %% Shared relationships
  lib --> utils
  lib --> types
  data --> lib
  data --> components_multisig
  config_wallet --> lib

  %% Backend relationships
  server_api --> lib
  server_api --> utils
  server_api --> types
  server_api --> server_db
  server_auth --> server_db
  server_auth --> utils
  server_db --> types
  prisma --> server_db


  subgraph frontend
    pages
    components_common
    components_multisig
    components_ui
    hooks
  end

  subgraph shared
    lib
    utils
    types
    config_wallet
    data
  end

  subgraph backend
    server_api
    server_auth
    server_db
    prisma
  end


  %% Clickable links to local repository paths
  click pages "./src/pages" _self
  click components_common "./src/components/common" _self
  click components_multisig "./src/components/multisig" _self
  click components_ui "./src/components/ui" _self
  click hooks "./src/hooks" _self
  click lib "./src/lib" _self
  click utils "./src/utils" _self
  click types "./src/types" _self
  click data "./src/data" _self
  click config_wallet "./src/config/wallet.ts" _self
  click server_api "./src/server/api" _self
  click server_auth "./src/server/auth.ts" _self
  click server_db "./src/server/db.ts" _self
  click prisma "./prisma" _self
```

### Database Schema
```prisma
model User {
  id           String @id @default(cuid())
  address      String @unique
  stakeAddress String @unique
  nostrKey     String @unique
  discordId    String @default("")
}

model Wallet {
  id                  String   @id @default(cuid())
  name                String
  description         String?
  signersAddresses    String[]
  signersStakeKeys    String[]
  signersDescriptions String[]
  numRequiredSigners  Int?
  verified            String[]
  scriptCbor          String
  stakeCredentialHash String?
  type                String
  isArchived          Boolean  @default(false)
  clarityApiKey       String?
}

model Transaction {
  id                String   @id @default(cuid())
  walletId          String
  txJson            String
  txCbor            String
  signedAddresses   String[]
  rejectedAddresses String[]
  description       String?
  state             Int
  txHash            String?
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt
}
```

## Getting Started

### Prerequisites

- **Node.js 18+** - Required for local development
- **PostgreSQL** - Database (included with Docker Compose setup)
- **Docker & Docker Compose** - Recommended for easy setup
- **Cardano wallet** - Nami, Eternl, or other compatible wallet for testing

### Development Setup Options

Choose the setup method that best fits your workflow:

#### Docker Compose (App Runs Locally, DB in Docker)

**Best for**: Local development, debugging, IDE integration, faster iteration

PostgreSQL runs in Docker. The app runs locally for better debugging and IDE support.

1. **Clone the repository**
   ```bash
   git clone https://github.com/MeshJS/multisig.git
   cd multisig
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and configure:
   - `DATABASE_URL` - Use `postgresql://postgres:postgres@localhost:5433/multisig` (localhost, port 5433)
   - `JWT_SECRET` - Generate with: `openssl rand -base64 32`
   - `PINATA_JWT` - Get from [Pinata Cloud](https://app.pinata.cloud/)
   - `NEXT_PUBLIC_BLOCKFROST_API_KEY_MAINNET` - Get from [Blockfrost](https://blockfrost.io/)
   - `NEXT_PUBLIC_BLOCKFROST_API_KEY_PREPROD` - Get from [Blockfrost](https://blockfrost.io/)
   - `GITHUB_TOKEN` - (Optional) Create at [GitHub Settings](https://github.com/settings/tokens) for GitHub issue creation

4. **Start PostgreSQL database**
   ```bash
   docker compose -f docker-compose.dev.yml up -d postgres
   ```

5. **Initialize the database**
   ```bash
   npm run db:update
   ```
   
   This will:
   - Format the Prisma schema
   - Push schema changes to the database
   - Generate the Prisma Client

6. **Start the development server**
   ```bash
   npm run dev
   ```

7. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

**Useful commands:**
```bash
# Start database
docker compose -f docker-compose.dev.yml up -d postgres

# Stop database
docker compose -f docker-compose.dev.yml down

# Update database schema (after schema changes)
npm run db:update

# View database in Prisma Studio
npm run db:studio
```

## Usage

### Creating a Multi-Sig Wallet

1. **Connect your wallet** using one of the supported Cardano wallets
2. **Navigate to "New Wallet"** from the main dashboard
3. **Add signers** by entering their Cardano addresses and descriptions
4. **Set signing requirements** (e.g., "at least 2 of 5 signers")
5. **Configure wallet details** including name and description
6. **Deploy the wallet** to the blockchain

### Creating Transactions

1. **Select your multi-sig wallet** from the dashboard
2. **Click "New Transaction"**
3. **Add recipients** with addresses, amounts, and assets
4. **Select UTxOs** manually or use automatic selection
5. **Add transaction description** for signers
6. **Submit for signing** - all required signers will be notified

### Participating in Governance

1. **Navigate to Governance** section
2. **Register as DRep** if not already registered
3. **View active proposals** and their details
4. **Vote on proposals** using your multi-sig wallet
5. **Track voting history** and results

## API Documentation

The application provides comprehensive API documentation through Swagger UI:

- **Local Development**: [http://localhost:3000/api-docs](http://localhost:3000/api-docs)
- **API Endpoints**: RESTful endpoints for wallet operations
- **Authentication**: JWT-based authentication system

### Key API Endpoints

- `GET /api/v1/walletIds` - Get user's wallet IDs
- `POST /api/v1/addTransaction` - Create new transaction
- `POST /api/v1/authSigner` - Authenticate signer
- `GET /api/v1/lookupMultisigWallet` - Lookup multisig wallet
- `POST /api/discord/send-message` - Send Discord notifications

> 💡 **Tip**: The Swagger UI provides interactive API testing. Start the dev server and visit `/api-docs` to explore all available endpoints.

## Development

### Available Scripts

```bash
# Development
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server

# Database
npm run db:update    # Format schema, push changes, and generate client (recommended)
npm run db:push      # Push schema changes to database
npm run db:generate  # Generate Prisma client
npm run db:migrate   # Apply migration files
npm run db:studio    # Open Prisma Studio
npm run db:format    # Format Prisma schema

# Code Quality
npm run lint         # Run ESLint
npm run type-check   # Run TypeScript compiler
```

### Docker Compose Commands

**Pure Docker Compose Setup (Option 1):**
```bash
# Start all services (app + database)
docker compose -f docker-compose.dev.yml up --build

# Start in background
docker compose -f docker-compose.dev.yml up -d --build

# View logs
docker compose -f docker-compose.dev.yml logs -f

# View app logs only
docker compose -f docker-compose.dev.yml logs -f app

# Stop services
docker compose -f docker-compose.dev.yml down

# Access Prisma Studio
docker compose -f docker-compose.dev.yml exec app npm run db:studio

# Run commands in app container
docker compose -f docker-compose.dev.yml exec app npm run <command>
```

**Local Development Setup (Option 2):**
```bash
# Start PostgreSQL only
docker compose -f docker-compose.dev.yml up -d postgres

# Stop PostgreSQL
docker compose -f docker-compose.dev.yml down

# View database logs
docker compose -f docker-compose.dev.yml logs postgres

# Check database status
docker compose -f docker-compose.dev.yml ps
```

### Project Structure

```
src/
├── components/          # React components
│   ├── common/         # Shared components
│   ├── pages/          # Page-specific components
│   └── ui/             # UI component library
├── hooks/              # Custom React hooks
├── lib/                # Utility libraries
├── pages/              # Next.js pages and API routes
├── server/             # Backend logic
│   ├── api/           # tRPC routers
│   └── db.ts          # Database connection
├── types/              # TypeScript type definitions
└── utils/              # Utility functions

# Docker Configuration
docker-compose.dev.yml   # Development Docker Compose setup
Dockerfile.dev           # Development Docker image
docker/                  # Docker-related scripts
  └── init-db.sh        # Database initialization script

# Environment Templates
.env.example            # Environment template (copy to .env)
.env                    # Your environment variables (create from .env.example, gitignored)
```

## Security Features

- Multi-signature security for all transactions
- Cryptographic message signing for wallet verification
- JWT-based authentication
- Comprehensive input validation
- CORS protection
- Nonce system to prevent replay attacks
- End-to-end TypeScript type safety


## Troubleshooting

### Database Connection Issues

```bash
# Check if PostgreSQL is running
docker compose -f docker-compose.dev.yml ps

# View database logs
docker compose -f docker-compose.dev.yml logs postgres

# Restart PostgreSQL
docker compose -f docker-compose.dev.yml restart postgres
```

### Migration Issues

```bash
# Reset database (⚠️ deletes all data)
npm run db:push -- --force-reset

# Check migration status
npx prisma migrate status

# Apply pending migrations
npx prisma migrate deploy
```

### Environment Variables

Ensure all required variables are set in `.env`. The app will show helpful error messages if any are missing.

### Port Conflicts

If port 3000 is already in use:
```bash
# Use a different port
PORT=3001 npm run dev
```

## Supported Networks

- **Mainnet** - Production Cardano network
- **Preprod** - Cardano testnet for development

## License

This project is licensed under the Apache License 2.0 - see the [LICENSE.md](LICENSE.md) file for details.

## Support

- **Discord**: [Join our community](https://discord.gg/eyTT9k2KZq) - look for "ask multisig platform" channel
- **GitHub Issues**: [Report bugs](https://github.com/MeshJS/multisig/issues)
- **GitHub Discussions**: [Ask questions](https://github.com/MeshJS/multisig/discussions)
