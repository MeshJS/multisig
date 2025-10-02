import { MultisigKey } from '../utils/multisigSDK';

// Mock key hashes for testing
export const mockKeyHashes = {
  payment1: 'e1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309',
  payment2: 'f2417b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309',
  stake1: 'a1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309',
  stake2: 'b2417b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309',
  drep1: 'c1317b152faac13426e6a83e06ff88a4d62cce3c1634ab0a5ec13309',
};

// Real Cardano addresses for testing
export const realTestAddresses = {
  address1: 'addr_test1qp86rhgehcs4k99rpu48879jncjmeytlhv4nxfd3sw2def6xxu4ylafkwgp2ad5l74sa3s75ttr3enxg2ps2qtrpanyswgshl2',
  address2: 'addr_test1qp2x52vcr5pdqm4gqr5mh8dp48v0cr39rff2dql4t0t64r77sr2nhu8ajahawcz2hnu8mj2wewy9ww0kt8tuq2d80fkqnwuzzp',
  invalid: 'invalid_address_format',
};

// External stake address for testing
export const externalStakeCredential = 'stake_test1uprrw2j075m8yq4wk60l2cwcc02943cueny9qc9q93s7ejgeu5ll8';

// Mock addresses for basic testing (fallback)
export const mockAddresses = {
  mainnet: 'addr1qy8ac7qqy0vtulyl7wntmsxc6wex80gvcyjy33qffrhm7sh927ysx5sftuw0dlft05dz3c7revpf7jx0xnlcjz3g69mq4inc8k',
  testnet: 'addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3jcu5d8ps7zex2k2ut7yen8gjnp4rwq4fmgg4x45w553s8akrux',
  invalid: 'invalid_address_format',
};

// Mock stake addresses for testing (using actual valid Cardano stake addresses)
export const mockStakeAddresses = {
  mainnet: 'stake1uxly0q2cnpxrjrqm9vpjr32u95w2l6qcq8az38pqgkq8r3sk0r2j5',
  testnet: 'stake_test1uzpq2n70mvz9j3u0k5xn6pxmtqr3h5j6f2e5n4t9p8q2w3s6l7m9x',
  invalid: 'invalid_stake_format',
};

// Mock MultisigKey arrays for testing
export const mockPaymentKeys: MultisigKey[] = [
  { keyHash: mockKeyHashes.payment1, role: 0, name: 'Alice Payment' },
  { keyHash: mockKeyHashes.payment2, role: 0, name: 'Bob Payment' },
];

export const mockStakeKeys: MultisigKey[] = [
  { keyHash: mockKeyHashes.stake1, role: 2, name: 'Alice Stake' },
  { keyHash: mockKeyHashes.stake2, role: 2, name: 'Bob Stake' },
];

export const mockDRepKeys: MultisigKey[] = [
  { keyHash: mockKeyHashes.drep1, role: 3, name: 'Alice DRep' },
];

export const mockMixedKeys: MultisigKey[] = [
  ...mockPaymentKeys,
  ...mockStakeKeys,
  ...mockDRepKeys,
];

// Helper function to create valid test wallets
export function createTestWallet(
  keys: MultisigKey[] = mockPaymentKeys,
  required: number = 1,
  network: number = 1,
) {
  return {
    name: 'Test Wallet',
    description: 'Test Description',
    keys,
    required,
    network,
  };
}

// Helper function to extract key hashes from real addresses
export async function getKeyHashFromAddress(address: string): Promise<string> {
  try {
    const { paymentKeyHash } = await import('../utils/multisigSDK');
    return paymentKeyHash(address);
  } catch (error) {
    throw new Error(`Failed to extract key hash from address: ${error}`);
  }
}

// Helper function to extract stake key hash from stake address
export async function getStakeKeyHashFromAddress(stakeAddress: string): Promise<string> {
  try {
    const { stakeKeyHash } = await import('../utils/multisigSDK');
    return stakeKeyHash(stakeAddress);
  } catch (error) {
    throw new Error(`Failed to extract stake key hash from address: ${error}`);
  }
}

// Test scenario 1: Only payment keys
export async function createPaymentOnlyWallet(): Promise<MultisigKey[]> {
  const keyHash1 = await getKeyHashFromAddress(realTestAddresses.address1);
  const keyHash2 = await getKeyHashFromAddress(realTestAddresses.address2);
  
  return [
    { keyHash: keyHash1, role: 0, name: 'Payment Key 1' },
    { keyHash: keyHash2, role: 0, name: 'Payment Key 2' },
  ];
}

// Test scenario 2: Payment keys with external stake credential
export async function createPaymentWithExternalStakeWallet(): Promise<{ keys: MultisigKey[], stakeCredentialHash: string }> {
  const keyHash1 = await getKeyHashFromAddress(realTestAddresses.address1);
  const keyHash2 = await getKeyHashFromAddress(realTestAddresses.address2);
  const stakeCredentialHash = await getStakeKeyHashFromAddress(externalStakeCredential);
  
  return {
    keys: [
      { keyHash: keyHash1, role: 0, name: 'Payment Key 1' },
      { keyHash: keyHash2, role: 0, name: 'Payment Key 2' },
    ],
    stakeCredentialHash
  };
}

// Test scenario 3: Payment and stake keys
export async function createPaymentAndStakeWallet(): Promise<MultisigKey[]> {
  const keyHash1 = await getKeyHashFromAddress(realTestAddresses.address1);
  const keyHash2 = await getKeyHashFromAddress(realTestAddresses.address2);
  
  // Extract stake key hash from the external stake address for stake keys
  const stakeKeyHash = await getStakeKeyHashFromAddress(externalStakeCredential);
  
  return [
    { keyHash: keyHash1, role: 0, name: 'Payment Key 1' },
    { keyHash: keyHash2, role: 0, name: 'Payment Key 2' },
    { keyHash: stakeKeyHash, role: 2, name: 'Stake Key 1' },
    { keyHash: stakeKeyHash, role: 2, name: 'Stake Key 2' },
  ];
}
