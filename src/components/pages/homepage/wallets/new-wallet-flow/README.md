# New Wallet Flow Component

A comprehensive multi-step wallet creation flow for Cardano multisig wallets, designed to provide a streamlined user experience for creating, configuring, and finalizing multisig wallets.

## Overview

The new wallet flow is a 3-step process that guides users through:
1. **Save** - Initial wallet setup and basic information
2. **Create** - Review and configure all wallet parameters
3. **Ready** - Success confirmation and wallet details

## Architecture

### Directory Structure

```
new-wallet-flow/
├── create/                    # Step 2: Review and create wallet
│   ├── index.tsx             # Main create page component
│   ├── ReviewWalletInfoCard.tsx
│   ├── ReviewSignersCard.tsx
│   ├── ReviewRequiredSignersCard.tsx
│   ├── CollapsibleAdvancedSection.tsx
│   ├── InviteLinkCard.tsx
│   ├── ReviewNativeScript.tsx
│   └── README.md             # Create step documentation
├── save/                     # Step 1: Initial wallet setup
│   ├── index.tsx             # Main save page component
│   ├── nWInfoCard.tsx        # Wallet info input card
│   ├── nWSignerInfoCard.tsx  # User signer info card
│   └── README.md             # Save step documentation
├── ready/                    # Step 3: Success confirmation
│   ├── index.tsx             # Success page component
│   └── README.md             # Ready step documentation
├── shared/                   # Shared components and utilities
│   ├── WalletFlowPageLayout.tsx    # Common layout wrapper
│   ├── ProgressIndicator.tsx       # Step progress indicator
│   ├── useWalletFlowState.tsx      # Centralized state management
│   ├── GlassMorphismPageWrapper.tsx
│   └── README.md             # Shared components documentation
└── README.md                 # This main documentation
```

### Related Components

```
invite/                       # Wallet invite system
├── index.tsx                 # Main invite page
├── WalletInfoCard.tsx        # Wallet information display
├── JoinAsSignerCard.tsx      # New signer joining
├── ManageSignerCard.tsx      # Existing signer management
└── README.md                 # Invite system documentation
```

## Key Components

### 1. Shared State Management (`useWalletFlowState.tsx`)

**Purpose**: Centralized state management hook that eliminates code duplication across all flow pages.

**Key Features**:
- Consolidates 300-400 lines of duplicate state management code
- Provides unified interface for wallet data, signers, and configuration
- Handles API mutations for create, save, and update operations
- Manages validation logic for each step
- Provides save callbacks for individual card components

**State Structure**:
```typescript
interface WalletFlowState {
  // Core wallet data
  name: string;
  description: string;
  
  // Signers management
  signersAddresses: string[];
  signersDescriptions: string[];
  signersStakeKeys: string[];
  
  // Signature rules
  numRequiredSigners: number;
  nativeScriptType: "all" | "any" | "atLeast";
  
  // Advanced options
  stakeKey: string;
  
  // Computed values
  multisigWallet?: MultisigWallet;
  isValidForSave: boolean;
  isValidForCreate: boolean;
  
  // Actions and mutations
  createNativeScript: () => void;
  handleSaveWalletInfo: (name: string, description: string) => void;
  // ... and more
}
```

### 2. Layout Component (`WalletFlowPageLayout.tsx`)

**Purpose**: Consistent layout wrapper for all flow pages.

**Features**:
- Responsive design with mobile-first approach
- Integrated progress indicator
- Consistent spacing and typography
- Eliminates 150+ lines of duplicate layout code

### 3. Progress Indicator (`ProgressIndicator.tsx`)

**Purpose**: Visual progress tracking through the 3-step flow.

**Steps**:
1. **Save** - Initial setup
2. **Create** - Review and configure
3. **Ready** - Success confirmation

## Flow Steps

### Step 1: Save (`/wallets/new-wallet-flow/save`)

**Purpose**: Initial wallet setup with basic information.

**Components**:
- `WalletInfoCard` - Name and description input
- `SignerInfoCard` - Current user's signer information

**Actions**:
- Save wallet information to backend
- Generate invite link for collaboration
- Navigate to create step

### Step 2: Create (`/wallets/new-wallet-flow/create/[id]`)

**Purpose**: Comprehensive review and configuration of all wallet parameters.

**Components**:
- `ReviewWalletInfoCard` - Edit wallet name and description
- `ReviewSignersCard` - Manage signers (add/remove/edit)
- `ReviewRequiredSignersCard` - Configure signature requirements
- `CollapsibleAdvancedSection` - Advanced options (stake key, script type)

**Features**:
- Real-time validation
- Individual save functionality for each section
- Native script preview
- Final creation with blockchain deployment

### Step 3: Ready (`/wallets/new-wallet-flow/ready/[id]`)

**Purpose**: Success confirmation and wallet details display.

**Features**:
- Success notification
- Complete wallet information display
- Copy functionality for wallet address and DRep ID
- Navigation to wallet management or wallet details

## Key Features

### 1. State Persistence
- All changes are automatically saved to the backend
- Users can leave and return to any step without losing progress
- Real-time synchronization across all flow pages

### 2. Validation
- Real-time validation for all inputs
- Comprehensive error handling
- User-friendly validation messages

### 3. Responsive Design
- Mobile-first approach
- Adaptive layouts for different screen sizes
- Touch-friendly interface elements

### 4. User Experience
- Clear progress indication
- Intuitive navigation
- Consistent visual design
- Helpful tooltips and guidance

### 5. Collaboration Support
- Invite link generation for team collaboration
- Shared wallet configuration
- Multi-user editing capabilities

### 6. Advanced Configuration
- **External Stake Credential**: Support for external stake credential hash
- **Dual Input Methods**: Both stake key hash and reward address input
- **Script Type Configuration**: Support for all/any/atLeast script types
- **Smart Stake Key Import**: Automatic handling of stake key import based on configuration
- **Collapsible Advanced Settings**: Clean interface with expandable advanced options

## API Integration

The flow integrates with several API endpoints:

- `api.wallet.createNewWallet` - Initial wallet creation
- `api.wallet.updateNewWallet` - Update wallet configuration
- `api.wallet.createWallet` - Final wallet deployment
- `api.wallet.getNewWallet` - Retrieve wallet data
- `api.wallet.deleteNewWallet` - Cleanup temporary data

## Usage Examples

### Basic Flow Usage

```typescript
// In any flow page component
import { useWalletFlowState } from '@/components/pages/homepage/wallets/new-wallet-flow/shared/useWalletFlowState';

export default function MyFlowPage() {
  const walletFlow = useWalletFlowState();
  
  return (
    <WalletFlowPageLayout currentStep={1}>
      {/* Your page content */}
    </WalletFlowPageLayout>
  );
}
```

### Accessing State

```typescript
const {
  name,
  setName,
  signersAddresses,
  addSigner,
  isValidForCreate,
  createNativeScript
} = useWalletFlowState();
```

### Saving Changes

```typescript
// Save wallet info
walletFlow.handleSaveWalletInfo(newName, newDescription);

// Save signers
walletFlow.handleSaveSigners(addresses, descriptions, stakeKeys);

// Save signature rules
walletFlow.handleSaveSignatureRules(numRequired);
```

## Development Guidelines

### 1. State Management
- Always use `useWalletFlowState` for state access
- Don't create local state that duplicates flow state
- Use provided save callbacks for individual components

### 2. Component Structure
- Use `WalletFlowPageLayout` for consistent layout
- Follow the established card-based design pattern
- Implement proper loading and error states

### 3. Validation
- Use the provided validation flags (`isValidForSave`, `isValidForCreate`)
- Implement real-time validation feedback
- Provide clear error messages

### 4. API Integration
- Use the provided mutation functions
- Handle loading states appropriately
- Implement proper error handling

## Migration from Legacy Flow

The new wallet flow replaces the legacy single-page wallet creation (`/wallets/new-wallet`). Key improvements:

1. **Better UX**: Step-by-step process reduces cognitive load
2. **Code Reuse**: Shared state management eliminates duplication
3. **Collaboration**: Built-in invite system for team workflows
4. **Validation**: Real-time validation with better error handling
5. **Responsive**: Mobile-optimized design

## Future Enhancements

Potential areas for improvement:

1. **Templates**: Pre-configured wallet templates
2. **Import/Export**: Wallet configuration backup/restore
3. **Advanced Scripts**: Support for more complex native scripts
4. **Batch Operations**: Create multiple wallets simultaneously
5. **Analytics**: Usage tracking and optimization insights

## Troubleshooting

### Common Issues

1. **State Not Updating**: Ensure you're using `useWalletFlowState` hook
2. **Validation Errors**: Check that all required fields are filled
3. **API Errors**: Verify network connection and user authentication
4. **Navigation Issues**: Ensure proper route handling in Next.js

### Debug Mode

Enable debug logging by setting `NODE_ENV=development` to see detailed state changes and API calls.

## Documentation Structure

Each component directory contains comprehensive documentation:

- **`/create/README.md`**: Detailed documentation for all create step components
- **`/save/README.md`**: Documentation for save step components and flow
- **`/ready/README.md`**: Documentation for ready step and success handling
- **`/shared/README.md`**: Documentation for shared components and utilities
- **`/invite/README.md`**: Documentation for the invite system and collaboration

Each README includes:
- Component overview and purpose
- Detailed feature descriptions
- Props and interfaces
- Usage examples
- Integration guidelines
- Development best practices

## Contributing

When contributing to the new wallet flow:

1. Follow the established patterns and conventions
2. Update the relevant README files for any changes
3. Ensure all new components are properly documented
4. Test across all supported devices and browsers
5. Maintain backward compatibility where possible
6. Update documentation for any new features or changes
