# Create Step Components

This directory contains all components for the **Create** step of the new wallet flow. The Create step is where users review and configure all wallet parameters before final creation.

## Overview

The Create step (`/wallets/new-wallet-flow/create/[id]`) is the second step in the 3-step wallet creation process. It provides a comprehensive review and configuration interface where users can:

- Review and edit wallet information
- Manage signers (add/remove/edit)
- Configure signature requirements
- Set advanced options (stake credential, script type)
- Preview the native script
- Generate invite links for collaboration

## Components

### 1. `index.tsx` - Main Create Page
**Purpose**: Main page component that orchestrates the entire create step experience.

**Features**:
- Integrates all review components
- Handles navigation and state management
- Provides the main layout and structure
- Manages the final wallet creation process

**Key Props**:
- Uses `useWalletFlowState` hook for centralized state management
- Handles wallet creation and blockchain deployment

### 2. `ReviewWalletInfoCard.tsx` - Wallet Information Review
**Purpose**: Allows users to review and edit basic wallet information.

**Features**:
- Displays current wallet name and description
- Provides inline editing capabilities
- Real-time validation and feedback
- Auto-saves changes to backend

**Key Props**:
- `name`: Current wallet name
- `description`: Current wallet description
- `onSave`: Callback for saving changes

### 3. `ReviewSignersCard.tsx` - Signers Management
**Purpose**: Comprehensive signers management interface.

**Features**:
- Displays all current signers with addresses and stake keys
- Add new signers with validation
- Remove existing signers
- Edit signer information
- Generate and manage invite links
- Real-time validation for addresses and stake keys

**Key Props**:
- `signerConfig`: Complete signer configuration object
- `currentUserAddress`: Current user's address
- `walletId`: Wallet ID for invite link generation
- `onSave`: Callback for saving signer changes

### 4. `ReviewRequiredSignersCard.tsx` - Signature Requirements
**Purpose**: Configure signature requirements and script type.

**Features**:
- Set number of required signers
- Choose native script type (all/any/atLeast)
- Real-time validation
- Visual feedback for configuration changes

**Key Props**:
- `numRequiredSigners`: Current required signers count
- `nativeScriptType`: Current script type
- `totalSigners`: Total number of signers
- `onSave`: Callback for saving changes

### 5. `CollapsibleAdvancedSection.tsx` - Advanced Configuration
**Purpose**: Advanced wallet configuration options.

**Features**:
- Collapsible interface for advanced options
- Stake credential hash configuration
- Support for both hash and reward address input
- Script type configuration
- Native script preview
- Real-time validation and conversion

**Key Props**:
- `advancedConfig`: Advanced configuration object
- `mWallet`: MultisigWallet instance for preview
- `onSave`: Callback for saving advanced settings

### 6. `ReviewNativeScript.tsx` - Native Script Preview
**Purpose**: Preview the generated native script.

**Features**:
- Displays the complete native script
- Shows script type and parameters
- Provides copy functionality
- Real-time updates when configuration changes

**Key Props**:
- `mWallet`: MultisigWallet instance to preview

### 7. `InviteLinkCard.tsx` - Invite Link Management
**Purpose**: Generate and manage invite links for collaboration.

**Features**:
- Generate invite links for wallet collaboration
- Copy link functionality
- Share with other potential signers
- Integration with the signers management

**Key Props**:
- `walletId`: Wallet ID for link generation
- `onCopy`: Callback for copy actions

## State Management

All components use the centralized `useWalletFlowState` hook for:
- Consistent state across all components
- Real-time synchronization
- Automatic backend persistence
- Validation and error handling

## User Experience

### Flow
1. **Review**: Users see all current configuration
2. **Edit**: Click edit buttons to modify settings
3. **Validate**: Real-time validation provides immediate feedback
4. **Save**: Changes are automatically saved to backend
5. **Preview**: Native script updates in real-time
6. **Create**: Final wallet creation with blockchain deployment

### Key Features
- **Real-time Updates**: All changes are immediately reflected
- **Auto-save**: Changes are automatically persisted
- **Validation**: Comprehensive validation with user-friendly messages
- **Collaboration**: Invite system for team workflows
- **Preview**: Native script preview for transparency

## Integration

The Create step integrates with:
- **Backend APIs**: For data persistence and wallet creation
- **Blockchain**: For final wallet deployment
- **State Management**: Centralized state via `useWalletFlowState`
- **Navigation**: Seamless flow between steps

## Development Guidelines

### Adding New Components
1. Follow the established card-based design pattern
2. Use `useWalletFlowState` for state management
3. Implement proper validation and error handling
4. Add comprehensive prop types and documentation
5. Ensure responsive design for all screen sizes

### State Management
- Always use the centralized state hook
- Don't create local state that duplicates flow state
- Use provided save callbacks for persistence
- Implement proper loading and error states

### Validation
- Use the provided validation flags
- Implement real-time validation feedback
- Provide clear, actionable error messages
- Handle edge cases gracefully
