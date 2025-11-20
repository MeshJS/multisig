import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createCallerFactory } from '@/server/api/root';
import { appRouter } from '@/server/api/root';

// Mock the database
const mockCrowdfund = {
  id: 'test-crowdfund-id',
  name: 'Test Crowdfund',
  proposerKeyHashR0: 'test-proposer-hash',
  datum: JSON.stringify({
    stake_script: 'stake-script-hash',
    share_token: 'share-token-policy-id',
    crowdfund_address: 'addr_test1...',
    fundraise_target: 100000000000, // 100000 ADA
    current_fundraised_amount: 5000000000, // 5000 ADA
    allow_over_subscription: false,
    deadline: Date.now() + 30 * 24 * 60 * 60 * 1000,
    expiry_buffer: 86400,
    min_charge: 2000000, // 2 ADA
  }),
  authTokenId: 'test-auth-token-id',
  address: 'addr_test1...',
  paramUtxo: JSON.stringify({ txHash: 'test-tx-hash', outputIndex: 0 }),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockDb = {
  crowdfund: {
    findUnique: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    findMany: jest.fn(),
    findFirst: jest.fn(),
    delete: jest.fn(),
  },
};

// Create test context with mocked database
const mockContext = () => ({
  session: null,
  db: mockDb as any,
});

describe('Crowdfund Withdraw API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('withdrawCrowdfund', () => {
    it('should successfully withdraw funds from a crowdfund', async () => {
      const existingCrowdfund = { ...mockCrowdfund };
      mockDb.crowdfund.findUnique.mockResolvedValue(existingCrowdfund);
      
      const updatedDatum = JSON.parse(existingCrowdfund.datum);
      updatedDatum.current_fundraised_amount = 4000000000; // 5000 - 1000 ADA
      
      mockDb.crowdfund.update.mockResolvedValue({
        ...existingCrowdfund,
        datum: JSON.stringify(updatedDatum),
      });

      const createCaller = createCallerFactory(appRouter);
      const caller = createCaller(() => mockContext());
      const result = await caller.crowdfund.withdrawCrowdfund({
        id: 'test-crowdfund-id',
        amount: 1000000000, // 1000 ADA in lovelace
      });

      expect(mockDb.crowdfund.findUnique).toHaveBeenCalledWith({
        where: { id: 'test-crowdfund-id' },
      });

      expect(mockDb.crowdfund.update).toHaveBeenCalledWith({
        where: { id: 'test-crowdfund-id' },
        data: {
          datum: JSON.stringify({
            ...updatedDatum,
            current_fundraised_amount: 4000000000,
          }),
        },
      });

      const resultDatum = JSON.parse(result.datum);
      expect(resultDatum.current_fundraised_amount).toBe(4000000000);
    });

    it('should prevent withdrawing more than available (minimum is 0)', async () => {
      const existingCrowdfund = {
        ...mockCrowdfund,
        datum: JSON.stringify({
          ...JSON.parse(mockCrowdfund.datum),
          current_fundraised_amount: 1000000000, // Only 1000 ADA available
        }),
      };
      
      mockDb.crowdfund.findUnique.mockResolvedValue(existingCrowdfund);
      
      const updatedDatum = JSON.parse(existingCrowdfund.datum);
      updatedDatum.current_fundraised_amount = 0; // Should not go negative
      
      mockDb.crowdfund.update.mockResolvedValue({
        ...existingCrowdfund,
        datum: JSON.stringify(updatedDatum),
      });

      const createCaller = createCallerFactory(appRouter);
      const caller = createCaller(() => mockContext());
      const result = await caller.crowdfund.withdrawCrowdfund({
        id: 'test-crowdfund-id',
        amount: 2000000000, // Trying to withdraw 2000 ADA
      });

      const resultDatum = JSON.parse(result.datum);
      expect(resultDatum.current_fundraised_amount).toBe(0);
      expect(resultDatum.current_fundraised_amount).not.toBeLessThan(0);
    });

    it('should throw error if crowdfund not found', async () => {
      mockDb.crowdfund.findUnique.mockResolvedValue(null);

      const createCaller = createCallerFactory(appRouter);
      const caller = createCaller(() => mockContext());
      
      await expect(
        caller.crowdfund.withdrawCrowdfund({
          id: 'non-existent-id',
          amount: 1000000000,
        }),
      ).rejects.toThrow('Crowdfund not found');

      expect(mockDb.crowdfund.update).not.toHaveBeenCalled();
    });

    it('should throw error if datum is missing', async () => {
      const crowdfundWithoutDatum = {
        ...mockCrowdfund,
        datum: null,
      };
      
      mockDb.crowdfund.findUnique.mockResolvedValue(crowdfundWithoutDatum);

      const createCaller = createCallerFactory(appRouter);
      const caller = createCaller(() => mockContext());
      
      await expect(
        caller.crowdfund.withdrawCrowdfund({
          id: 'test-crowdfund-id',
          amount: 1000000000,
        }),
      ).rejects.toThrow('Crowdfund datum missing');

      expect(mockDb.crowdfund.update).not.toHaveBeenCalled();
    });

    it('should throw error if datum is invalid JSON', async () => {
      const crowdfundWithInvalidDatum = {
        ...mockCrowdfund,
        datum: 'invalid-json',
      };
      
      mockDb.crowdfund.findUnique.mockResolvedValue(crowdfundWithInvalidDatum);

      const createCaller = createCallerFactory(appRouter);
      const caller = createCaller(() => mockContext());
      
      await expect(
        caller.crowdfund.withdrawCrowdfund({
          id: 'test-crowdfund-id',
          amount: 1000000000,
        }),
      ).rejects.toThrow('Invalid crowdfund datum');

      expect(mockDb.crowdfund.update).not.toHaveBeenCalled();
    });

    it('should handle zero withdrawal amount', async () => {
      const existingCrowdfund = { ...mockCrowdfund };
      mockDb.crowdfund.findUnique.mockResolvedValue(existingCrowdfund);
      
      const updatedDatum = JSON.parse(existingCrowdfund.datum);
      // Amount should remain the same when withdrawing 0
      updatedDatum.current_fundraised_amount = 5000000000;
      
      mockDb.crowdfund.update.mockResolvedValue({
        ...existingCrowdfund,
        datum: JSON.stringify(updatedDatum),
      });

      const createCaller = createCallerFactory(appRouter);
      const caller = createCaller(() => mockContext());
      const result = await caller.crowdfund.withdrawCrowdfund({
        id: 'test-crowdfund-id',
        amount: 0,
      });

      const resultDatum = JSON.parse(result.datum);
      expect(resultDatum.current_fundraised_amount).toBe(5000000000);
    });

    it('should handle complete withdrawal (all funds)', async () => {
      const existingCrowdfund = { ...mockCrowdfund };
      mockDb.crowdfund.findUnique.mockResolvedValue(existingCrowdfund);
      
      const updatedDatum = JSON.parse(existingCrowdfund.datum);
      updatedDatum.current_fundraised_amount = 0;
      
      mockDb.crowdfund.update.mockResolvedValue({
        ...existingCrowdfund,
        datum: JSON.stringify(updatedDatum),
      });

      const createCaller = createCallerFactory(appRouter);
      const caller = createCaller(() => mockContext());
      const result = await caller.crowdfund.withdrawCrowdfund({
        id: 'test-crowdfund-id',
        amount: 5000000000, // Withdraw all 5000 ADA
      });

      const resultDatum = JSON.parse(result.datum);
      expect(resultDatum.current_fundraised_amount).toBe(0);
    });

    it('should handle datum with missing current_fundraised_amount field', async () => {
      const existingCrowdfund = {
        ...mockCrowdfund,
        datum: JSON.stringify({
          stake_script: 'stake-script-hash',
          share_token: 'share-token-policy-id',
          crowdfund_address: 'addr_test1...',
          fundraise_target: 100000000000,
          // current_fundraised_amount is missing
          allow_over_subscription: false,
          deadline: Date.now() + 30 * 24 * 60 * 60 * 1000,
          expiry_buffer: 86400,
          min_charge: 2000000,
        }),
      };
      
      mockDb.crowdfund.findUnique.mockResolvedValue(existingCrowdfund);
      
      const updatedDatum = JSON.parse(existingCrowdfund.datum);
      updatedDatum.current_fundraised_amount = Math.max(0, 0 - 1000000000); // Should be 0
      
      mockDb.crowdfund.update.mockResolvedValue({
        ...existingCrowdfund,
        datum: JSON.stringify(updatedDatum),
      });

      const createCaller = createCallerFactory(appRouter);
      const caller = createCaller(() => mockContext());
      const result = await caller.crowdfund.withdrawCrowdfund({
        id: 'test-crowdfund-id',
        amount: 1000000000,
      });

      const resultDatum = JSON.parse(result.datum);
      expect(resultDatum.current_fundraised_amount).toBe(0);
    });
  });

  describe('contributeCrowdfund (for comparison)', () => {
    it('should successfully contribute to a crowdfund', async () => {
      const existingCrowdfund = { ...mockCrowdfund };
      mockDb.crowdfund.findUnique.mockResolvedValue(existingCrowdfund);
      
      const updatedDatum = JSON.parse(existingCrowdfund.datum);
      updatedDatum.current_fundraised_amount = 6000000000; // 5000 + 1000 ADA
      
      mockDb.crowdfund.update.mockResolvedValue({
        ...existingCrowdfund,
        datum: JSON.stringify(updatedDatum),
      });

      const createCaller = createCallerFactory(appRouter);
      const caller = createCaller(() => mockContext());
      const result = await caller.crowdfund.contributeCrowdfund({
        id: 'test-crowdfund-id',
        amount: 1000000000, // 1000 ADA in lovelace
      });

      const resultDatum = JSON.parse(result.datum);
      expect(resultDatum.current_fundraised_amount).toBe(6000000000);
    });
  });
});

