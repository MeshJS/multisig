# MultisigSDK Testing Framework

This directory contains comprehensive tests for the MultisigSDK functionality.

## Test Structure

- `setup.ts` - Jest configuration and global test setup
- `testUtils.ts` - Mock data and helper functions for testing
- `multisigSDK.test.ts` - Tests for the MultisigWallet class
- `helpers.test.ts` - Tests for utility functions

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode during development
npm run test:watch

# Run tests with coverage report
npm run test:coverage

# Run tests for CI/CD (no watch mode)
npm run test:ci
```

## Test Coverage

The tests cover:

### MultisigWallet Class
- Constructor validation and key filtering/sorting
- Role-based key management (`getKeysByRole`)
- Script building for different roles (`buildScript`)
- Staking functionality detection (`stakingEnabled`)
- Stake credential hash computation
- JSON metadata generation (CIP-0146)
- Error handling for invalid inputs

### Helper Functions
- `paymentKeyHash` - Extract payment key hash from addresses
- `stakeKeyHash` - Extract stake key hash from stake addresses
- `addressToNetwork` - Determine network from address format
- `checkValidAddress` - Validate Cardano addresses
- `checkValidStakeKey` - Validate stake addresses

## Mock Data

The `testUtils.ts` file provides:
- Mock key hashes for different roles (payment, stake, drep)
- Mock addresses for mainnet and testnet
- Mock MultisigKey arrays for testing
- Helper functions to create test wallets

## Important Notes

1. **Real Addresses**: Some tests use mock addresses. For production testing, use real Cardano addresses.

2. **Network Dependencies**: Tests that interact with @meshsdk/core functions may require actual Cardano address formats.

3. **Error Handling**: Tests verify both success paths and error conditions.

4. **Lexicographic Sorting**: Tests verify that keys are properly sorted per CIP-1854.

## Adding New Tests

When adding new functionality to the MultisigSDK:

1. Add corresponding test cases in the appropriate test file
2. Update mock data in `testUtils.ts` if needed
3. Ensure both success and error cases are covered
4. Run `npm run test:coverage` to verify coverage levels

## CI/CD Integration

The `test:ci` script is designed for continuous integration:
- Runs without watch mode
- Generates coverage reports
- Exits with appropriate status codes for build systems
