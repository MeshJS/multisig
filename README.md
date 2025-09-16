# Mesh Multi-Sig Wallet

A comprehensive, enterprise-grade multi-signature wallet solution built on Cardano, designed for teams, DAOs, and organizations to securely manage treasury funds and participate in governance.

[![Next.js](https://img.shields.io/badge/Next.js-14.2.4-black)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5.3-blue)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.4.1-2D3748)](https://www.prisma.io/)
[![Mesh SDK](https://img.shields.io/badge/Mesh%20SDK-1.9.0--beta.18-orange)](https://meshjs.dev/)

## Features

### Multi-Signature Wallet Management
- **Create Multi-Sig Wallets**: Set up wallets with customizable signer requirements
- **Flexible Signing Thresholds**: Choose between "all", "any", or "at least N" signing schemes
- **Signer Management**: Add/remove signers with descriptive labels and verification
- **Wallet Migration**: Seamlessly migrate to new wallet configurations
- **Multi-Asset Support**: Manage ADA and custom tokens in a single wallet

### Advanced Transaction Management
- **Intuitive Transaction Creation**: User-friendly interface for creating complex transactions
- **UTxO Selection**: Manual or automatic UTxO selection with visual highlighting
- **Recipient Management**: 
  - Add multiple recipients with different assets
  - Quick-add self and signer addresses
  - CSV import/export for bulk operations
  - ADA Handle resolution support
- **Transaction Descriptions**: Add context for signers with descriptions and metadata
- **Deposit Functionality**: Easy deposits from personal wallets to multi-sig wallets
- **Send All Assets**: Option to send all available assets in one transaction

### Governance & DRep Integration
- **DRep Registration**: Register your team as a Delegated Representative
- **Governance Participation**: View and vote on Cardano governance proposals
- **Team Voting**: Collaborative decision-making for governance actions
- **On-Chain Transparency**: All governance actions recorded on the blockchain

### Staking & Delegation
- **Stake Pool Delegation**: Delegate to any Cardano stake pool
- **Reward Management**: Withdraw staking rewards through multi-sig
- **Stake Registration**: Register and deregister stake addresses
- **Multi-Sig Staking**: Secure staking operations requiring multiple signatures

### Collaboration & Communication
- **Real-Time Chat**: Built-in Nostr-based chat for team communication
- **Discord Integration**: 
  - Discord notifications for pending transactions
  - User verification through Discord
  - Avatar integration
- **Signer Verification**: Message signing to verify wallet ownership
- **Transaction Notifications**: Automated alerts for required signatures

### Developer & API Features
- **RESTful API**: Comprehensive API for wallet operations
- **tRPC Integration**: Type-safe API with React Query
- **Swagger Documentation**: Interactive API documentation
- **JWT Authentication**: Secure token-based authentication
- **Database Management**: PostgreSQL with Prisma ORM
- **File Storage**: Vercel Blob integration for asset storage

### User Experience
- **Responsive Design**: Mobile-first design with desktop optimization
- **Dark/Light Mode**: Theme switching support
- **Real-Time Updates**: Live transaction status updates
- **Transaction History**: Comprehensive transaction tracking
- **Asset Management**: Detailed asset portfolio view
- **Error Handling**: Robust error handling with user-friendly messages

## Architecture

### Frontend
- **Next.js 14**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first styling
- **Framer Motion**: Smooth animations
- **Radix UI**: Accessible component primitives
- **React Hook Form**: Form management
- **Zustand**: State management

### Backend
- **tRPC**: End-to-end typesafe APIs
- **Prisma**: Database ORM with PostgreSQL
- **NextAuth.js**: Authentication system
- **JWT**: Token-based authentication
- **CORS**: Cross-origin resource sharing

### Blockchain Integration
- **Mesh SDK**: Cardano blockchain interaction
- **Native Scripts**: Multi-signature script generation
- **UTxO Management**: Advanced UTxO handling
- **Transaction Building**: Comprehensive transaction construction

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
- Node.js 18+ 
- PostgreSQL database
- Cardano wallet (Nami, Eternl, etc.)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/your-org/multisig.git
   cd multisig
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Configure the following variables:
   ```env
   DATABASE_URL="postgresql://username:password@localhost:5432/multisig"
   NEXTAUTH_SECRET="your-secret-key"
   NEXTAUTH_URL="http://localhost:3000"
   JWT_SECRET="your-jwt-secret"
   DISCORD_CLIENT_ID="your-discord-client-id"
   DISCORD_CLIENT_SECRET="your-discord-client-secret"
   DISCORD_BOT_TOKEN="your-discord-bot-token"
   DISCORD_GUILD_ID="your-discord-guild-id"
   ```

4. **Set up the database**
   ```bash
   npm run db:push
   npm run db:generate
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

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

## Development

### Available Scripts

```bash
# Development
npm run dev          # Start development server
npm run build        # Build for production
npm run start        # Start production server

# Database
npm run db:push      # Push schema changes to database
npm run db:generate  # Generate Prisma client
npm run db:studio    # Open Prisma Studio
npm run db:format    # Format Prisma schema

# Code Quality
npm run lint         # Run ESLint
npm run type-check   # Run TypeScript compiler
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
```

## Security Features

- **Multi-signature Security**: All transactions require multiple signatures
- **Message Signing**: Cryptographic verification of wallet ownership
- **JWT Authentication**: Secure token-based authentication
- **Input Validation**: Comprehensive input sanitization and validation
- **CORS Protection**: Cross-origin request security
- **Nonce System**: Replay attack prevention

## Supported Networks

- **Mainnet**: Production Cardano network
- **Preprod**: Cardano testnet for development and testing


## License

This project is licensed under the Apache License - see the [LICENSE.md](LICENSE.md) file for details.

## Support

- **Documentation**: Check our documentation
- **Issues**: Report bugs and request features on GitHub Issues
- **Discord**: Join our Discord community for support at [https://discord.gg/jQZVcMbdKU](https://discord.gg/jQZVcMbdKU)


---

**Built for the Cardano ecosystem**
