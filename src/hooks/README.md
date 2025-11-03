# Hooks Directory

A comprehensive collection of React hooks for managing multisig wallet operations, transaction handling, user management, and UI state. These hooks provide a clean abstraction layer between components and the underlying data management systems.

## Core Hooks

### Wallet Management Hooks

#### `useAppWallet`
- **Purpose**: Provides the current wallet context for the application
- **Features**: 
  - Fetches wallet data from database via tRPC
  - Builds complete wallet object with network and UTxO data
  - Handles loading states and error conditions
  - Integrates with router for wallet ID extraction
- **Returns**: `{ appWallet, isLoading }`
- **Dependencies**: Router, user store, site store, wallets store

#### `useMultisigWallet`
- **Purpose**: Builds and provides multisig wallet instance for transaction operations
- **Features**:
  - Creates Mesh SDK compatible multisig wallet
  - Handles key resolution and script building
  - Provides wallet for transaction signing and validation
- **Returns**: `{ multisigWallet, isLoading }`
- **Dependencies**: Router, user store, site store

#### `useUserWallets`
- **Purpose**: Fetches and manages all wallets associated with the current user
- **Features**:
  - Retrieves user's wallet list from database
  - Builds complete wallet objects with network data
  - Handles loading states and data transformation
- **Returns**: `{ wallets, isLoading }`
- **Dependencies**: User store, site store

### Transaction Management Hooks

#### `useTransaction`
- **Purpose**: Core hook for creating and managing multisig transactions
- **Features**:
  - Handles transaction building with Mesh SDK
  - Manages transaction signing and submission
  - Determines auto-submission based on wallet type and signatures
  - Handles metadata attachment and validation
  - Provides toast notifications for user feedback
- **Returns**: `{ newTransaction }`
- **Key Methods**:
  - `newTransaction()`: Creates and submits new multisig transaction
- **Dependencies**: Wallet connection, user store, app wallet

#### `useAllTransactions`
- **Purpose**: Fetches complete transaction history for a wallet
- **Features**:
  - Retrieves all transactions from database
  - Handles loading states
  - Provides transaction data for history display
- **Returns**: `{ transactions, isLoading }`
- **Parameters**: `{ walletId: string }`

#### `usePendingTransactions`
- **Purpose**: Fetches transactions awaiting signatures
- **Features**:
  - Retrieves pending transactions from database
  - Supports both explicit wallet ID and router-based ID
  - Handles loading states and conditional fetching
- **Returns**: `{ transactions, isLoading }`
- **Parameters**: `{ walletId?: string }`

### UTxO Management Hooks

#### `useAvailableUtxos`
- **Purpose**: Filters UTxOs to exclude those used in pending transactions
- **Features**:
  - Prevents double-spending by blocking UTxOs in pending transactions
  - Efficiently filters large UTxO sets
  - Handles loading states and error conditions
  - Provides real-time availability updates
- **Returns**: `{ availableUtxos, isLoading, error }`
- **Parameters**: `{ walletId?: string, utxos: UTxO[] }`
- **Key Logic**: Excludes UTxOs that are inputs in pending transactions

### User Management Hooks

#### `useUser`
- **Purpose**: Manages current user data and authentication state
- **Features**:
  - Fetches user data by wallet address
  - Handles authentication errors gracefully
  - Provides loading states and error handling
  - Returns null user on error for graceful UI handling
- **Returns**: `{ user, isLoading, error }`
- **Dependencies**: User store

### Signable Management Hooks

#### `usePendingSignables`
- **Purpose**: Fetches signable items awaiting user signatures
- **Features**:
  - Retrieves pending signables from database
  - Supports both explicit wallet ID and router-based ID
  - Handles loading states and conditional fetching
- **Returns**: `{ signables, isLoading }`
- **Parameters**: `{ walletId?: string }`

#### `useCompleteSignables`
- **Purpose**: Fetches completed signable items
- **Features**:
  - Retrieves completed signables from database
  - Supports both explicit wallet ID and router-based ID
  - Handles loading states and conditional fetching
- **Returns**: `{ signables, isLoading }`
- **Parameters**: `{ walletId?: string }`

### Governance Hooks

#### `useBallot`
- **Purpose**: Manages governance ballots for proposal voting
- **Features**:
  - Fetches ballots for a specific wallet
  - Provides refresh functionality for real-time updates
  - Handles loading states and error conditions
  - Supports ballot creation and management
- **Returns**: `{ ballots, isLoading, error, refresh, refetch }`
- **Parameters**: `walletId?: string`

### UI Hooks

#### `useToast`
- **Purpose**: Manages toast notifications throughout the application
- **Features**:
  - Global toast state management with reducer pattern
  - Automatic toast dismissal and cleanup
  - Toast limit management (max 1 toast)
  - Action support for interactive toasts
  - Memory-based state with listener pattern
- **Returns**: `{ toasts, toast, dismiss }`
- **Key Methods**:
  - `toast()`: Creates new toast notification
  - `dismiss()`: Dismisses specific or all toasts

## Utility Functions

### `buildWallet`
- **Purpose**: Transforms database wallet data into application wallet object
- **Features**:
  - Resolves payment and stake key hashes
  - Builds native scripts for multisig operations
  - Generates payment and stakeable addresses
  - Creates DRep IDs for governance operations
  - Handles address selection based on UTxO availability
- **Parameters**: `(wallet: DbWallet, network: number, utxos?: UTxO[])`
- **Returns**: `Wallet` object

### `buildMultisigWallet`
- **Purpose**: Creates Mesh SDK compatible multisig wallet instance
- **Features**:
  - Resolves payment and stake key hashes from addresses
  - Creates multisig keys with proper roles
  - Handles invalid address validation
  - Builds complete multisig wallet for transaction operations
- **Parameters**: `(wallet: DbWallet, network: number)`
- **Returns**: `MultisigWallet | undefined`

## Hook Patterns

### Data Fetching Pattern
Most hooks follow a consistent pattern for data fetching:
```typescript
const { data, isLoading, error } = api.endpoint.useQuery(
  { params },
  { enabled: condition }
);
```

### Router Integration Pattern
Many hooks integrate with Next.js router for automatic wallet ID extraction:
```typescript
const router = useRouter();
const walletId = router.query.wallet as string;
```

### Conditional Fetching Pattern
Hooks use conditional fetching to prevent unnecessary API calls:
```typescript
{
  enabled: walletId !== undefined && userAddress !== undefined,
}
```

### Error Handling Pattern
Hooks implement graceful error handling:
```typescript
return { 
  user: error ? null : user, 
  isLoading,
  error 
};
```

## State Management Integration

### Zustand Store Integration
Hooks integrate with Zustand stores for global state:
- **User Store**: User address and authentication state
- **Site Store**: Network configuration and loading states
- **Wallets Store**: UTxO data and wallet metadata

### tRPC Integration
All data fetching hooks use tRPC for type-safe API calls:
- Automatic type inference
- Built-in loading and error states
- Optimistic updates and caching
- Real-time invalidation

## Performance Optimizations

### Memoization
- `useCallback` for expensive operations
- `useMemo` for computed values
- React.memo for component optimization

### Conditional Rendering
- Hooks only fetch data when required conditions are met
- Prevents unnecessary API calls and re-renders

### Efficient Filtering
- `useAvailableUtxos` efficiently filters large UTxO sets
- Uses Set operations for O(1) lookup performance

## Error Handling

### Graceful Degradation
- Hooks return null/undefined on errors for graceful UI handling
- Loading states prevent UI flickering
- Error boundaries catch and handle hook errors

### User Feedback
- Toast notifications for user actions
- Loading indicators for async operations
- Error messages with actionable information

## Type Safety

### TypeScript Integration
- Full TypeScript support with strict typing
- Type inference for tRPC queries
- Interface definitions for all hook returns

### Mesh SDK Integration
- Proper typing for Cardano operations
- Type-safe UTxO and transaction handling
- Native script type definitions

## Testing Considerations

### Hook Testing
- Hooks can be tested with React Testing Library
- Mock tRPC queries for isolated testing
- Test error conditions and loading states

### Integration Testing
- Test hook interactions with Zustand stores
- Verify router integration
- Test real-time updates and invalidation

## Best Practices

### Hook Composition
- Compose simple hooks into complex functionality
- Keep hooks focused on single responsibilities
- Reuse common patterns across hooks

### Data Flow
- Hooks should be the primary data access layer
- Components should use hooks, not direct API calls
- Maintain unidirectional data flow

### Performance
- Use conditional fetching to prevent unnecessary calls
- Implement proper cleanup in useEffect
- Optimize re-renders with proper dependencies
