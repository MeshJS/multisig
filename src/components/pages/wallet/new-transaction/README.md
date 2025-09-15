# New Transaction Component

A comprehensive transaction creation interface for multisig wallets with UTxO selection, recipient management, and mobile-responsive design.

## Features

### Recipient Management
- **Add Recipient**: Standard recipient addition with address, amount, and asset selection
- **Add Self**: Quick-add the multisig wallet's own address as a recipient
- **Add Signer**: Dropdown menu to add any multisig signer as a recipient using their descriptive labels
- **Multiple Instances**: Allow adding the same address multiple times as separate recipients
- **Asset Selection**: Choose from available wallet assets (ADA and custom tokens)
- **Address Resolution**: Support for ADA Handle resolution (e.g., `$handle`)
- **CSV Import/Export**: Bulk recipient management through CSV file upload and download
  - **CSV Format**: `address,unit,amount` (header row supported)
  - **Drag & Drop**: Intuitive file upload interface
  - **Asset Validation**: Validates assets against wallet holdings
  - **Export Functionality**: Download current recipients as CSV

### UTxO Selection
- **Manual Selection**: Toggle between automatic and manual UTxO selection
- **Visual Highlighting**: Selected UTxOs are highlighted with blue background and left border
- **Row Interaction**: Click/tap entire UTxO row to toggle selection
- **Checkbox Control**: Individual checkbox selection with click event handling
- **Select All/Deselect All**: Bulk selection controls
- **Pagination**: Configurable page sizes (10, 20, 50, 100, 200 UTxOs per page)
- **Blocked UTxOs**: Visual indication of UTxOs that cannot be selected

### Transaction Summary
- **Funds Overview**: Real-time calculation of available funds from selected UTxOs
- **Recipient Requirements**: Display required amounts for each recipient
- **Balance Calculation**: Show remaining/change amounts for each asset
- **Sufficiency Indicators**: Color-coded feedback (green for sufficient, red for insufficient)
- **Mobile-Friendly**: Responsive layout with stacked information on mobile

### Transaction Configuration
- **Description**: Optional transaction description for signers (max 128 characters)
- **On-chain Metadata**: Optional metadata attached to blockchain transaction (max 64 characters)
- **Transaction Options**: Additional settings and configuration options
- **Character Limits**: Real-time character counting with validation

### Deposit Functionality
- **Wallet Deposit**: Deposit funds from user's personal wallet to the multisig wallet
- **Multi-Asset Support**: Deposit ADA and custom tokens in a single transaction
- **UTxO Management**: Automatic UTxO selection using `keepRelevant` algorithm
- **Asset Aggregation**: Combines multiple deposits of the same asset type
- **Balance Display**: Shows user's current wallet balance and available assets
- **Deposit Summary**: Real-time calculation of total deposit amounts per asset
- **Metadata Support**: Optional metadata attachment to deposit transactions

### Mobile Responsiveness
- **Adaptive Layout**: Desktop table view and mobile card layout
- **Touch-Friendly**: Optimized for touch interactions
- **Responsive Controls**: Buttons and inputs sized appropriately for mobile
- **Stacked Information**: Vertical layout for better mobile readability

## Component Structure

```
new-transaction/
├── index.tsx              # Main transaction creation component
├── RecipientRow.tsx       # Individual recipient row component
├── RecipientCsv.tsx       # CSV import/export functionality
├── utxoSelector.tsx       # UTxO selection and management
├── deposit/
│   └── index.tsx          # Deposit functionality for multisig wallet
└── README.md             # This documentation
```

## Key Components

### Main Component (`index.tsx`)
- Manages recipient state (addresses, amounts, assets)
- Handles "Add Self" and "Add Signer" functionality
- Provides responsive layout switching
- Integrates UTxO selector with recipient data
- Manages transaction description and metadata
- Handles transaction creation and submission

### Recipient Row (`RecipientRow.tsx`)
- Renders both desktop table row and mobile card layout
- Handles address input with ADA Handle resolution
- Manages amount and asset selection
- Provides delete functionality

### Recipient CSV (`RecipientCsv.tsx`)
- CSV file import with drag & drop interface
- Asset validation against wallet holdings
- Export current recipients to CSV format
- Handles CSV parsing and error reporting

### UTxO Selector (`utxoSelector.tsx`)
- Displays available UTxOs with pagination
- Manages selection state and visual feedback
- Calculates and displays transaction summary
- Handles blocked UTxO detection

### Deposit Component (`deposit/index.tsx`)
- Manages deposit transactions from user wallet to multisig wallet
- Handles multi-asset deposits with automatic aggregation
- Uses `keepRelevant` algorithm for optimal UTxO selection
- Displays user wallet balance and available assets
- Supports metadata attachment to deposit transactions

## State Management

### Recipient State
- `recipientAddresses`: Array of recipient addresses
- `amounts`: Array of amounts for each recipient
- `assets`: Array of selected assets for each recipient

### Transaction State
- `description`: Transaction description for signers (max 128 chars)
- `metadata`: On-chain metadata (max 64 chars)
- `addDescription`: Boolean to enable/disable description
- `sendAllAssets`: Boolean for sending all available assets

### UTxO State
- `selectedUtxos`: Array of selected UTxOs
- `blockedUtxos`: Array of UTxOs that cannot be selected
- `manualSelected`: Boolean for manual vs automatic selection mode

### Deposit State
- `UTxoCount`: Number of deposit UTxOs to create
- `amounts`: Array of deposit amounts for each UTxO
- `assets`: Array of asset types for each deposit
- `userBalance`: Current user wallet balance in ADA
- `userAssets`: Available assets in user's wallet
- `assetsWithAmounts`: Aggregated deposit amounts by asset type

## UI Components Used

- **Radix UI**: Select, DropdownMenu, Checkbox, Button
- **Tailwind CSS**: Responsive design and styling
- **Lucide Icons**: PlusCircle, ChevronDown, X, etc.
- **Custom Components**: CardUI, SectionTitle, etc.
- **Third-party Libraries**: 
  - **Papa Parse**: CSV file parsing
  - **React Dropzone**: Drag & drop file upload
  - **React Toast**: User notifications

## Responsive Breakpoints

- **Mobile**: `< 640px` - Card layout, stacked controls
- **Desktop**: `≥ 640px` - Table layout, horizontal controls

## Asset Handling

- **ADA**: Internally stored as "lovelace", displayed as "ADA"
- **Custom Assets**: Displayed using asset name or ticker
- **Decimals**: Proper decimal handling for different asset types
- **Metadata**: Integration with wallet asset metadata

## Accessibility

- **Keyboard Navigation**: Full keyboard support for all controls
- **Screen Readers**: Proper ARIA labels and semantic HTML
- **Focus Management**: Clear focus indicators and logical tab order
- **Color Contrast**: Sufficient contrast for all text and UI elements

## Error Handling

- **Address Validation**: Real-time address format validation
- **Amount Validation**: Numeric input validation
- **Asset Validation**: Ensures selected assets exist in wallet
- **UTxO Validation**: Prevents selection of blocked UTxOs
- **CSV Validation**: Validates CSV format and asset availability
- **Character Limits**: Enforces description (128) and metadata (64) limits
- **Deposit Validation**: Ensures sufficient funds for deposit transactions
- **Toast Notifications**: User-friendly error messages and feedback

## Performance

- **Pagination**: Efficient rendering of large UTxO lists
- **Memoization**: Optimized re-renders with React.memo and useMemo
- **Lazy Loading**: UTxO data loaded on demand
- **State Optimization**: Minimal state updates to prevent unnecessary re-renders
