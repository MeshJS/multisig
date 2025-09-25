import { describe, it, expect, beforeAll } from '@jest/globals';
import { MultisigWallet } from '../utils/multisigSDK';
import {
  realTestAddresses,
  externalStakeCredential,
  createPaymentOnlyWallet,
  createPaymentWithExternalStakeWallet,
  createPaymentAndStakeWallet,
  getKeyHashFromAddress,
} from './testUtils';

describe('Real Address Test Scenarios', () => {
  let paymentOnlyKeys: any[];
  let paymentWithExternalStakeData: { keys: any[], stakeCredentialHash: string };
  let paymentAndStakeKeys: any[];

  beforeAll(async () => {
    // Extract key hashes from real addresses
    paymentOnlyKeys = await createPaymentOnlyWallet();
    paymentWithExternalStakeData = await createPaymentWithExternalStakeWallet();
    paymentAndStakeKeys = await createPaymentAndStakeWallet();
  });

  describe('Scenario 1: Only Payment Keys', () => {
    let wallet: MultisigWallet;

    beforeAll(() => {
      wallet = new MultisigWallet(
        'Payment Only Wallet',
        paymentOnlyKeys,
        'Wallet with only payment keys',
        2, // require 2 signatures
        0, // testnet
      );
    });

    it('should create wallet with only payment keys', () => {
      expect(wallet.keys).toHaveLength(2);
      expect(wallet.getKeysByRole(0)).toHaveLength(2);
      expect(wallet.getKeysByRole(2)).toBeUndefined();
    });

    it('should have correct network detection', () => {
      expect(wallet.network).toBe(0); // testnet
    });

    it('should build payment script successfully', () => {
      const script = wallet.buildScript(0);
      expect(script).toBeDefined();
      expect(script?.type).toBe('atLeast');
      expect((script as any)?.required).toBe(2);
      expect((script as any)?.scripts).toHaveLength(2);
    });

    it('should not have staking enabled', () => {
      expect(wallet.stakingEnabled()).toBe(false);
    });

    it('should not have stake credential hash', () => {
      expect(wallet.getStakeCredentialHash()).toBeUndefined();
    });

    it('should generate script successfully', () => {
      const scriptResult = wallet.getScript();
      expect(scriptResult.address).toBeDefined();
      expect(scriptResult.scriptCbor).toBeDefined();
      expect(scriptResult.address).toContain('addr_test');
    });

    it('should generate valid JSON metadata', () => {
      const metadata = wallet.getJsonMetadata() as any;
      expect(metadata.name).toBe('Payment Only Wallet');
      expect(metadata.description).toBe('Wallet with only payment keys');
      expect(metadata.types).toEqual([0]);
      expect(Object.keys(metadata.participants)).toHaveLength(2);
    });
  });

  describe('Scenario 2: Payment Keys with External Stake Credential', () => {
    let wallet: MultisigWallet;

    beforeAll(() => {
      wallet = new MultisigWallet(
        'Payment with External Stake',
        paymentWithExternalStakeData.keys,
        'Wallet with payment keys and external stake credential',
        2, // require 2 signatures
        0, // testnet
        paymentWithExternalStakeData.stakeCredentialHash, // external stake credential hash
      );
    });

    it('should create wallet with payment keys and external stake credential', () => {
      expect(wallet.keys).toHaveLength(2);
      expect(wallet.getKeysByRole(0)).toHaveLength(2);
      expect(wallet.getKeysByRole(2)).toBeUndefined();
      expect(wallet.stakeCredentialHash).toBe(paymentWithExternalStakeData.stakeCredentialHash);
    });

    it('should return external stake credential hash', () => {
      expect(wallet.getStakeCredentialHash()).toBe(paymentWithExternalStakeData.stakeCredentialHash);
    });

    it('should not have staking enabled (no stake keys)', () => {
      expect(wallet.stakingEnabled()).toBe(false);
    });

    it('should generate script with external stake credential', () => {
      const scriptResult = wallet.getScript();
      expect(scriptResult.address).toBeDefined();
      expect(scriptResult.scriptCbor).toBeDefined();
      expect(scriptResult.address).toContain('addr_test');
    });

    it('should build payment script successfully', () => {
      const script = wallet.buildScript(0);
      expect(script).toBeDefined();
      expect(script?.type).toBe('atLeast');
      expect((script as any)?.required).toBe(2);
    });

    it('should generate valid JSON metadata', () => {
      const metadata = wallet.getJsonMetadata() as any;
      expect(metadata.name).toBe('Payment with External Stake');
      expect(metadata.types).toEqual([0]);
    });
  });

  describe('Scenario 3: Payment and Stake Keys', () => {
    let wallet: MultisigWallet;

    beforeAll(() => {
      wallet = new MultisigWallet(
        'Payment and Stake Wallet',
        paymentAndStakeKeys,
        'Wallet with both payment and stake keys',
        2, // require 2 signatures
        0, // testnet
      );
    });

    it('should create wallet with both payment and stake keys', () => {
      expect(wallet.keys).toHaveLength(4);
      expect(wallet.getKeysByRole(0)).toHaveLength(2);
      expect(wallet.getKeysByRole(2)).toHaveLength(2);
    });

    it('should have staking enabled', () => {
      expect(wallet.stakingEnabled()).toBe(true);
    });

    it('should compute stake credential hash from stake keys', () => {
      const stakeCredentialHash = wallet.getStakeCredentialHash();
      expect(stakeCredentialHash).toBeDefined();
      expect(typeof stakeCredentialHash).toBe('string');
      expect(stakeCredentialHash).not.toBe(externalStakeCredential);
    });

    it('should generate stake address', () => {
      const stakeAddress = wallet.getStakeAddress();
      expect(stakeAddress).toBeDefined();
      expect(stakeAddress).toContain('stake_test');
    });

    it('should build both payment and stake scripts', () => {
      const paymentScript = wallet.buildScript(0);
      const stakeScript = wallet.buildScript(2);

      expect(paymentScript).toBeDefined();
      expect(stakeScript).toBeDefined();
      expect(paymentScript?.type).toBe('atLeast');
      expect(stakeScript?.type).toBe('atLeast');
    });

    it('should generate script with staking enabled', () => {
      const scriptResult = wallet.getScript();
      expect(scriptResult.address).toBeDefined();
      expect(scriptResult.scriptCbor).toBeDefined();
      expect(scriptResult.address).toContain('addr_test');
    });

    it('should generate valid JSON metadata with both types', () => {
      const metadata = wallet.getJsonMetadata() as any;
      expect(metadata.name).toBe('Payment and Stake Wallet');
      expect(metadata.types).toEqual([2, 0]); // Order: stake keys first, then payment keys
      expect(Object.keys(metadata.participants)).toHaveLength(3); // 2 payment + 1 stake key hash
    });

    it('should have correct available types', () => {
      const types = wallet.getAvailableTypes();
      expect(types).toContain(0);
      expect(types).toContain(2);
      expect(types).toHaveLength(2);
    });
  });

  describe('Address Validation Tests', () => {
    it('should extract key hashes from real testnet addresses', async () => {
      const keyHash1 = await getKeyHashFromAddress(realTestAddresses.address1);
      const keyHash2 = await getKeyHashFromAddress(realTestAddresses.address2);

      expect(keyHash1).toBeDefined();
      expect(keyHash2).toBeDefined();
      expect(keyHash1).not.toBe(keyHash2);
      expect(typeof keyHash1).toBe('string');
      expect(typeof keyHash2).toBe('string');
    });

    it('should handle invalid addresses', async () => {
      await expect(getKeyHashFromAddress(realTestAddresses.invalid)).rejects.toThrow();
    });
  });

  describe('Cross-Scenario Comparisons', () => {
    let paymentOnlyWallet: MultisigWallet;
    let externalStakeWallet: MultisigWallet;
    let fullStakeWallet: MultisigWallet;

    beforeAll(() => {
      paymentOnlyWallet = new MultisigWallet(
        'Payment Only',
        paymentOnlyKeys,
        '',
        2,
        0,
      );

      externalStakeWallet = new MultisigWallet(
        'External Stake',
        paymentWithExternalStakeData.keys,
        '',
        2,
        0,
        paymentWithExternalStakeData.stakeCredentialHash,
      );

      fullStakeWallet = new MultisigWallet(
        'Full Stake',
        paymentAndStakeKeys,
        '',
        2,
        0,
      );
    });

    it('should have different addresses for different scenarios', () => {
      const address1 = paymentOnlyWallet.getScript().address;
      const address2 = externalStakeWallet.getScript().address;
      const address3 = fullStakeWallet.getScript().address;

      expect(address1).not.toBe(address2);
      expect(address2).not.toBe(address3);
      expect(address1).not.toBe(address3);
    });

    it('should have different stake credential hashes', () => {
      const hash1 = paymentOnlyWallet.getStakeCredentialHash();
      const hash2 = externalStakeWallet.getStakeCredentialHash();
      const hash3 = fullStakeWallet.getStakeCredentialHash();

      expect(hash1).toBeUndefined();
      expect(hash2).toBe(paymentWithExternalStakeData.stakeCredentialHash);
      expect(hash3).toBeDefined();
      expect(hash2).not.toBe(hash3);
    });

    it('should have different staking capabilities', () => {
      expect(paymentOnlyWallet.stakingEnabled()).toBe(false);
      expect(externalStakeWallet.stakingEnabled()).toBe(false);
      expect(fullStakeWallet.stakingEnabled()).toBe(true);
    });
  });
});
