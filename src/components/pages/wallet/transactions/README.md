# Transactions Component

A comprehensive transaction management interface for multisig wallets with transaction history, pending transaction handling, balance display, and mobile-responsive design.

## Features

### Transaction History
- **All Transactions View**: Complete transaction history with on-chain and database transaction data
- **Transaction Details**: Display transaction hash, timestamp, amounts, and signer information
- **Amount Display**: Color-coded amounts (red for outgoing, green for incoming) with proper asset formatting
- **Signer Badges**: Visual representation of transaction signers with descriptive labels
- **CardanoScan Integration**: Direct links to view transactions on CardanoScan explorer
- **Return to Sender**: Quick action to return funds from failed transactions

### Pending Transactions
- **Transaction Cards**: Individual cards for each pending transaction requiring signatures
- **Signing Interface**: Approve/reject buttons for user's signature on pending transactions
- **Signer Status**: Visual indicators showing which signers have signed, rejected, or are pending
- **Discord Integration**: Send reminders to signers via Discord notifications
- **Transaction Actions**: Copy transaction JSON/CBOR, delete transactions, and rebuild options
- **Real-time Updates**: Live status updates as signers approve or reject transactions

### Balance Management
- **Balance Display**: Current wallet balance in ADA with asset count
- **Asset Overview**: Shows total number of non-ADA assets in the wallet
- **Quick Actions**: Direct links to deposit funds or create new transactions
- **Balance Validation**: Prevents new transactions when balance is insufficient

### Send All Functionality
- **Complete Asset Transfer**: Send all assets from multisig wallet to any address
- **Address Input**: Simple interface for entering recipient address
- **UTxO Management**: Automatically selects all available UTxOs for the transaction
- **Transaction Creation**: Creates new multisig transaction for asset transfer

### Mobile Responsiveness
- **Adaptive Layout**: Desktop table view and mobile card layout for transaction history
- **Touch-Friendly**: Optimized for touch interactions on mobile devices
- **Responsive Tables**: Horizontal scrolling with shadow indicators for large tables
- **Stacked Information**: Vertical layout for better mobile readability

## Component Structure

```
transactions/
├── index.tsx                      # Main transactions page component
├── all-transactions.tsx           # Transaction history table component
├── transaction-card.tsx           # Pending transaction card component
├── card-balance.tsx              # Wallet balance display component
├── card-pending-tx.tsx           # Pending transactions count component
├── responsive-transactions-table.tsx # Responsive table implementation
├── scrollable-table-wrapper.tsx  # Horizontal scroll wrapper with shadows
├── send-all.tsx                  # Send all assets functionality
└── README.md                     # This documentation
```

## Key Components

### Main Component (`index.tsx`)
- Orchestrates the entire transactions page layout
- Displays balance card, pending transactions, and transaction history
- Manages responsive grid layout for different screen sizes
- Integrates with wallet hooks for data fetching

### All Transactions (`all-transactions.tsx`)
- Renders complete transaction history in table format
- Handles both on-chain and database transaction data
- Provides transaction row components with detailed information
- Includes "Return to Sender" functionality for failed transactions
- Supports multiple table rendering options (scrollable, responsive)

### Transaction Card (`transaction-card.tsx`)
- Individual card component for pending transactions
- Handles transaction signing and rejection workflows
- Manages Discord reminder functionality
- Displays signer status with visual indicators
- Provides transaction management actions (copy, delete)

### Card Balance (`card-balance.tsx`)
- Displays current wallet balance in ADA
- Shows count of additional assets
- Provides quick action buttons for deposits and new transactions
- Validates balance before allowing new transaction creation

### Responsive Transactions Table (`responsive-transactions-table.tsx`)
- Alternative table implementation with mobile-first design
- Desktop grid layout and mobile card layout
- Consistent transaction information across both views
- Optimized for different screen sizes

### Scrollable Table Wrapper (`scrollable-table-wrapper.tsx`)
- Provides horizontal scrolling for wide transaction tables
- Includes shadow indicators for scroll position
- Custom scrollbar styling for better UX
- Touch-friendly scrolling on mobile devices

### Send All (`send-all.tsx`)
- Interface for sending all wallet assets to a single address
- Simple address input with validation
- Creates multisig transaction for complete asset transfer
- Handles UTxO selection and transaction building

## State Management

### Transaction State
- `pendingTransactions`: Array of transactions awaiting signatures
- `allTransactions`: Complete transaction history from database
- `walletTransactions`: On-chain transaction data from blockchain
- `signedAddresses`: Array of addresses that have signed each transaction
- `rejectedAddresses`: Array of addresses that have rejected transactions

### Balance State
- `balance`: Current wallet balance in ADA (lovelace)
- `walletAssets`: Array of all assets in the wallet
- `nonAdaAssets`: Filtered list of non-ADA assets
- `utxos`: Available UTxOs for balance calculation

### UI State
- `loading`: Loading states for various operations
- `useResponsiveTable`: Toggle between table rendering modes
- `canScrollLeft/Right`: Scroll position indicators for tables

## UI Components Used

- **Radix UI**: Card, Button, DropdownMenu, Badge, Tooltip, Separator
- **Tailwind CSS**: Responsive design and styling
- **Lucide Icons**: ArrowUpRight, MoreHorizontal, Check, X, Loader, Send
- **Custom Components**: CardUI, SectionTitle, RowLabelInfo, LinkCardanoscan
- **Third-party Libraries**: 
  - **Mesh SDK**: Transaction signing and wallet integration
  - **React Toast**: User notifications and feedback

## Responsive Breakpoints

- **Mobile**: `< 640px` - Card layout, stacked controls, horizontal scroll
- **Tablet**: `640px - 1024px` - Hybrid layout with responsive tables
- **Desktop**: `≥ 1024px` - Full table layout with all columns visible

## Asset Handling

- **ADA**: Displayed as "₳" symbol with proper decimal formatting
- **Custom Assets**: Shows asset ticker or unit name with metadata
- **Decimals**: Proper decimal handling for different asset types
- **Metadata Integration**: Uses wallet asset metadata for display names

## Transaction Types

### Pending Transactions
- **State 0**: Awaiting signatures from required signers
- **Signing Process**: Individual signers approve/reject with wallet signatures
- **Completion**: Auto-submit when required signatures are collected
- **Rejection**: Transaction marked as rejected if sufficient rejections

### Completed Transactions
- **State 1**: Successfully submitted to blockchain
- **On-chain Data**: Fetched from blockchain for complete transaction details
- **Database Sync**: Linked with database records for additional metadata
- **Explorer Links**: Direct integration with CardanoScan for verification

## Discord Integration

- **Reminder System**: Send Discord notifications to signers
- **User Mapping**: Links wallet addresses to Discord user IDs
- **Bulk Reminders**: "Remind All" functionality for pending signers
- **Error Handling**: Graceful fallback when Discord integration fails

## Accessibility

- **Keyboard Navigation**: Full keyboard support for all interactive elements
- **Screen Readers**: Proper ARIA labels and semantic HTML structure
- **Focus Management**: Clear focus indicators and logical tab order
- **Color Contrast**: Sufficient contrast for all text and status indicators
- **Touch Targets**: Appropriately sized touch targets for mobile devices

## Error Handling

- **Transaction Validation**: Ensures transaction data integrity
- **Signature Verification**: Validates wallet signatures before submission
- **Network Errors**: Handles blockchain connectivity issues
- **User Feedback**: Toast notifications for all user actions
- **Graceful Degradation**: Fallback UI when data is unavailable

## Performance

- **Lazy Loading**: Transaction data loaded on demand
- **Memoization**: Optimized re-renders with React.memo and useMemo
- **Pagination**: Efficient rendering of large transaction lists
- **State Optimization**: Minimal state updates to prevent unnecessary re-renders
- **Scroll Optimization**: Efficient horizontal scrolling with shadow indicators

## Security

- **Signature Verification**: Cryptographic verification of all signatures
- **Address Validation**: Ensures all addresses are properly formatted
- **Transaction Integrity**: Validates transaction structure before submission
- **User Authentication**: Requires wallet connection for all signing operations
