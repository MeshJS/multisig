# Proxy Control System

A comprehensive UI component system for managing Cardano proxy contracts with multisig wallet integration.

## Overview

The Proxy Control System provides a user-friendly interface for managing proxy contracts on Cardano. It allows users to:

- Set up proxy contracts with auth token minting
- Monitor proxy balances in real-time
- Create and manage spending transactions
- Integrate with multisig wallet systems

## Components

### ProxyControl

The main component that provides a complete interface for proxy management.

**Features:**
- **Setup Tab**: Initialize proxy contracts by minting auth tokens
- **Overview Tab**: Monitor proxy status, address, and balance
- **Spend Tab**: Create multi-output spending transactions

**Usage:**
```tsx
import { ProxyControl } from "@/components/multisig/proxy";

export default function MyPage() {
  return (
    <div>
      <h1>Proxy Management</h1>
      <ProxyControl />
    </div>
  );
}
```

### ProxyControlExample

A demonstration page showing how to integrate and use the ProxyControl component.

## Architecture

### Core Classes

#### MeshProxyContract

Located in `offchain.ts`, this class handles all blockchain interactions:

- **setupProxy()**: Mints 10 auth tokens and sets up the proxy address
- **spendProxySimple()**: Creates spending transactions from the proxy
- **getProxyBalance()**: Fetches current balance of the proxy address

### Integration Points

The system integrates with:

1. **MeshSDK**: For wallet connections and transaction building
2. **Multisig System**: Creates transactions that require multisig approval
3. **Database**: Stores transaction data for multisig workflows
4. **Toast System**: Provides user feedback for all operations

## Workflow

### 1. Setup Phase
1. User connects wallet
2. Clicks "Setup Proxy" 
3. System mints 10 auth tokens
4. Creates multisig transaction for approval
5. Auth tokens are sent to user's multisig wallet

### 2. Control Phase
1. User can monitor proxy balance
2. Create spending transactions with multiple outputs
3. Each spend consumes one auth token
4. Transactions require multisig approval

### 3. Automation Phase
1. Proxy can hold various assets
2. Automated spending when auth tokens are available
3. Full audit trail through multisig system

## Security Features

- **Multisig Integration**: All transactions require multisig approval
- **Auth Token System**: Controlled spending through token consumption
- **Address Validation**: Proper Cardano address format checking
- **Error Handling**: Comprehensive error states and user feedback

## UI/UX Features

- **Responsive Design**: Works on mobile and desktop
- **Loading States**: Visual feedback during operations
- **Error Handling**: Clear error messages and recovery options
- **Real-time Updates**: Balance and status monitoring
- **Copy Functions**: Easy address and token ID copying

## Dependencies

- `@meshsdk/react`: Wallet connection and transaction building
- `@meshsdk/core`: Core Cardano functionality
- `@meshsdk/common`: Common utilities and types
- React hooks for state management
- Custom UI components (shadcn/ui based)

## Error Handling

The system handles various error scenarios:

- Wallet not connected
- Insufficient funds
- Invalid addresses
- Network errors
- Transaction failures

All errors are displayed to users with actionable feedback.

## Future Enhancements

Potential improvements:

1. **Batch Operations**: Multiple proxy management
2. **Advanced Spending**: Time-locked or conditional spending
3. **Analytics**: Transaction history and analytics
4. **Notifications**: Real-time proxy activity alerts
5. **API Integration**: REST API for proxy management

## Testing

The component should be tested with:

- Different wallet types (Nami, Eternl, etc.)
- Various network conditions
- Edge cases (empty balances, invalid inputs)
- Mobile responsiveness
- Error scenarios

## Contributing

When contributing to this system:

1. Follow existing code patterns
2. Add proper TypeScript types
3. Include error handling
4. Test with real wallets
5. Update documentation



