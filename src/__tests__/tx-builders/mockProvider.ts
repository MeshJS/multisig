import type { UTxO } from "@meshsdk/core";
import { FIXTURE_UTXOS, FIXTURE_COLLATERAL } from "./fixtures";

const MOCK_PROTOCOL_PARAMS = {
  coinsPerUtxoSize: "4310",
  feePerByte: 44,
  feeFixed: 155381,
  minFeeRefScriptCostPerByte: 15,
  collateralPercent: 150,
  maxCollateralInputs: 3,
  priceMem: 0.0577,
  priceStep: 0.0000721,
  maxTxSize: 16384,
  maxValSize: "5000",
  maxMemoSize: 64,
  keyDeposit: "2000000",
  poolDeposit: "500000000",
  drepDeposit: "500000000",
  govActionDeposit: "100000000000",
};

export function createMockProvider(overrides?: {
  utxos?: UTxO[];
  collateral?: UTxO;
}) {
  const utxos = overrides?.utxos ?? FIXTURE_UTXOS;
  const collateral = overrides?.collateral ?? FIXTURE_COLLATERAL;

  return {
    fetchAddressUTxOs: jest.fn().mockResolvedValue([...utxos, collateral]),
    fetchProtocolParameters: jest.fn().mockResolvedValue(MOCK_PROTOCOL_PARAMS),
    fetchAccountInfo: jest.fn().mockResolvedValue({ balance: "0", rewards: "0" }),
    fetchAssetAddresses: jest.fn().mockResolvedValue([]),
    fetchBlockInfo: jest.fn().mockResolvedValue({}),
    fetchCollectionAssets: jest.fn().mockResolvedValue({ assets: [] }),
    fetchHandle: jest.fn().mockResolvedValue({}),
    fetchHandleAddress: jest.fn().mockResolvedValue(""),
    fetchTxInfo: jest.fn().mockResolvedValue({}),
    fetchUTxOs: jest.fn().mockResolvedValue([...utxos, collateral]),

    // IEvaluator — returns empty ExUnits; complete() uses zero execution budget
    // Intentional: we test structural CBOR correctness, not fee accuracy
    evaluateTx: jest.fn().mockResolvedValue([]),

    submitTx: jest.fn().mockResolvedValue("mock-tx-hash"),
  };
}
