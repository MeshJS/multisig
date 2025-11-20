import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { MeshCrowdfundContract } from '@/components/crowdfund/base-crowdfund/offchain';
import { MeshTxBuilder, UTxO } from '@meshsdk/core';
import { CrowdfundDatumTS } from '@/components/crowdfund/crowdfund';

// Mock MeshTxBuilder
jest.mock('@meshsdk/core', () => {
  const actual = jest.requireActual('@meshsdk/core');
  return {
    ...actual,
    MeshTxBuilder: jest.fn().mockImplementation(() => ({
      setNetwork: jest.fn().mockReturnThis(),
      spendingPlutusScriptV3: jest.fn().mockReturnThis(),
      txIn: jest.fn().mockReturnThis(),
      mintPlutusScriptV3: jest.fn().mockReturnThis(),
      mint: jest.fn().mockReturnThis(),
      mintingScript: jest.fn().mockReturnThis(),
      mintRedeemerValue: jest.fn().mockReturnThis(),
      txInRedeemerValue: jest.fn().mockReturnThis(),
      txInScript: jest.fn().mockReturnThis(),
      txInInlineDatumPresent: jest.fn().mockReturnThis(),
      txOut: jest.fn().mockReturnThis(),
      txOutInlineDatumValue: jest.fn().mockReturnThis(),
      txInCollateral: jest.fn().mockReturnThis(),
      changeAddress: jest.fn().mockReturnThis(),
      selectUtxosFrom: jest.fn().mockReturnThis(),
      invalidHereafter: jest.fn().mockReturnThis(),
      complete: jest.fn().mockResolvedValue('mock-tx-hex'),
      fetcher: {
        fetchAddressUTxOs: jest.fn(),
      },
    })),
  };
});

// Mock resolveScriptHash
jest.mock('@meshsdk/core', () => {
  const actual = jest.requireActual('@meshsdk/core');
  return {
    ...actual,
    resolveScriptHash: jest.fn((script: string) => `policy-${script.slice(0, 8)}`),
  };
});

// Mock resolveSlotNo
jest.mock('@meshsdk/common', () => {
  const actual = jest.requireActual('@meshsdk/common');
  return {
    ...actual,
    resolveSlotNo: jest.fn(() => '12345678'),
  };
});

const mockWallet = {
  getUtxos: jest.fn(),
  getCollateral: jest.fn(),
  getUsedAddresses: jest.fn(),
  getUnusedAddresses: jest.fn(),
  signTx: jest.fn(),
  submitTx: jest.fn(),
};

const mockFetcher = {
  fetchAddressUTxOs: jest.fn(),
};

const mockGovernanceConfig = {
  delegatePoolId: "pool1testmock",
  govActionPeriod: 6,
  stakeRegisterDeposit: 2_000_000,
  drepRegisterDeposit: 500_000_000,
  govDeposit: 100_000_000,
};

const createMockUTxO = (lovelace: string, address: string): UTxO => ({
  input: {
    txHash: 'mock-tx-hash',
    outputIndex: 0,
  },
  output: {
    address,
    amount: [
      {
        unit: 'lovelace',
        quantity: lovelace,
      },
      {
        unit: 'mock-policy-id',
        quantity: '1',
      },
    ],
    datum: undefined,
    datumHash: undefined,
  },
});

const createMockDatum = (): CrowdfundDatumTS => ({
  stake_script: 'stake-script-hash',
  share_token: 'share-token-policy-id',
  crowdfund_address: 'addr_test1qzk3k4...',
  fundraise_target: 100000000000, // 100000 ADA
  current_fundraised_amount: 5000000000, // 5000 ADA
  allow_over_subscription: false,
  deadline: Date.now() + 30 * 24 * 60 * 60 * 1000,
  expiry_buffer: 86400,
  min_charge: 2000000, // 2 ADA
});

describe('MeshCrowdfundContract withdrawCrowdfund', () => {
  let contract: MeshCrowdfundContract;
  let meshTxBuilder: any;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock MeshTxBuilder instance
    meshTxBuilder = {
      setNetwork: jest.fn().mockReturnThis(),
      spendingPlutusScriptV3: jest.fn().mockReturnThis(),
      txIn: jest.fn().mockReturnThis(),
      mintPlutusScriptV3: jest.fn().mockReturnThis(),
      mint: jest.fn().mockReturnThis(),
      mintingScript: jest.fn().mockReturnThis(),
      mintRedeemerValue: jest.fn().mockReturnThis(),
      txInRedeemerValue: jest.fn().mockReturnThis(),
      txInScript: jest.fn().mockReturnThis(),
      txInInlineDatumPresent: jest.fn().mockReturnThis(),
      txOut: jest.fn().mockReturnThis(),
      txOutInlineDatumValue: jest.fn().mockReturnThis(),
      txInCollateral: jest.fn().mockReturnThis(),
      changeAddress: jest.fn().mockReturnThis(),
      selectUtxosFrom: jest.fn().mockReturnThis(),
      invalidHereafter: jest.fn().mockReturnThis(),
      complete: jest.fn().mockResolvedValue('mock-tx-hex'),
      fetcher: mockFetcher,
    };

    // Setup wallet mocks
    const mockUtxos = [
      createMockUTxO('10000000', 'addr_test1...'), // 10 ADA
    ];
    const mockCollateral = createMockUTxO('5000000', 'addr_test1...'); // 5 ADA

    mockWallet.getUtxos = jest.fn().mockResolvedValue(mockUtxos);
    mockWallet.getCollateral = jest.fn().mockResolvedValue([mockCollateral]);
    mockWallet.getUsedAddresses = jest.fn().mockResolvedValue(['addr_test1...']);
    mockWallet.getUnusedAddresses = jest.fn().mockResolvedValue([]);

    contract = new MeshCrowdfundContract(
      {
        mesh: meshTxBuilder,
        fetcher: mockFetcher,
        wallet: mockWallet as any,
        networkId: 0, // testnet
      },
      {
        proposerKeyHash: 'test-proposer-hash',
        paramUtxo: { txHash: 'mock-tx-hash', outputIndex: 0 },
        governance: mockGovernanceConfig,
      },
    );

    // Set crowdfund address
    contract.crowdfundAddress = 'addr_test1qzk3k4...';
  });

  describe('Successful withdrawals', () => {
    it('should successfully create withdrawal transaction', async () => {
      const datum = createMockDatum();
      const withdrawAmount = 1000000000; // 1000 ADA

      // Mock AuthToken UTxO at crowdfund address
      const authTokenUtxo = createMockUTxO('5000000000', contract.crowdfundAddress!);
      authTokenUtxo.output.amount.push({
        unit: 'mock-policy-id-auth-token',
        quantity: '1',
      });

      mockFetcher.fetchAddressUTxOs.mockResolvedValue([authTokenUtxo]);

      const result = await contract.withdrawCrowdfund(withdrawAmount, datum);

      expect(result).toHaveProperty('tx');
      expect(result.tx).toBe('mock-tx-hex');

      // Verify transaction building chain was called
      expect(meshTxBuilder.spendingPlutusScriptV3).toHaveBeenCalled();
      expect(meshTxBuilder.txIn).toHaveBeenCalled();
      expect(meshTxBuilder.mintPlutusScriptV3).toHaveBeenCalled();
      expect(meshTxBuilder.complete).toHaveBeenCalled();
    });

    it('should calculate correct new crowdfund amount after withdrawal', async () => {
      const datum = createMockDatum();
      const withdrawAmount = 2000000000; // 2000 ADA
      const initialAmount = '5000000000'; // 5000 ADA

      const authTokenUtxo = createMockUTxO(initialAmount, contract.crowdfundAddress!);
      authTokenUtxo.output.amount.push({
        unit: 'mock-policy-id-auth-token',
        quantity: '1',
      });

      mockFetcher.fetchAddressUTxOs.mockResolvedValue([authTokenUtxo]);

      await contract.withdrawCrowdfund(withdrawAmount, datum);

      // Verify txOut was called with reduced amount
      const txOutCall = meshTxBuilder.txOut.mock.calls[0];
      expect(txOutCall).toBeDefined();
      
      const newAmount = txOutCall[1]; // Second argument is the amount array
      const lovelaceAmount = newAmount.find((amt: any) => amt.unit === 'lovelace');
      expect(lovelaceAmount).toBeDefined();
      expect(Number(lovelaceAmount.quantity)).toBe(3000000000); // 5000 - 2000 = 3000 ADA
    });

    it('should update datum with reduced current_fundraised_amount', async () => {
      const datum = createMockDatum();
      const withdrawAmount = 1500000000; // 1500 ADA

      const authTokenUtxo = createMockUTxO('5000000000', contract.crowdfundAddress!);
      authTokenUtxo.output.amount.push({
        unit: 'mock-policy-id-auth-token',
        quantity: '1',
      });

      mockFetcher.fetchAddressUTxOs.mockResolvedValue([authTokenUtxo]);

      await contract.withdrawCrowdfund(withdrawAmount, datum);

      // Verify txOutInlineDatumValue was called (indicating datum was updated)
      expect(meshTxBuilder.txOutInlineDatumValue).toHaveBeenCalled();
    });

    it('should mint negative share tokens (burn)', async () => {
      const datum = createMockDatum();
      const withdrawAmount = 1000000000; // 1000 ADA

      const authTokenUtxo = createMockUTxO('5000000000', contract.crowdfundAddress!);
      authTokenUtxo.output.amount.push({
        unit: 'mock-policy-id-auth-token',
        quantity: '1',
      });

      mockFetcher.fetchAddressUTxOs.mockResolvedValue([authTokenUtxo]);

      await contract.withdrawCrowdfund(withdrawAmount, datum);

      // Verify mint was called with negative amount
      const mintCall = meshTxBuilder.mint.mock.calls[0];
      expect(mintCall).toBeDefined();
      expect(mintCall[0]).toBe((-withdrawAmount).toString()); // Negative amount for burning
    });
  });

  describe('Error handling', () => {
    it('should throw error if no UTxOs found', async () => {
      const datum = createMockDatum();
      mockWallet.getUtxos = jest.fn().mockResolvedValue([]);

      await expect(
        contract.withdrawCrowdfund(1000000000, datum),
      ).rejects.toThrow('No UTxOs found');
    });

    it('should throw error if crowdfund address not set', async () => {
      const datum = createMockDatum();
      contract.crowdfundAddress = undefined;

      await expect(
        contract.withdrawCrowdfund(1000000000, datum),
      ).rejects.toThrow('Crowdfund address not set');
    });

    it('should throw error if blockchain provider not found', async () => {
      const datum = createMockDatum();
      meshTxBuilder.fetcher = null;

      await expect(
        contract.withdrawCrowdfund(1000000000, datum),
      ).rejects.toThrow('Blockchain provider not found');
    });

    it('should throw error if no AuthToken found at crowdfund address', async () => {
      const datum = createMockDatum();
      mockFetcher.fetchAddressUTxOs.mockResolvedValue([]);

      await expect(
        contract.withdrawCrowdfund(1000000000, datum),
      ).rejects.toThrow('No AuthToken found at crowdfund address');
    });

    it('should throw error if multiple AuthTokens found', async () => {
      const datum = createMockDatum();
      const utxo1 = createMockUTxO('5000000000', contract.crowdfundAddress!);
      const utxo2 = createMockUTxO('3000000000', contract.crowdfundAddress!);
      
      mockFetcher.fetchAddressUTxOs.mockResolvedValue([utxo1, utxo2]);

      await expect(
        contract.withdrawCrowdfund(1000000000, datum),
      ).rejects.toThrow('Multiple AuthTokens found');
    });

    it('should throw error if AuthToken UTxO has no amount', async () => {
      const datum = createMockDatum();
      const authTokenUtxo = {
        input: {
          txHash: 'mock-tx-hash',
          outputIndex: 0,
        },
        output: {
          address: contract.crowdfundAddress!,
          amount: undefined, // Missing amount
          datum: undefined,
          datumHash: undefined,
        },
      };

      mockFetcher.fetchAddressUTxOs.mockResolvedValue([authTokenUtxo as any]);

      await expect(
        contract.withdrawCrowdfund(1000000000, datum),
      ).rejects.toThrow('No AuthToken amount found');
    });

    it('should throw error if no collateral found', async () => {
      const datum = createMockDatum();
      mockWallet.getCollateral = jest.fn().mockResolvedValue([]);

      const authTokenUtxo = createMockUTxO('5000000000', contract.crowdfundAddress!);
      mockFetcher.fetchAddressUTxOs.mockResolvedValue([authTokenUtxo]);

      await expect(
        contract.withdrawCrowdfund(1000000000, datum),
      ).rejects.toThrow('No collateral found');
    });
  });

  describe('Transaction building', () => {
    it('should use correct redeemer for withdrawal (mConStr2)', async () => {
      const datum = createMockDatum();
      const authTokenUtxo = createMockUTxO('5000000000', contract.crowdfundAddress!);
      mockFetcher.fetchAddressUTxOs.mockResolvedValue([authTokenUtxo]);

      await contract.withdrawCrowdfund(1000000000, datum);

      // Verify txInRedeemerValue was called (for the script redeemer)
      expect(meshTxBuilder.txInRedeemerValue).toHaveBeenCalled();
    });

    it('should set transaction TTL', async () => {
      const datum = createMockDatum();
      const authTokenUtxo = createMockUTxO('5000000000', contract.crowdfundAddress!);
      mockFetcher.fetchAddressUTxOs.mockResolvedValue([authTokenUtxo]);

      await contract.withdrawCrowdfund(1000000000, datum);

      // Verify invalidHereafter was called
      expect(meshTxBuilder.invalidHereafter).toHaveBeenCalled();
    });

    it('should include collateral in transaction', async () => {
      const datum = createMockDatum();
      const authTokenUtxo = createMockUTxO('5000000000', contract.crowdfundAddress!);
      mockFetcher.fetchAddressUTxOs.mockResolvedValue([authTokenUtxo]);

      await contract.withdrawCrowdfund(1000000000, datum);

      // Verify txInCollateral was called
      expect(meshTxBuilder.txInCollateral).toHaveBeenCalled();
    });
  });
});

