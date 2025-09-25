# Save Step Components

This directory contains all components for the **Save** step of the new wallet flow. The Save step is the initial setup where users provide basic wallet information and generate invite links.

## Overview

The Save step (`/wallets/new-wallet-flow/save`) is the first step in the 3-step wallet creation process. It focuses on initial wallet setup and collaboration preparation:

- Basic wallet information input
- Current user signer information
- Invite link generation for collaboration
- Navigation to the create step

## Components

### 1. `index.tsx` - Main Save Page
**Purpose**: Main page component that orchestrates the save step experience.

**Features**:
- Integrates wallet info and signer info cards
- Handles initial wallet creation
- Manages navigation to create step
- Provides the main layout and structure

**Key Features**:
- Uses `useWalletFlowState` hook for centralized state management
- Handles initial wallet creation and invite link generation
- Manages step progression and navigation

### 2. `nWInfoCard.tsx` - Wallet Information Input
**Purpose**: Input form for basic wallet information.

**Features**:
- Wallet name input with validation
- Wallet description input (optional)
- Real-time validation and feedback
- Character limits and validation rules
- Auto-saves changes to backend

**Key Props**:
- `name`: Current wallet name
- `description`: Current wallet description
- `onSave`: Callback for saving wallet information
- `loading`: Loading state for save operations

**Validation Rules**:
- Name is required and must be non-empty
- Description is optional
- Character limits enforced for both fields

### 3. `nWSignerInfoCard.tsx` - Current User Signer Information
**Purpose**: Displays and manages the current user's signer information.

**Features**:
- Shows current user's address and stake key
- Displays user information in read-only format
- Provides context for the user's role in the wallet
- Integrates with user authentication system

**Key Props**:
- `userAddress`: Current user's payment address
- `stakeAddress`: Current user's stake address
- `userName`: Current user's name/identifier

**Data Sources**:
- User authentication system
- Wallet state management
- User profile information

## State Management

The Save step uses the centralized `useWalletFlowState` hook for:
- Wallet information state
- User information integration
- Backend persistence
- Navigation state management

## User Experience

### Flow
1. **Input**: Users enter wallet name and description
2. **Review**: Current user information is displayed
3. **Save**: Wallet information is saved to backend
4. **Invite**: Invite link is generated for collaboration
5. **Navigate**: Users proceed to create step

### Key Features
- **Simple Setup**: Minimal required information for quick start
- **Auto-save**: Changes are automatically persisted
- **User Context**: Clear display of user's role and information
- **Collaboration Ready**: Invite link generation for team workflows

## Integration

The Save step integrates with:
- **User Authentication**: For current user information
- **Backend APIs**: For wallet creation and persistence
- **State Management**: Centralized state via `useWalletFlowState`
- **Navigation**: Seamless progression to create step

## Development Guidelines

### Component Design
- Follow the established card-based design pattern
- Use consistent form styling and validation
- Implement proper loading and error states
- Ensure responsive design for all screen sizes

### State Management
- Use the centralized state hook for all data
- Implement proper validation and error handling
- Use provided save callbacks for persistence
- Handle edge cases gracefully

### Validation
- Implement real-time validation feedback
- Provide clear, actionable error messages
- Use consistent validation patterns across components
- Handle network errors and edge cases

## API Integration

### Wallet Creation
- `createNewWallet`: Creates initial wallet record
- Includes all basic information and user data
- Generates unique wallet ID for collaboration

### Data Persistence
- All changes are automatically saved
- Real-time synchronization with backend
- Proper error handling and retry logic

## Error Handling

### Common Scenarios
- Network connectivity issues
- Validation errors
- Backend service errors
- User input errors

### User Feedback
- Clear error messages
- Loading states during operations
- Success confirmations
- Retry mechanisms for failed operations
