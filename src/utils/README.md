# MultisigSDK Documentation

A comprehensive TypeScript library for creating and managing Cardano multisig wallets using native scripts.

## Overview

The MultisigSDK provides a complete solution for building multisig wallets on Cardano with support for:

- **Multiple Key Roles**: Payment, staking, and DRep keys
- **Configurable Signatures**: Set custom signature requirements
- **External Stake Credentials**: Use existing stake addresses
- **Network Support**: Both mainnet and testnet
- **CIP-0146 Metadata**: Standardized wallet metadata
- **Real Address Integration**: Works with actual Cardano addresses

## Quick Start

```typescript
import { MultisigWallet, paymentKeyHash, stakeKeyHash } from './multisigSDK';

// Extract key hashes from real addresses
const keyHash1 = paymentKeyHash("addr_test1qp86rhgehcs4k99rpu48879jncjmeytlhv4nxfd3sw2def6xxu4ylafkwgp2ad5l74sa3s75ttr3enxg2ps2qtrpanyswgshl2");
const keyHash2 = paymentKeyHash("addr_test1qp2x52vcr5pdqm4gqr5mh8dp48v0cr39rff2dql4t0t64r77sr2nhu8ajahawcz2hnu8mj2wewy9ww0kt8tuq2d80fkqnwuzzp");

// Create a 2-of-3 multisig wallet
const wallet = new MultisigWallet(
  "Team Wallet",
  [
    { keyHash: keyHash1, role: 0, name: "Alice" },
    { keyHash: keyHash2, role: 0, name: "Bob" },
    { keyHash: "key3...", role: 0, name: "Charlie" }
  ],
  "Our team's shared wallet",
  2, // require 2 signatures
  0  // testnet
);

// Get the wallet address and script
const { address, scriptCbor } = wallet.getScript();
console.log("Multisig address:", address);
```

## Key Concepts

### Key Roles

The SDK supports different key roles for various purposes:

- **Role 0 (Payment)**: Required for all wallets, used for transaction authorization
- **Role 2 (Staking)**: For staking functionality and reward management
- **Role 3 (DRep)**: For governance participation and voting
- **Role 4-5 (Custom)**: Available for custom use cases

### Signature Requirements

You can configure how many signatures are required to authorize transactions:

```typescript
// Require 2 out of 3 signatures
const wallet = new MultisigWallet("Wallet", keys, "", 2);

// Require all signatures (3 out of 3)
const wallet = new MultisigWallet("Wallet", keys, "", 3);
```

### Network Support

The SDK supports both Cardano networks:

```typescript
// Testnet (0)
const testnetWallet = new MultisigWallet("Wallet", keys, "", 1, 0);

// Mainnet (1)
const mainnetWallet = new MultisigWallet("Wallet", keys, "", 1, 1);
```

## Common Use Cases

### 1. Payment-Only Wallet

```typescript
const paymentKeys = [
  { keyHash: "key1...", role: 0, name: "Alice" },
  { keyHash: "key2...", role: 0, name: "Bob" }
];

const wallet = new MultisigWallet("Payment Wallet", paymentKeys);
console.log("Staking enabled:", wallet.stakingEnabled()); // false
```

### 2. Wallet with External Stake Credential

```typescript
const externalStakeHash = stakeKeyHash("stake_test1uprrw2j075m8yq4wk60l2cwcc02943cueny9qc9q93s7ejgeu5ll8");

const wallet = new MultisigWallet(
  "External Stake Wallet",
  paymentKeys,
  "Wallet with external staking",
  2,
  0,
  externalStakeHash
);

console.log("Stake credential:", wallet.getStakeCredentialHash());
```

### 3. Full Staking Wallet

```typescript
const keys = [
  { keyHash: "key1...", role: 0, name: "Alice Payment" },
  { keyHash: "key2...", role: 0, name: "Bob Payment" },
  { keyHash: "key3...", role: 2, name: "Alice Stake" },
  { keyHash: "key4...", role: 2, name: "Bob Stake" }
];

const wallet = new MultisigWallet("Staking Wallet", keys);
console.log("Staking enabled:", wallet.stakingEnabled()); // true
console.log("Stake address:", wallet.getStakeAddress());
```

## API Reference

### Core Functions

#### `paymentKeyHash(address: string): string`
Extracts the payment key hash from a Cardano address.

#### `stakeKeyHash(stakeAddress: string): string`
Extracts the stake key hash from a Cardano stake address.

#### `addressToNetwork(address: string): number`
Determines the network type from an address (0=testnet, 1=mainnet).

#### `checkValidAddress(address: string): boolean`
Validates a Cardano payment address.

#### `checkValidStakeKey(stakeKey: string): boolean`
Validates a Cardano stake address.

### MultisigWallet Class

#### Constructor
```typescript
new MultisigWallet(
  name: string,
  keys: MultisigKey[],
  description?: string,
  required?: number,
  network?: number,
  stakeCredentialHash?: string
)
```

#### Key Methods

- **`getScript()`**: Returns the wallet address and script CBOR
- **`getKeysByRole(role: number)`**: Filters keys by role
- **`buildScript(role: number)`**: Builds native script for a role
- **`stakingEnabled()`**: Checks if staking is enabled
- **`getStakeCredentialHash()`**: Returns the stake credential hash
- **`getStakeAddress()`**: Returns the stake address
- **`getAvailableTypes()`**: Returns available key roles
- **`getJsonMetadata()`**: Generates CIP-0146 metadata

## Testing

The SDK includes comprehensive tests covering all functionality:

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run specific test scenarios
npm test -- --testNamePattern="Real Address Test Scenarios"
```

## Error Handling

The SDK provides clear error messages for common issues:

```typescript
try {
  const wallet = new MultisigWallet("Wallet", []);
  const { address } = wallet.getScript();
} catch (error) {
  console.error("Error:", error.message);
  // "Cannot build multisig script: no valid payment keys provided."
}
```

## Best Practices

1. **Always validate addresses** before extracting key hashes
2. **Use real addresses** in production (not mock data)
3. **Test thoroughly** on testnet before mainnet deployment
4. **Store metadata** using the CIP-0146 format
5. **Handle errors gracefully** in your application

## Examples

See the test files for comprehensive examples:
- `src/__tests__/realAddressScenarios.test.ts` - Real address scenarios
- `src/__tests__/multisigSDK.test.ts` - Core functionality tests
- `src/__tests__/helpers.test.ts` - Utility function tests

## Contributing

When contributing to the MultisigSDK:

1. Add comprehensive JSDoc comments
2. Include examples in documentation
3. Write tests for new functionality
4. Follow the existing code style
5. Update this README for significant changes

## License

This project is licensed under the same terms as the parent project.