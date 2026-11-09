import type { AssetQuantity } from "@/types/token-flow";
import type { DraftUtxoRef } from "@/types/tx-draft";
import type { ContractDetails } from "./contract-details";

export const RISK_ASSESSMENT_VERSION = 1 as const;

export type RiskContext = {
  /** Site network convention: 1 is mainnet; other values select testnet. */
  network: number;
  /**
   * From authoritative wallet state/derivation, NEVER transaction JSON, labels
   * or contact data. Both the native script and address are checked together.
   */
  walletNativeScript?: { address: string; cbor: string };
};

export type PaymentControl = {
  kind:
    | "key"
    | "wallet-native-script"
    | "known-anyone-can-spend"
    | "unknown-script";
  networkId: number;
  paymentHash: string;
};

export type RiskCode =
  | "script-output-anyone-can-spend"
  | "script-output-rules-unknown"
  | "script-input-anyone-can-spend"
  | "script-input-rules-unverified"
  | "collateral-exposure";

export type RiskLocation = {
  /** Collateral return exists only on script failure; its ledger index follows normal outputs. */
  outputRole?: "collateral-return";
  outputIndex?: number;
  outputId?: string;
  inputRef?: DraftUtxoRef;
  inputId?: string;
};

export type RiskFinding = RiskLocation & {
  code: RiskCode;
  severity: "info" | "warning" | "danger";
  action: "fund-script" | "spend-script" | "collateral";
  message: string;
  address: string;
  scriptHash?: string;
  assets: AssetQuantity[];
  requiresAcknowledgment: boolean;
  evidence: {
    source:
      | "draft-output"
      | "transaction-output"
      | "resolved-input"
      | "resolved-collateral";
    basis:
      "payment-credential" | "known-script-hash" | "collateral-body-and-utxos";
    registryId?: string;
  };
};

export type RiskError = RiskLocation & {
  code:
    | "transaction-decode-failed"
    | "wallet-script-unverified"
    | "output-unverified"
    | "input-unresolved"
    | "input-unverified"
    | "collateral-unverified"
    | "contract-detail-unresolved"
    | "assessment-superseded";
  message: string;
};

export type RiskOutput = {
  outputRole?: "collateral-return";
  outputIndex: number;
  outputId?: string;
  address: string;
  assets: AssetQuantity[];
  control: PaymentControl;
};

export type CollateralRisk = {
  owners: {
    inputRef: DraftUtxoRef;
    address: string;
    paymentKeyHash: string;
    lovelace: string;
  }[];
  selectedLovelace: string;
  returnedLovelace: string;
  returnAddress?: string;
  maximumExposureLovelace: string;
};

export type RiskAssessment = {
  version: typeof RISK_ASSESSMENT_VERSION;
  /** Draft assessment covers outputs only. Complete never means ledger-valid or safe. */
  scope: "draft-outputs" | "transaction";
  status: "complete" | "incomplete";
  networkId: number;
  txHash?: string;
  outputs: RiskOutput[];
  findings: RiskFinding[];
  errors: RiskError[];
  collateral?: CollateralRisk;
  contractDetails?: ContractDetails;
};
