import { describe, it, expect } from '@jest/globals';
import {
  paymentKeyHash,
  stakeKeyHash,
  addressToNetwork,
  checkValidAddress,
  checkValidStakeKey,
} from '../utils/multisigSDK';
import { mockAddresses, mockStakeAddresses, realTestAddresses, externalStakeCredential } from './testUtils';

describe('Helper Functions', () => {
  describe('paymentKeyHash', () => {
    it('should be a function', () => {
      expect(typeof paymentKeyHash).toBe('function');
    });

    it('should extract key hash from real testnet addresses', () => {
      const keyHash1 = paymentKeyHash(realTestAddresses.address1);
      const keyHash2 = paymentKeyHash(realTestAddresses.address2);
      
      expect(keyHash1).toBeDefined();
      expect(keyHash2).toBeDefined();
      expect(keyHash1).not.toBe(keyHash2);
      expect(typeof keyHash1).toBe('string');
      expect(typeof keyHash2).toBe('string');
    });

    it('should handle invalid addresses', () => {
      expect(() => paymentKeyHash(mockAddresses.invalid)).toThrow();
    });

    it('should handle empty string', () => {
      expect(() => paymentKeyHash('')).toThrow();
    });
  });

  describe('stakeKeyHash', () => {
    it('should be a function', () => {
      expect(typeof stakeKeyHash).toBe('function');
    });

    it('should extract stake key hash from real stake address', () => {
      const extractedHash = stakeKeyHash(externalStakeCredential);
      expect(extractedHash).toBeDefined();
      expect(typeof extractedHash).toBe('string');
    });

    it('should handle invalid stake addresses', () => {
      expect(() => stakeKeyHash(mockStakeAddresses.invalid)).toThrow();
    });

    it('should handle empty string', () => {
      expect(() => stakeKeyHash('')).toThrow();
    });
  });

  describe('addressToNetwork', () => {
    it('should return 0 for real testnet addresses', () => {
      expect(addressToNetwork(realTestAddresses.address1)).toBe(0);
      expect(addressToNetwork(realTestAddresses.address2)).toBe(0);
    });

    it('should return 1 for mainnet addresses', () => {
      const mainnetAddress = 'addr1qx3w7rh2p447qkx34x0p0vlr6z34r3n8e8r9qxrl6n';
      expect(addressToNetwork(mainnetAddress)).toBe(1);
    });

    it('should handle addresses without test prefix', () => {
      const addressWithoutTest = 'addr1qx3w7rh2p447qkx34x0p0vlr6z34r3n8e8r9qxrl6n';
      expect(addressToNetwork(addressWithoutTest)).toBe(1);
    });

    it('should handle empty string', () => {
      expect(addressToNetwork('')).toBe(1);
    });
  });

  describe('checkValidAddress', () => {
    it('should return true for real testnet addresses', () => {
      expect(checkValidAddress(realTestAddresses.address1)).toBe(true);
      expect(checkValidAddress(realTestAddresses.address2)).toBe(true);
    });

    it('should return false for invalid addresses', () => {
      expect(checkValidAddress(mockAddresses.invalid)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(checkValidAddress('')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(checkValidAddress(null as any)).toBe(false);
      expect(checkValidAddress(undefined as any)).toBe(false);
    });
  });

  describe('checkValidStakeKey', () => {
    it('should return true for real stake address', () => {
      expect(checkValidStakeKey(externalStakeCredential)).toBe(true);
    });

    it('should return false for invalid stake addresses', () => {
      expect(checkValidStakeKey(mockStakeAddresses.invalid)).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(checkValidStakeKey('')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(checkValidStakeKey(null as any)).toBe(false);
      expect(checkValidStakeKey(undefined as any)).toBe(false);
    });
  });
});

describe('Integration Tests', () => {
  describe('Address and Network utilities', () => {
    it('should correctly identify network from real addresses and validate', () => {
      expect(addressToNetwork(realTestAddresses.address1)).toBe(0);
      expect(addressToNetwork(realTestAddresses.address2)).toBe(0);
      
      const mainnetAddr = 'addr1qx3w7rh2p447qkx34x0p0vlr6z34r3n8e8r9qxrl6n';
      expect(addressToNetwork(mainnetAddr)).toBe(1);
    });

    it('should handle validation edge cases', () => {
      const invalidInputs = ['', null, undefined, 'random_string', 123];
      
      invalidInputs.forEach(input => {
        expect(checkValidAddress(input as any)).toBe(false);
        expect(checkValidStakeKey(input as any)).toBe(false);
      });
    });

    it('should work with real address extraction and validation', () => {
      // Test that we can extract key hashes and validate addresses
      const keyHash1 = paymentKeyHash(realTestAddresses.address1);
      const keyHash2 = paymentKeyHash(realTestAddresses.address2);
      
      expect(keyHash1).toBeDefined();
      expect(keyHash2).toBeDefined();
      expect(checkValidAddress(realTestAddresses.address1)).toBe(true);
      expect(checkValidAddress(realTestAddresses.address2)).toBe(true);
    });
  });
});
