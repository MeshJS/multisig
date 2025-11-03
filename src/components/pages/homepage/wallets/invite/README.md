# Invite Components

This directory contains components for the wallet invite system. These components allow users to join existing wallet creation flows and collaborate on wallet setup.

## Overview

The invite system enables collaborative wallet creation by allowing users to:
- Join existing wallet creation flows via invite links
- Add themselves as signers to wallets in progress
- Manage their signer information
- View wallet configuration and advanced settings
- Remove themselves from wallets before creation

## Components

### 1. `index.tsx` - Main Invite Page
**Purpose**: Main page component that orchestrates the invite experience.

**Features**:
- Handles different user states (owner, existing signer, new user)
- Manages signer addition and removal
- Displays wallet information and configuration
- Integrates with wallet state management

**Key Features**:
- **User State Detection**: Determines if user is owner, existing signer, or new
- **Signer Management**: Handles adding and removing signers
- **Advanced Configuration**: Displays external stake credentials and script type
- **Real-time Updates**: Synchronizes with backend changes

### 2. `WalletInfoCard.tsx` - Wallet Information Display
**Purpose**: Displays comprehensive wallet information including advanced configuration.

**Features**:
- Basic wallet information (name, description)
- Signers count and signature requirements
- **Advanced Configuration**: Collapsible section showing:
  - External stake credential hash
  - Script type configuration
  - Informational messages about stake key import behavior
- Status information and progress tracking

**Key Props**:
- `walletName`: Wallet name
- `walletDescription`: Wallet description
- `currentSignersCount`: Number of current signers
- `requiredSignatures`: Required signature count
- `stakeCredentialHash`: External stake credential (optional)
- `scriptType`: Script type configuration (optional)

**Advanced Configuration**:
- **Collapsible Interface**: Advanced settings are hidden by default
- **Stake Credential Display**: Shows external stake credential hash
- **Script Type Display**: Shows human-readable script type
- **User Guidance**: Explains stake key import behavior

### 3. `JoinAsSignerCard.tsx` - New Signer Joining
**Purpose**: Interface for new users to join as signers.

**Features**:
- Signer name input with validation
- **Stake Key Information**: Shows stake key import behavior
- **External Stake Credential Awareness**: Informs users when external stake credential is used
- Join functionality with loading states

**Key Props**:
- `userAddress`: User's payment address
- `stakeAddress`: User's stake address
- `signerName`: Signer name input
- `setSignerName`: Name setter function
- `onJoin`: Join callback function
- `loading`: Loading state
- `hasExternalStakeCredential`: Whether external stake credential is used

**Stake Key Handling**:
- **Normal Mode**: Shows user's stake address and explains it will be imported
- **External Mode**: Shows message that stake key won't be imported due to external credential

### 4. `ManageSignerCard.tsx` - Existing Signer Management
**Purpose**: Interface for existing signers to manage their information.

**Features**:
- Display current signer information
- Edit signer name functionality
- **Stake Key Display**: Shows stake key information or external credential message
- Invite link generation and sharing
- Remove signer functionality (for non-owners)

**Key Props**:
- `userAddress`: User's payment address
- `stakeAddress`: User's stake address
- `signerName`: Current signer name
- `onNameChange`: Name change callback
- `loading`: Loading state
- `walletId`: Wallet ID for invite links
- `isCreator`: Whether user is the wallet creator
- `hasExternalStakeCredential`: Whether external stake credential is used

**Stake Key Display**:
- **Normal Mode**: Shows full stake address
- **External Mode**: Shows informational message about external credential

## Advanced Configuration Support

### External Stake Credential
When a wallet uses an external stake credential:
- **Display**: Shows the stake credential hash in a collapsible section
- **User Guidance**: Explains that stake keys won't be imported
- **Signer Addition**: Automatically skips stake key import for new signers
- **Visual Indicators**: Blue-colored sections highlight advanced configuration

### Script Type Configuration
Displays the configured script type with human-readable descriptions:
- **"atLeast"**: "X of Y must sign"
- **"all"**: "All signers must approve"
- **"any"**: "Any single signer can approve"

## State Management

### Data Flow
- **Wallet Data**: Loaded from backend via `getNewWallet` API
- **User State**: Determined by comparing user address with signers
- **Real-time Updates**: Changes are synchronized across all users
- **Advanced Settings**: External stake credential and script type are properly displayed

### API Integration
- **getNewWallet**: Loads wallet configuration including advanced settings
- **updateNewWalletSigners**: Updates signer information
- **updateNewWalletSignersDescriptions**: Updates signer names

## User Experience

### User States
1. **Owner**: Can manage the wallet and see all information
2. **Existing Signer**: Can edit their information and remove themselves
3. **New User**: Can join as a signer with proper guidance

### Advanced Configuration Awareness
- **Collapsible Display**: Advanced settings don't clutter the interface
- **Clear Messaging**: Users understand stake key import behavior
- **Visual Consistency**: Blue color scheme for advanced configuration
- **Contextual Information**: Relevant information based on configuration

## Development Guidelines

### Component Design
- Follow the established card-based design pattern
- Use consistent styling and spacing
- Implement proper loading and error states
- Ensure responsive design for all screen sizes

### Advanced Configuration
- Always check for external stake credential and script type
- Display information in collapsible sections
- Provide clear user guidance
- Use consistent visual indicators

### State Management
- Use centralized state management
- Implement proper error handling
- Handle edge cases gracefully
- Provide real-time updates

## Error Handling

### Common Scenarios
- **Network Errors**: Proper handling of connectivity issues
- **Validation Errors**: User-friendly validation messages
- **Permission Errors**: Clear messaging for unauthorized actions
- **State Conflicts**: Handling of concurrent modifications

### User Feedback
- **Loading States**: Clear loading indicators
- **Error Messages**: Actionable error messages
- **Success Confirmations**: Clear success feedback
- **Retry Mechanisms**: Options for failed operations

## Integration

### Backend Integration
- **API Endpoints**: Proper integration with wallet APIs
- **Data Synchronization**: Real-time data updates
- **Error Handling**: Comprehensive error handling
- **Validation**: Server-side validation integration

### State Management
- **Centralized State**: Consistent state across components
- **Real-time Updates**: Synchronized changes
- **Error Recovery**: Proper error recovery mechanisms
- **Data Persistence**: Reliable data persistence
