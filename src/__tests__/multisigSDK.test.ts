import { describe, it, expect, beforeEach } from '@jest/globals';
import { MultisigWallet, MultisigKey } from '../utils/multisigSDK';
import {
  mockPaymentKeys,
  mockStakeKeys,
  mockMixedKeys,
  mockKeyHashes,
  createTestWallet,
} from './testUtils';

describe('MultisigWallet', () => {
  let wallet: MultisigWallet;

  beforeEach(() => {
    const testWallet = createTestWallet();
    wallet = new MultisigWallet(
      testWallet.name,
      testWallet.keys,
      testWallet.description,
      testWallet.required,
      testWallet.network,
    );
  });

  describe('constructor', () => {
    it('should create a wallet with valid parameters', () => {
      expect(wallet.name).toBe('Test Wallet');
      expect(wallet.description).toBe('Test Description');
      expect(wallet.required).toBe(1);
      expect(wallet.network).toBe(1);
      expect(wallet.keys).toHaveLength(2);
    });

    it('should sort keys lexicographically', () => {
      const unsortedKeys: MultisigKey[] = [
        { keyHash: 'zzzz', role: 0, name: 'Last' },
        { keyHash: 'aaaa', role: 0, name: 'First' },
        { keyHash: 'mmmm', role: 0, name: 'Middle' },
      ];
      
      const testWallet = new MultisigWallet('Test', unsortedKeys);
      expect(testWallet.keys[0].keyHash).toBe('aaaa');
      expect(testWallet.keys[1].keyHash).toBe('mmmm');
      expect(testWallet.keys[2].keyHash).toBe('zzzz');
    });

    it('should filter out invalid keys', () => {
      const keysWithInvalid: MultisigKey[] = [
        { keyHash: mockKeyHashes.payment1, role: 0, name: 'Valid' },
        { keyHash: '', role: 0, name: 'Empty Hash' },
        { keyHash: 'undefined', role: 0, name: 'Undefined Hash' },
        { keyHash: mockKeyHashes.payment2, role: NaN, name: 'Invalid Role' },
      ];

      const testWallet = new MultisigWallet('Test', keysWithInvalid);
      expect(testWallet.keys).toHaveLength(1);
      expect(testWallet.keys[0].keyHash).toBe(mockKeyHashes.payment1);
    });

    it('should use default values when optional parameters are not provided', () => {
      const basicWallet = new MultisigWallet('Basic', mockPaymentKeys);
      expect(basicWallet.description).toBe('');
      expect(basicWallet.required).toBe(1);
      expect(basicWallet.network).toBe(1);
      expect(basicWallet.stakeCredentialHash).toBeUndefined();
    });
  });

  describe('getKeysByRole', () => {
    beforeEach(() => {
      wallet = new MultisigWallet('Mixed Wallet', mockMixedKeys);
    });

    it('should return payment keys (role 0)', () => {
      const paymentKeys = wallet.getKeysByRole(0);
      expect(paymentKeys).toHaveLength(2);
      expect(paymentKeys?.every(key => key.role === 0)).toBe(true);
    });

    it('should return stake keys (role 2)', () => {
      const stakeKeys = wallet.getKeysByRole(2);
      expect(stakeKeys).toHaveLength(2);
      expect(stakeKeys?.every(key => key.role === 2)).toBe(true);
    });

    it('should return drep keys (role 3)', () => {
      const drepKeys = wallet.getKeysByRole(3);
      expect(drepKeys).toHaveLength(1);
      expect(drepKeys?.[0].role).toBe(3);
    });

    it('should return undefined for non-existent role', () => {
      const nonExistentKeys = wallet.getKeysByRole(5);
      expect(nonExistentKeys).toBeUndefined();
    });
  });

  describe('buildScript', () => {
    beforeEach(() => {
      wallet = new MultisigWallet('Mixed Wallet', mockMixedKeys, '', 2);
    });

    it('should build payment script for role 0', () => {
      const script = wallet.buildScript(0);
      expect(script).toBeDefined();
      expect(script?.type).toBe('atLeast');
      expect((script as any)?.required).toBe(2);
      expect((script as any)?.scripts).toHaveLength(2);
    });

    it('should build stake script for role 2', () => {
      const script = wallet.buildScript(2);
      expect(script).toBeDefined();
      expect(script?.type).toBe('atLeast');
    });

    it('should return undefined for role with no keys', () => {
      const script = wallet.buildScript(5);
      expect(script).toBeUndefined();
    });
  });

  describe('stakingEnabled', () => {
    it('should return true when payment and stake key counts match', () => {
      const walletWithStaking = new MultisigWallet('Staking Wallet', mockMixedKeys);
      expect(walletWithStaking.stakingEnabled()).toBe(true);
    });

    it('should return false when payment and stake key counts do not match', () => {
      const paymentOnlyKeys = mockPaymentKeys;
      const walletWithoutStaking = new MultisigWallet('No Staking', paymentOnlyKeys);
      expect(walletWithoutStaking.stakingEnabled()).toBe(false);
    });
  });

  describe('getStakeCredentialHash', () => {
    it('should return external stake credential hash if provided', () => {
      const externalHash = 'external_stake_credential_hash';
      const walletWithExternal = new MultisigWallet(
        'External Stake',
        mockPaymentKeys,
        '',
        1,
        1,
        externalHash,
      );
      expect(walletWithExternal.getStakeCredentialHash()).toBe(externalHash);
    });

    it('should compute stake credential hash from stake keys', () => {
      const walletWithStaking = new MultisigWallet('Staking Wallet', mockMixedKeys);
      const hash = walletWithStaking.getStakeCredentialHash();
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
    });

    it('should return undefined when no stake keys are available', () => {
      const paymentOnlyWallet = new MultisigWallet('Payment Only', mockPaymentKeys);
      expect(paymentOnlyWallet.getStakeCredentialHash()).toBeUndefined();
    });
  });

  describe('getAvailableTypes', () => {
    it('should return unique role types from wallet keys', () => {
      const walletWithMixed = new MultisigWallet('Mixed', mockMixedKeys);
      const types = walletWithMixed.getAvailableTypes();
      expect(types).toContain(0); // payment
      expect(types).toContain(2); // stake
      expect(types).toContain(3); // drep
      expect(types).toHaveLength(3);
    });

    it('should return single type for uniform keys', () => {
      const paymentWallet = new MultisigWallet('Payment', mockPaymentKeys);
      const types = paymentWallet.getAvailableTypes();
      expect(types).toEqual([0]);
    });
  });

  describe('getJsonMetadata', () => {
    it('should generate CIP-0146 compatible metadata', () => {
      const metadata = wallet.getJsonMetadata();
      expect(metadata).toHaveProperty('name', 'Test Wallet');
      expect(metadata).toHaveProperty('description', 'Test Description');
      expect(metadata).toHaveProperty('participants');
      expect(metadata).toHaveProperty('types');
    });

    it('should include participant information', () => {
      const metadata = wallet.getJsonMetadata() as any;
      const participants = metadata.participants;
      expect(participants).toHaveProperty(mockKeyHashes.payment1);
      expect(participants).toHaveProperty(mockKeyHashes.payment2);
      expect(participants[mockKeyHashes.payment1]).toHaveProperty('name', 'Alice Payment');
    });
  });

  describe('error handling', () => {
    it('should throw error when building script with no valid payment keys', () => {
      const emptyWallet = new MultisigWallet('Empty', []);
      expect(() => emptyWallet.getScript()).toThrow(
        'Cannot build multisig script: no valid payment keys provided.'
      );
    });

    it('should handle empty key arrays gracefully', () => {
      const emptyWallet = new MultisigWallet('Empty', []);
      expect(emptyWallet.keys).toHaveLength(0);
      expect(emptyWallet.getKeysByRole(0)).toBeUndefined();
    });
  });
});
