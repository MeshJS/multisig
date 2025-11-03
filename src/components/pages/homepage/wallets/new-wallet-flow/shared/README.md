# Shared Components

This directory contains shared components and utilities used across all steps of the new wallet flow. These components provide consistent functionality and design patterns.

## Overview

The shared components provide:
- Consistent layout and design patterns
- Centralized state management
- Common UI components
- Utility functions and hooks

## Components

### 1. `useWalletFlowState.tsx` - Centralized State Management
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

**Usage**:
```typescript
const walletFlow = useWalletFlowState();
const { name, setName, signersAddresses, addSigner } = walletFlow;
```

### 2. `WalletFlowPageLayout.tsx` - Common Layout Wrapper
**Purpose**: Consistent layout wrapper for all flow pages.

**Features**:
- Responsive design with mobile-first approach
- Integrated progress indicator
- Consistent spacing and typography
- Eliminates 150+ lines of duplicate layout code

**Props**:
- `currentStep`: Current step number (1, 2, or 3)
- `children`: Page content
- `title`: Optional page title override

**Usage**:
```typescript
<WalletFlowPageLayout currentStep={2}>
  {/* Your page content */}
</WalletFlowPageLayout>
```

### 3. `ProgressIndicator.tsx` - Step Progress Tracking
**Purpose**: Visual progress tracking through the 3-step flow.

**Steps**:
1. **Save** - Initial setup
2. **Create** - Review and configure
3. **Ready** - Success confirmation

**Features**:
- Visual step indicators
- Current step highlighting
- Completed step indication
- Responsive design

**Props**:
- `currentStep`: Current step number (1, 2, or 3)
- `className`: Optional additional CSS classes

### 4. `GlassMorphismPageWrapper.tsx` - Page Background
**Purpose**: Consistent page background and styling.

**Features**:
- Glass morphism design effect
- Consistent background styling
- Responsive layout
- Dark/light mode support

**Usage**:
```typescript
<GlassMorphismPageWrapper>
  {/* Your page content */}
</GlassMorphismPageWrapper>
```

## State Management

### Centralized State Hook
The `useWalletFlowState` hook provides:
- **Unified Interface**: Single source of truth for all wallet data
- **Real-time Sync**: Automatic synchronization across all components
- **Backend Integration**: Seamless API integration for persistence
- **Validation**: Built-in validation logic for all steps
- **Error Handling**: Comprehensive error handling and user feedback

### State Persistence
- All changes are automatically saved to the backend
- Real-time synchronization across all flow pages
- Users can leave and return to any step without losing progress
- Proper error handling and retry logic

## Design Patterns

### Card-Based Design
All components follow a consistent card-based design pattern:
- Consistent spacing and typography
- Unified color scheme and styling
- Responsive design for all screen sizes
- Proper loading and error states

### Component Structure
- **Props Interface**: Clear, typed prop interfaces
- **State Management**: Centralized state via `useWalletFlowState`
- **Validation**: Real-time validation with user feedback
- **Error Handling**: Comprehensive error handling

## Development Guidelines

### Using Shared Components
1. **State Management**: Always use `useWalletFlowState` for state access
2. **Layout**: Use `WalletFlowPageLayout` for consistent page structure
3. **Progress**: Use `ProgressIndicator` for step tracking
4. **Styling**: Follow the established design patterns

### Creating New Components
1. **Follow Patterns**: Use established component patterns
2. **State Integration**: Integrate with centralized state management
3. **Validation**: Implement proper validation and error handling
4. **Responsive**: Ensure responsive design for all screen sizes
5. **Documentation**: Provide comprehensive prop documentation

### State Management Best Practices
- **Single Source**: Use centralized state hook for all data
- **No Duplication**: Don't create local state that duplicates flow state
- **Save Callbacks**: Use provided save callbacks for persistence
- **Validation**: Use provided validation flags and logic

## API Integration

### Backend Operations
- **Create**: Initial wallet creation
- **Update**: Real-time updates and persistence
- **Validation**: Server-side validation and error handling
- **Synchronization**: Real-time data synchronization

### Error Handling
- **Network Errors**: Proper handling of connectivity issues
- **Validation Errors**: User-friendly validation messages
- **Retry Logic**: Automatic retry for failed operations
- **User Feedback**: Clear error messages and recovery options

## Performance Considerations

### Optimization
- **State Management**: Efficient state updates and re-renders
- **API Calls**: Optimized API calls with proper caching
- **Component Rendering**: Efficient component rendering patterns
- **Memory Management**: Proper cleanup and memory management

### Best Practices
- **Lazy Loading**: Implement lazy loading where appropriate
- **Memoization**: Use React.memo and useMemo for optimization
- **Bundle Size**: Keep bundle size optimized
- **Loading States**: Implement proper loading states

## Testing

### Component Testing
- **Unit Tests**: Test individual component functionality
- **Integration Tests**: Test component integration
- **State Tests**: Test state management logic
- **Validation Tests**: Test validation and error handling

### User Experience Testing
- **Flow Testing**: Test complete user flows
- **Responsive Testing**: Test across different screen sizes
- **Error Scenarios**: Test error handling and recovery
- **Performance Testing**: Test performance and optimization
