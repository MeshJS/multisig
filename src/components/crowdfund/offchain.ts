import {
  Anchor,
  GovernanceAction,
  IEvaluator,
  RewardAddress,
  mBool,
  mConStr,
  mConStr0,
  mConStr1,
  mConStr2,
  mConStr3,
  mNone,
  mSome,
  mOutputReference,
  mPubKeyAddress,
  mScriptAddress,
  list,
  isHexString,
  scriptHash,
  resolveSlotNo,
  stringToHex,
} from "@meshsdk/common";
import {
  UTxO,
  applyParamsToScript,
  deserializeAddress,
  resolveScriptHash,
  resolveScriptHashDRepId,
  serializePlutusScript,
  serializeData,
} from "@meshsdk/core";
import { TxParser } from "@meshsdk/transaction";
import { bech32 } from "bech32";
import { resolveTxHash, scriptHashToRewardAddress } from "@meshsdk/core-cst";

import blueprint from "./gov-crowdfundV2/plutus.json";
import {
  CrowdfundDatumTS,
  RegisteredCertsDatumTS,
  ProposedDatumTS,
  VotedDatumTS,
  RefundableDatumTS,
  GovernanceActionIdTS,
  TreasuryBeneficiary,
} from "./crowdfund";
import { MeshTxInitiator, MeshTxInitiatorInput } from "./common";
import { env } from "@/env";
import { getProvider } from "@/utils/get-provider";

// Import Sancho slot resolver
import { resolveSlotNoSancho } from "./test_sancho_utils";

type Amount = { unit: string; quantity: string };

type GovernanceAnchor = {
  url: string;
  hash: string;
};

export interface GovernanceConfig {
  delegatePoolId: string;
  govActionPeriod: number;
  stakeRegisterDeposit: number;
  drepRegisterDeposit: number;
  govDeposit: number;
  governanceAction?: GovernanceAction;
  anchorGovAction?: GovernanceAnchor;
  anchorDrep?: GovernanceAnchor;
}

export interface RegisterGovActionArgs {
  datum: CrowdfundDatumTS;
  anchorGovAction?: GovernanceAnchor;
  anchorDrep?: GovernanceAnchor;
  governanceAction?: GovernanceAction;
}

export type CompleteCrowdfundArgs = RegisterGovActionArgs;

type VoteKind = "Yes" | "No" | "Abstain";

export interface MeshCrowdfundContractConfig {
  proposerKeyHash: string;
  governance: GovernanceConfig;
  paramUtxo?: UTxO | { txHash: string; outputIndex: number };
  spendRefScript?: { txHash: string; outputIndex: number };
  stakeRefScript?: { txHash: string; outputIndex: number };
  refAddress?: string; // Address where reference scripts are stored
  govActionType?: 'InfoAction' | 'TreasuryWithdrawalsAction';
  treasuryBeneficiaries?: TreasuryBeneficiary[];
  preservePolicyHash?: boolean;
}

interface RegisterStakeArgs {
  datum: CrowdfundDatumTS;
}

interface RegisterDrepArgs {
  datum: RegisteredCertsDatumTS;
  anchorDrep?: GovernanceAnchor;
}

interface ProposeGovActionArgs {
  datum: CrowdfundDatumTS;
  anchorGovAction?: GovernanceAnchor;
  governanceAction?: GovernanceAction;
}

interface VoteOnGovActionArgs {
  datum: ProposedDatumTS;
  voteKind: VoteKind;
}

interface DeregisterGovActionArgs {
  datum: VotedDatumTS;
}

interface PostGovernanceWithdrawalArgs {
  datum: RefundableDatumTS;
  withdrawAmount: number;
}

enum CrowdfundGovRedeemerTag {
  ContributeFund = 0,
  ContributorWithdrawal = 1, // Handles both Crowdfund (failed/expired) and Refundable (post-governance)
  RegisterCerts = 2,
  ProposeGovAction = 3,
  VoteOnGovAction = 4,
  DeregisterCerts = 5,
  RemoveEmptyInstance = 6,
}

enum MintPolarityTag {
  Mint = 0,
  Burn = 1,
}

const VALIDATOR_TITLES = {
  AUTH_MINT: "auth_token/mint.gcf_auth_mint.mint",
  SHARE_MINT: "share_token/mint.share_token.mint",
  SPEND: "gcf_spend.gCf_spend.spend",
  STAKE_PUBLISH: "gcf_stake.gCf_stake.publish",
  STAKE_PROPOSE: "gcf_stake.gCf_stake.propose",
  STAKE_VOTE: "gcf_stake.gCf_stake.vote",
} as const;

const findValidator = (title: string) => {
  const validator = blueprint.validators.find((v) => v.title === title);
  if (!validator) {
    throw new Error(`Validator "${title}" not found in blueprint.`);
  }
  return validator.compiledCode;
};

const lovelaceOf = (amounts: Amount[]): bigint => {
  const entry = amounts.find((a) => a.unit === "lovelace");
  return entry ? BigInt(entry.quantity) : 0n;
};

const adjustLovelace = (amounts: Amount[], delta: bigint): Amount[] =>
  amounts.map((amt) =>
    amt.unit === "lovelace"
      ? {
          unit: amt.unit,
          quantity: (BigInt(amt.quantity) + delta).toString(),
        }
      : amt,
  );

const ensureAnchor = (
  ctx: "governance" | "drep",
  provided?: GovernanceAnchor,
  fallback?: GovernanceAnchor,
): GovernanceAnchor => {
  const anchor = provided ?? fallback;
  if (!anchor?.url || !anchor?.hash) {
    throw new Error(
      `Missing ${ctx} anchor. Provide { url, hash } when calling completeCrowdfund.`,
    );
  }
  return anchor;
};

const ensureAnchorOptional = (
  ctx: "governance" | "drep",
  provided?: GovernanceAnchor,
  fallback?: GovernanceAnchor,
): GovernanceAnchor | undefined => {
  const anchor = provided ?? fallback;
  if (!anchor?.url || !anchor?.hash) {
    console.warn(`Missing ${ctx} anchor. DRep registration may be skipped.`);
    return undefined;
  }
  return anchor;
};

export class MeshCrowdfundContract extends MeshTxInitiator {
  private readonly proposerKeyHash: string;
  public readonly governance: GovernanceConfig;
  private paramUtxo?: UTxO | { txHash: string; outputIndex: number };
  private cachedCrowdfundAddress?: string;
  private cachedCrowdfundSpendCbor?: string;
  public cachedGovActionParam?: ReturnType<typeof mConStr>;
  private ref_spend_txhash?: string; // Reference script transaction hash
  private ref_spend_outputIndex?: number; // Reference script output index
  private ref_stake_txhash?: string; // Stake reference script transaction hash
  private ref_stake_outputIndex?: number; // Stake reference script output index
  private refAddress?: string; // Address where reference scripts are stored
  public readonly govActionType: 'InfoAction' | 'TreasuryWithdrawalsAction';
  public readonly treasuryBeneficiaries?: TreasuryBeneficiary[];
  private readonly preservePolicyHash: boolean;

  constructor(
    inputs: MeshTxInitiatorInput,
    contract: MeshCrowdfundContractConfig,
  ) {
    super(inputs);
    // Ensure the evaluator is set on the mesh object for transaction evaluation
    if (inputs.evaluator) {
      this.mesh.evaluator = inputs.evaluator;
    }
    this.proposerKeyHash = contract.proposerKeyHash;
    this.governance = contract.governance;
    this.govActionType = contract.govActionType || 'InfoAction';
    this.treasuryBeneficiaries = contract.treasuryBeneficiaries;
    this.preservePolicyHash = contract.preservePolicyHash ?? false;
    
    // Debug: Log constructor parameters
    console.log("[MeshCrowdfundContract] Constructor called with:", {
      govActionType: this.govActionType,
      hasTreasuryBeneficiaries: !!contract.treasuryBeneficiaries,
      treasuryBeneficiariesCount: contract.treasuryBeneficiaries?.length,
      treasuryBeneficiaries: JSON.stringify(contract.treasuryBeneficiaries),
    });

    // Initialize governance action parameter based on type
    // This must match the governanceAction passed to proposeGovAction()
    if (this.govActionType === 'TreasuryWithdrawalsAction') {
      // Will be computed in getGovActionParam()
      this.cachedGovActionParam = undefined;
    } else {
      // InfoAction: NicePoll (constructor 6)
      this.cachedGovActionParam = mConStr(6, []);
    }

    if (contract.paramUtxo) {
      this.paramUtxo = contract.paramUtxo;
    }
    if (contract.spendRefScript) {
      this.ref_spend_txhash = contract.spendRefScript.txHash;
      this.ref_spend_outputIndex = contract.spendRefScript.outputIndex;
    }
    if (contract.stakeRefScript) {
      this.ref_stake_txhash = contract.stakeRefScript.txHash;
      this.ref_stake_outputIndex = contract.stakeRefScript.outputIndex;
    }
    if (contract.refAddress) {
      this.refAddress = contract.refAddress;
    }
  }

  setParamUtxo = (paramUtxo: UTxO | { txHash: string; outputIndex: number }) => {
    this.paramUtxo = paramUtxo;
    this.cachedCrowdfundAddress = undefined;
  };

  /**
   * Set the reference script transaction hash after transaction submission
   * The reference script is attached to the crowdfund output (index 0)
   */
  setRefSpendTxHash = (txHash: string, outputIndex: number = 0) => {
    this.ref_spend_txhash = txHash;
    this.ref_spend_outputIndex = outputIndex;
  };

  /**
   * Get the reference script UTxO information
   * Returns undefined if not yet set (transaction not yet submitted)
   */
  getRefSpendUtxo = (): { txHash: string; outputIndex: number } | undefined => {
    if (this.ref_spend_txhash === undefined) {
      return undefined;
    }
    return {
      txHash: this.ref_spend_txhash,
      outputIndex: this.ref_spend_outputIndex ?? 0,
    };
  };

  /**
   * Set the stake reference script transaction hash after transaction submission
   */
  setRefStakeTxHash = (txHash: string, outputIndex: number = 0) => {
    this.ref_stake_txhash = txHash;
    this.ref_stake_outputIndex = outputIndex;
  };

  /**
   * Get the stake reference script UTxO information
   * Returns undefined if not yet set (transaction not yet submitted)
   */
  getRefStakeUtxo = (): { txHash: string; outputIndex: number } | undefined => {
    if (this.ref_stake_txhash === undefined) {
      return undefined;
    }
    return {
      txHash: this.ref_stake_txhash,
      outputIndex: this.ref_stake_outputIndex ?? 0,
    };
  };

  /**
   * Get the reference address where reference scripts are stored
   * Returns undefined if not set
   */
  getRefAddress = (): string | undefined => {
    return this.refAddress;
  };

  // Backwards compatibility with the legacy API.
  setparamUtxo = (paramUtxo: UTxO | { txHash: string; outputIndex: number }) => {
    this.setParamUtxo(paramUtxo);
  };

  private isFullUTxO = (
    utxo?: UTxO | { txHash: string; outputIndex: number },
  ): utxo is UTxO => !!utxo && "input" in utxo && "output" in utxo;

  private ensureFullParamUtxo(): UTxO {
    if (!this.paramUtxo) {
      throw new Error("paramUtxo is not set. Call setParamUtxo first.");
    }
    if (!this.isFullUTxO(this.paramUtxo)) {
      throw new Error("paramUtxo must be a full UTxO with input and output.");
    }
    return this.paramUtxo;
  }

  private ensureParamUtxoInput(): UTxO["input"] {
    if (!this.paramUtxo) {
      throw new Error("paramUtxo is not set. Call setParamUtxo first.");
    }
    if (this.isFullUTxO(this.paramUtxo)) {
      return this.paramUtxo.input;
    }
    if ("txHash" in this.paramUtxo && "outputIndex" in this.paramUtxo) {
      return this.paramUtxo;
    }
    throw new Error(
      "paramUtxo must include txHash and outputIndex when not providing a full UTxO.",
    );
  }

  private decodePaymentAddressWithType(address: string): {
    hash: string;
    isScript: boolean;
  } {
    try {
      const decoded = deserializeAddress(address) as any;
      
      // Check if it's a reward address (stake address)
      const isRewardAddress = address.startsWith('stake1') || address.startsWith('stake_test1');
      
      if (isRewardAddress) {
        // For reward addresses, extract stake credential hash
        // Reward addresses encode the stake credential directly
        if (decoded?.stakeScriptCredentialHash) {
          return { hash: decoded.stakeScriptCredentialHash, isScript: true };
        }
        if (decoded?.stakeCredentialHash) {
          return { hash: decoded.stakeCredentialHash, isScript: false };
        }
        // If MeshJS doesn't expose these properties, decode the bech32 address directly
        // Reward addresses encode the stake credential hash in the bech32 data
        const bech32Decoded = bech32.decode(address);
        const bytes = bech32.fromWords(bech32Decoded.words);
        // The first byte is the header, the next 28 bytes are the stake credential hash
        if (bytes.length >= 29 && bytes[0] !== undefined) {
          const stakeCredentialHash = Buffer.from(bytes.slice(1, 29)).toString('hex');
          // Address type is stored in the high nibble
          const header = bytes[0];
          const type = header & 0xF0;
          // 0xE0 = stake key, 0xF0 = stake script (network id in low nibble)
          const isScript = type === 0xF0;
          return { hash: stakeCredentialHash, isScript };
        }
        throw new Error("Reward address does not contain a valid stake credential");
      } else {
        // For payment addresses, extract payment credential hash
        if (decoded?.scriptHash) {
          return { hash: decoded.scriptHash, isScript: true };
        }
        if (decoded?.pubKeyHash) {
          return { hash: decoded.pubKeyHash, isScript: false };
        }
        throw new Error("Address does not contain a payment credential");
      }
    } catch (error) {
      throw new Error(
        `Invalid address for treasury beneficiary: ${address}. ` +
          `Expected a reward address (stake1.../stake_test1...). ` +
          `Error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private normalizeTreasuryWithdrawals(
    withdrawals: Record<string, string>,
  ): Record<string, string> {
    const entries = Object.entries(withdrawals);
    if (entries.length === 0) {
      return {};
    }

    const normalized = entries.map(([address, amount], index) => {
      const trimmedAddress = String(address).trim();
      if (
        !trimmedAddress.startsWith("stake1") &&
        !trimmedAddress.startsWith("stake_test1")
      ) {
        throw new Error(
          `Treasury withdrawal at index ${index} must use a reward address (stake1.../stake_test1...). ` +
            `Got: ${trimmedAddress}`,
        );
      }
      const normalizedAmount =
        typeof amount === "string" ? amount.trim() : String(amount);
      if (!normalizedAmount || !/^\d+$/.test(normalizedAmount)) {
        throw new Error(
          `Treasury withdrawal at index ${index} has invalid amount: "${amount}". ` +
            `Expected a positive lovelace string.`,
        );
      }
      if (normalizedAmount === "0") {
        throw new Error(
          `Treasury withdrawal at index ${index} has zero amount.`,
        );
      }
      return [trimmedAddress, normalizedAmount] as const;
    });

    normalized.sort(([a], [b]) => a.localeCompare(b));

    return normalized.reduce(
      (acc, [address, amount]) => {
        acc[address] = amount;
        return acc;
      },
      {} as Record<string, string>,
    );
  }

  /**
   * Normalize governance action to canonical form (withdrawals sorted by address).
   * Ensures the same bytes are produced for parametrization and for the tx proposal.
   */
  private normalizeGovernanceAction(action: GovernanceAction): GovernanceAction {
    if (action.kind !== "TreasuryWithdrawalsAction") {
      return action;
    }
    const withdrawals = action.action?.withdrawals;
    if (!withdrawals || Object.keys(withdrawals).length === 0) {
      return action;
    }
    const sorted = this.normalizeTreasuryWithdrawals(withdrawals);
    const policyHash = action.action?.policyHash;
    let normalizedPolicyHash = policyHash;

    // `policyHash` is a Mesh `ScriptHash` (ByteString) but some callers may still pass strings.
    // Normalize to a canonical ScriptHash representation.
    const policyHashUnknown = action.action?.policyHash as unknown;
    const raw =
      typeof policyHashUnknown === "string"
        ? policyHashUnknown.trim()
        : typeof policyHashUnknown === "object" &&
          policyHashUnknown !== null &&
          "bytes" in policyHashUnknown
          ? String((policyHashUnknown as { bytes?: string }).bytes ?? "").trim()
          : "";

    if (raw) {
      if (!isHexString(raw)) {
        throw new Error(
          `Treasury withdrawal guardrails policyHash must be hex. Got: ${policyHash}`,
        );
      }
      if (raw.length === 64) {
        if (this.preservePolicyHash) {
          normalizedPolicyHash = scriptHash(raw);
        } else {
          const guardrails = env.NEXT_PUBLIC_GUARDRAILS_POLICY_HASH;
          if (
            typeof guardrails === "string" &&
            guardrails.trim().length === 56 &&
            isHexString(guardrails.trim())
          ) {
            normalizedPolicyHash = scriptHash(guardrails.trim());
          } else {
            throw new Error(
              `Legacy guardrails policyHash detected (${raw}). Provide a 56-hex NEXT_PUBLIC_GUARDRAILS_POLICY_HASH to proceed.`,
            );
          }
        }
      } else {
        normalizedPolicyHash = scriptHash(raw);
      }
    }
    return {
      kind: "TreasuryWithdrawalsAction",
      action: {
        ...action.action,
        withdrawals: sorted,
        ...(normalizedPolicyHash ? { policyHash: normalizedPolicyHash } : {}),
      },
    };
  }

  /**
   * Return the canonical governance action for this contract (for use in both
   * script parametrization and in proposeGovAction).
   */
  private getCanonicalGovernanceAction(): GovernanceAction {
    const raw =
      this.governance.governanceAction ??
      ({ kind: "InfoAction" as const, action: {} });
    return this.normalizeGovernanceAction(raw);
  }

  /**
   * Serialize governance action to Cardano CBOR (same encoding as the tx uses).
   * The validator compares cbor.serialise(proposal_procedure.governance_action) == gov_action,
   * so we must use this encoding for the script parameter, not Plutus Data.
   */
  private getGovernanceActionCborHex(): string {
    // Encode the VGovernanceAction parameter as Plutus Data CBOR.
    return serializeData(this.getGovActionParam());
  }

  /**
   * Get the governance action parameter for the validator.
   * Supports InfoAction (NicePoll, constructor 6) and TreasuryWithdrawal (constructor 2).
   * This matches the Aiken type: pub type VGovernanceAction { ... }
   * Constructor indices: 0=VProtocolParameters, 1=HardFork, 2=TreasuryWithdrawal,
   * 3=NoConfidence, 4=ConstitutionalCommittee, 5=NewConstitution, 6=NicePoll
   */
  private govActionParamCallCount = 0;
  private getGovActionParam() {
    this.govActionParamCallCount++;
    const callId = this.govActionParamCallCount;
    const governanceAction = this.getCanonicalGovernanceAction();
    const withdrawalsFromAction =
      governanceAction?.kind === "TreasuryWithdrawalsAction"
        ? governanceAction?.action?.withdrawals
        : undefined;
    
    console.log(`[getGovActionParam #${callId}] Called with:`, {
      govActionType: this.govActionType,
      governanceActionKind: governanceAction?.kind,
      hasWithdrawals: !!withdrawalsFromAction,
      withdrawalsCount: withdrawalsFromAction
        ? Object.keys(withdrawalsFromAction).length
        : 0,
      withdrawals: withdrawalsFromAction,
      stackTrace: new Error().stack,
    });
    
    if (this.govActionType === 'TreasuryWithdrawalsAction') {
      // VTreasuryWithdrawal is constructor 2
      // Structure: mConStr(2, [beneficiariesPairs, guardrailsOption])
      // beneficiaries: Pairs<Credential, Lovelace> - list of pairs
      // guardrails: Option<ScriptHash> - None for now (can be enhanced later)
      
      // Create array of Pair structures: each pair is [Credential, Lovelace]
      // In Aiken, Pairs<Credential, Lovelace> is a list of pairs
      // Each pair is represented as a tuple (constructor 0 with 2 fields)
      if (governanceAction?.kind !== "TreasuryWithdrawalsAction") {
        throw new Error(
          `Governance action type mismatch. Expected TreasuryWithdrawalsAction, got ${governanceAction?.kind}.`,
        );
      }

      const withdrawals = governanceAction.action?.withdrawals;
      if (!withdrawals || Object.keys(withdrawals).length === 0) {
        throw new Error(
          "TreasuryWithdrawalsAction requires withdrawals in governanceAction.action.withdrawals",
        );
      }

      const withdrawalEntries = Object.entries(withdrawals).sort(([a], [b]) =>
        a.localeCompare(b),
      );

      const beneficiaryPairs = withdrawalEntries.map(([address, rawAmount], index) => {
        if (
          !address.startsWith("stake1") &&
          !address.startsWith("stake_test1")
        ) {
          throw new Error(
            `Treasury withdrawals require reward addresses (stake1.../stake_test1...). ` +
              `Got: ${address}`,
          );
        }
        console.log(`[getGovActionParam] Processing withdrawal ${index}:`, {
          address,
          amount: rawAmount,
          amountType: typeof rawAmount,
        });

        if (!address) {
          throw new Error(`Treasury withdrawal at index ${index} is missing address`);
        }

        // Check amount with detailed logging
        console.log(`[getGovActionParam] Withdrawal ${index} rawAmount:`, {
          value: rawAmount,
          type: typeof rawAmount,
          isUndefined: rawAmount === undefined,
          isNull: rawAmount === null,
          isEmpty: rawAmount === "",
          isZero: rawAmount === "0",
        });

        if (rawAmount === undefined || rawAmount === null) {
          throw new Error(
            `Treasury withdrawal at index ${index} has undefined/null amount. ` +
              `Address: ${address}`,
          );
        }
        if (rawAmount === "" || rawAmount === "0") {
          throw new Error(
            `Treasury withdrawal at index ${index} has empty or zero amount: "${rawAmount}"`,
          );
        }

        // Decode payment address to get credential hash and type
        const { hash: credentialHashHex, isScript: isScriptCredential } =
          this.decodePaymentAddressWithType(address);

        console.log(`[getGovActionParam] Withdrawal ${index} credential:`, {
          credentialHashHex,
          isScriptCredential,
          addressPrefix: address.substring(0, 15),
        });

        // Create credential - use Script type for script-derived addresses
        // Construct credential manually to ensure hash is treated as bytearray
        // For VerificationKey: Constr 0 [ByteArray]
        // For Script: Constr 1 [ByteArray]
        const credential = isScriptCredential
          ? mConStr1([credentialHashHex])  // Script credential
          : mConStr0([credentialHashHex]); // VerificationKey credential

        console.log(`[getGovActionParam] Withdrawal ${index} mCredential result:`, {
          credential,
          credentialJson: JSON.stringify(credential),
        });

        // Convert amount to BigInt - ensure it's a valid string/number
        const amountValue = typeof rawAmount === "string"
          ? rawAmount.trim()
          : String(rawAmount);

        console.log(`[getGovActionParam] Withdrawal ${index} amountValue after conversion:`, {
          amountValue,
          amountValueType: typeof amountValue,
        });

        if (!amountValue || amountValue === "" || amountValue === "0" || amountValue === "undefined" || amountValue === "null") {
          throw new Error(
            `Treasury withdrawal at index ${index} has invalid amount value: "${amountValue}" ` +
            `(original: "${rawAmount}", type: ${typeof rawAmount})`,
          );
        }

        // Create a pair tuple: [Credential, Lovelace]
        // Use mConStr to create a Pair structure (constructor 0 with 2 fields)
        let amountBigInt: bigint;
        try {
          amountBigInt = BigInt(amountValue);
        } catch (bigIntError) {
          console.error(`[getGovActionParam] BigInt conversion failed for withdrawal ${index}:`, {
            amountValue,
            amountValueType: typeof amountValue,
            rawAmount,
            rawAmountType: typeof rawAmount,
            error: bigIntError,
          });
          throw new Error(
            `Failed to convert amount to BigInt for treasury withdrawal at index ${index}. ` +
            `Value: "${amountValue}", Type: ${typeof amountValue}. ` +
            `Original error: ${bigIntError instanceof Error ? bigIntError.message : String(bigIntError)}`,
          );
        }
        console.log(`[getGovActionParam] Withdrawal ${index} BigInt conversion successful:`, amountBigInt.toString());

        // Create the pair structure
        const pair = mConStr(0, [credential, amountBigInt]);
        console.log(`[getGovActionParam] Withdrawal ${index} pair structure:`, pair);
        
        return pair;
      });
      
      console.log(`[getGovActionParam] beneficiaryPairs count:`, beneficiaryPairs.length);
      
      // In Plutus Data, a list is represented as an array of Data values
      // We pass the array directly - applyParamsToScript will serialize it correctly
      const beneficiariesList = beneficiaryPairs;
      
      console.log(`[getGovActionParam] beneficiariesList:`, beneficiariesList);
      
      // Guardrails: None for now (can be enhanced later if policyHash is provided)
      const policyHash = governanceAction.action?.policyHash;
      let guardrailsOption: ReturnType<typeof mNone> | ReturnType<typeof mSome<string>> =
        mNone();
      if (policyHash) {
        const policyHashUnknown = policyHash as unknown;
        const trimmedPolicy =
          typeof policyHashUnknown === "string"
            ? policyHashUnknown.trim()
            : typeof policyHashUnknown === "object" &&
              policyHashUnknown !== null &&
              "bytes" in policyHashUnknown
            ? String((policyHashUnknown as { bytes?: string }).bytes ?? "").trim()
            : "";
        if (!isHexString(trimmedPolicy)) {
          throw new Error(
            `Treasury withdrawal guardrails policyHash must be hex. Got: ${policyHash}`,
          );
        }
        guardrailsOption = mSome(trimmedPolicy);
      }
      
      console.log(`[getGovActionParam] guardrailsOption:`, guardrailsOption);
      
      // VTreasuryWithdrawal: constructor 2 with [beneficiariesList, guardrailsOption]
      // beneficiariesList is an array of pairs, guardrailsOption is an Option
      // IMPORTANT: The second field is always mNone() (Option::None). Never pass the full
      // gov action or any Constr 2 value here; on-chain decode_option_script_hash expects
      // guardrails_data to be Constr 1 [] (None) or Constr 0 [bytearray] (Some script hash).
      const finalStructure = mConStr(2, [beneficiariesList as any, guardrailsOption]);
      
      console.log(`[getGovActionParam] Final structure (raw Data):`, finalStructure);
      console.log(
        "[getGovActionParam] param structure for logging: constructor 2,",
        withdrawalEntries.length,
        "withdrawals, keys (sorted):",
        withdrawalEntries.map(([addr]) => addr),
      );

      return finalStructure;
    }

    if (this.govActionType === "InfoAction") {
      // InfoAction: NicePoll (constructor 6) with no fields
      // This must match the governanceAction passed to proposeGovAction()
      // Return raw Data object - applyParamsToScript handles serialization
      console.log(
        "[getGovActionParam] param structure for logging: constructor 6, 0 withdrawals, keys: []",
      );
      return mConStr(6, []);
    }

    throw new Error(
      `Unsupported governance action type: ${this.govActionType}.`,
    );
  }

  private getAuthTokenCbor() {
    const param = this.ensureParamUtxoInput();
    const compiled = findValidator(VALIDATOR_TITLES.AUTH_MINT);
    return applyParamsToScript(compiled, [
      mOutputReference(param.txHash, param.outputIndex),
    ]);
  }

  private getAuthTokenPolicyId() {
    return resolveScriptHash(this.getAuthTokenCbor(), "V3");
  }

  /**
   * Decode a bech32 pool ID to its hex hash
   */
  private decodePoolIdToHex(bech32PoolId: string): string {
    const decoded = bech32.decode(bech32PoolId);
    const bytes = bech32.fromWords(decoded.words);
    return Buffer.from(bytes).toString("hex");
  }

  private getCrowdfundSpendCbor() {
    const compiled = findValidator(VALIDATOR_TITLES.SPEND);

    // Encode the VGovernanceAction parameter as Plutus Data CBOR.
    // The validator compares the proposal's GovernanceAction against this parameter.
    const canonicalAction = this.getCanonicalGovernanceAction();
    const govActionBytes = this.getGovernanceActionCborHex();

    const withdrawalKeys =
      canonicalAction.kind === "TreasuryWithdrawalsAction"
        ? Object.keys(canonicalAction.action?.withdrawals || {})
        : [];
    console.log(
      "[gov_action_param] Plutus Data CBOR (used in script parametrization), kind:",
      canonicalAction.kind,
      ", withdrawals:",
      withdrawalKeys.length,
      ", keys (sorted):",
      withdrawalKeys,
      ", CBOR hex:",
      govActionBytes,
    );

    return applyParamsToScript(compiled, [
      this.getAuthTokenPolicyId(),
      stringToHex(this.proposerKeyHash),
      govActionBytes,  // Cardano CBOR bytes (not Plutus Data)
      this.decodePoolIdToHex(this.governance.delegatePoolId),
      this.governance.stakeRegisterDeposit,
      this.governance.drepRegisterDeposit,
      this.governance.govDeposit,
    ]);
  }

  private getCrowdfundSpendHash() {
    return resolveScriptHash(this.getCrowdfundSpendCbor(), "V3");
  }

  private getCrowdfundSpendScriptRef() {
    const spendCbor = this.getCrowdfundSpendCbor();
    return {
      scriptHash: resolveScriptHash(spendCbor, "V3"),
      scriptSize: (spendCbor.length / 2).toString(),
    };
  }

  private getStakeScriptCbor(entry: keyof typeof VALIDATOR_TITLES) {
    const compiled = findValidator(VALIDATOR_TITLES[entry]);
    return applyParamsToScript(compiled, [this.getAuthTokenPolicyId()]);
  }

  private getStakePublishCbor() {
    return this.getStakeScriptCbor("STAKE_PUBLISH");
  }

  private getStakePublishHash() {
    return resolveScriptHash(this.getStakePublishCbor(), "V3");
  }

  /**
   * Public method to compute the contract's reward address
   * Requires paramUtxo to be set first
   */
  public computeRewardAddress(): RewardAddress {
    const scriptHash = this.getStakePublishHash();
    return scriptHashToRewardAddress(scriptHash, this.networkId);
  }

  private getStakeVoteCbor() {
    return this.getStakeScriptCbor("STAKE_VOTE");
  }

  private getShareTokenCbor() {
    const compiled = findValidator(VALIDATOR_TITLES.SHARE_MINT);
    return applyParamsToScript(compiled, [this.getAuthTokenPolicyId()]);
  }

  private getShareTokenPolicyId() {
    return resolveScriptHash(this.getShareTokenCbor(), "V3");
  }

  get crowdfundAddress() {
    return this.cachedCrowdfundAddress;
  }

  set crowdfundAddress(address: string | undefined) {
    this.cachedCrowdfundAddress = address;
  }

  private ensureCrowdfundAddress(): string {
    if (!this.cachedCrowdfundAddress) {
      const stakeScriptHash = resolveScriptHash(
        this.getStakePublishCbor(),
        "V3",
      );
      const { address } = serializePlutusScript(
        { code: this.getCrowdfundSpendCbor(), version: "V3" },
        stakeScriptHash,
        this.networkId,
        true,
      );
      this.cachedCrowdfundAddress = address;
    }
    if (!this.cachedCrowdfundAddress) {
      throw new Error("Failed to derive crowdfund address");
    }
    return this.cachedCrowdfundAddress;
  }

  private getGovernanceRewardAddress(): RewardAddress {
    // Use the same method as the UI to ensure consistency
    // This correctly handles testnet vs mainnet based on networkId
    const scriptHash = this.getStakePublishHash();
    return scriptHashToRewardAddress(scriptHash, this.networkId);
  }

  private getDrepId() {
    return resolveScriptHashDRepId(this.getStakePublishHash());
  }

  private buildCrowdfundDatum(
    datum: CrowdfundDatumTS,
    shareTokenPolicy: string,
    stakeScriptHash: string,
  ) {
    return mConStr0([
      stakeScriptHash,
      shareTokenPolicy,
      mPubKeyAddress(this.ensureCrowdfundAddress()),
      datum.fundraise_target ?? 100_000_000_000,
      datum.current_fundraised_amount ?? 0,
      mBool(datum.allow_over_subscription ?? true),
      datum.deadline ?? 0,
      datum.expiry_buffer ?? 86_400,
      datum.min_charge ?? 2_000_000,
    ]);
  }

  private buildProposedDatum(datum: CrowdfundDatumTS, fundsControlled: bigint) {
    // Proposed is constructor 1 in CrowdfundGovDatum: Crowdfund(0), Proposed(1), Voted(2), Refundable(3)
    return mConStr1([
      datum.stake_script || this.getStakePublishHash(),
      datum.share_token || this.getShareTokenPolicyId(),
      fundsControlled,
      datum.deadline ?? 0,
    ]);
  }

  private buildVotedDatum(
    stakeScriptHash: string,
    shareTokenPolicy: string,
    fundsControlled: bigint,
    govActionId: GovernanceActionIdTS,
    deadline: number,
  ) {
    // GovernanceActionId is a product type (record) with [txHash, index]
    // Use mOutputReference which properly encodes as Plutus data list
    const govActionIdData = mOutputReference(
      govActionId.transaction,
      govActionId.proposal_procedure,
    );

    return mConStr2([
      stakeScriptHash,
      shareTokenPolicy,
      fundsControlled,
      govActionIdData,
      deadline,
    ]);
  }

  private buildRefundableDatum(
    stakeScriptHash: string,
    shareTokenPolicy: string,
    fundsControlled: bigint,
  ) {
    return mConStr3([stakeScriptHash, shareTokenPolicy, fundsControlled]);
  }

  private buildSpendRedeemer(tag: CrowdfundGovRedeemerTag) {
    return mConStr(tag, []);
  }

  private buildMintRedeemer(tag: MintPolarityTag) {
    return mConStr(tag, []);
  }

  private async fetchCrowdfundUtxo() {
    if (!this.fetcher) {
      throw new Error("Fetcher not configured. Provide a blockchain provider.");
    }
    const address = this.ensureCrowdfundAddress();
    const utxos = await this.fetcher.fetchAddressUTxOs(
      address,
      this.getAuthTokenPolicyId(),
    );
    if (!utxos || utxos.length === 0) {
      throw new Error("Crowdfund auth token UTxO not found.");
    }
    if (utxos.length > 1) {
      console.warn(
        "[MeshCrowdfundContract] Multiple auth token UTxOs found. Using the first match.",
      );
    }
    return utxos[0]!;
  }

  private getSlotAfterMinutes(minutes: number): string {
    const now = Date.now();
    const future = now + minutes * 60_000;

    console.log(
      `[getSlotAfterMinutes] SYNC method called with ${minutes} minutes`,
    );
    console.log(
      `[getSlotAfterMinutes] NEXT_PUBLIC_GOV_TESTNET: ${env.NEXT_PUBLIC_GOV_TESTNET}`,
    );

    if (env.NEXT_PUBLIC_GOV_TESTNET) {
      console.warn(
        "[getSlotAfterMinutes] WARNING: Sancho resolver requires async but sync method called!",
      );
      console.warn(
        "[getSlotAfterMinutes] Consider using async transaction building methods when NEXT_PUBLIC_GOV_TESTNET=true",
      );
    }

    // Use normal MeshJS resolver (sync)
    const slot = resolveSlotNo(this.networkId ? "mainnet" : "preprod", future);
    console.log(`[getSlotAfterMinutes] Sync resolver returned slot: ${slot}`);
    return slot;
  }

  private async getSlotAfterMinutesAsync(minutes: number): Promise<string> {
    const now = Date.now();
    const future = now + minutes * 60_000;

    // Switch between normal resolveSlotNo and Sancho resolver based on env var
    if (env.NEXT_PUBLIC_GOV_TESTNET) {
      try {
        const sanchoSlot = await resolveSlotNoSancho("sancho", future);
        return sanchoSlot;
      } catch (error) {
        // Fallback to normal resolver if Sancho fails
        const fallbackSlot = resolveSlotNo(
          this.networkId ? "mainnet" : "preprod",
          future,
        );
        return fallbackSlot;
      }
    } else {
      // Use normal MeshJS resolver
      const normalSlot = resolveSlotNo(
        this.networkId ? "mainnet" : "preprod",
        future,
      );
      return normalSlot;
    }
  }

  private ensureWalletInfo = async () => {
    const { utxos, collateral, walletAddress } =
      await this.getWalletInfoForTx();
    if (!collateral) {
      throw new Error("Collateral UTxO required.");
    }
    let fullUtxos: UTxO[] = [];
    try {
      if (this.fetcher) {
        fullUtxos = await this.fetcher.fetchAddressUTxOs(walletAddress);
      } else if (this.wallet) {
        fullUtxos = await this.wallet.getUtxos();
      }
    } catch {
      fullUtxos = [];
    }

    if (fullUtxos.length > 0) {
      const hasAsset = (u: UTxO) =>
        Array.isArray(u.output?.amount) &&
        u.output.amount.some((asset) => asset.unit !== "lovelace");
      const tokenUtxos = fullUtxos.filter(hasAsset);
      if (tokenUtxos.length > 0) {
        const seen = new Set(
          utxos.map(
            (u) => `${u.input.txHash}:${u.input.outputIndex}`,
          ),
        );
        for (const utxo of tokenUtxos) {
          const key = `${utxo.input.txHash}:${utxo.input.outputIndex}`;
          if (!seen.has(key)) {
            utxos.push(utxo);
            seen.add(key);
          }
        }
      }
    }

    const keyhashUtxos = utxos.filter((utxo) => {
      const address = utxo?.output?.address;
      if (!address || typeof address !== "string") return false;
      try {
        const decoded = deserializeAddress(address) as any;
        return Boolean(decoded?.pubKeyHash);
      } catch {
        return false;
      }
    });

    return { utxos: keyhashUtxos, collateral, walletAddress };
  };

  /**
   * Creates collateral UTxOs for the wallet.
   * Creates up to 3 UTxOs of 5 ADA each based on available balance.
   */
  setupCollateral = async (): Promise<{ tx: string }> => {
    const utxos = await this.wallet?.getUtxos();
    const walletAddress = await this.getWalletDappAddress();
    
    if (!utxos || utxos.length === 0) {
      throw new Error("No UTxOs found in wallet");
    }
    if (!walletAddress) {
      throw new Error("No wallet address found");
    }

    // Calculate total available lovelace
    const totalLovelace = utxos.reduce((sum, utxo) => {
      const lovelace = utxo.output.amount.find((a) => a.unit === "lovelace");
      return sum + BigInt(lovelace?.quantity || "0");
    }, 0n);

    // Each collateral UTxO is 5 ADA + we need some for fees (~0.5 ADA)
    const collateralAmount = 5_000_000n; // 5 ADA
    const feeBuffer = 500_000n; // 0.5 ADA for fees
    const minRequired = collateralAmount + feeBuffer;

    if (totalLovelace < minRequired) {
      throw new Error(
        `Insufficient balance. Need at least ${Number(minRequired) / 1_000_000} ADA, have ${Number(totalLovelace) / 1_000_000} ADA`
      );
    }

    // Calculate how many 5 ADA UTxOs we can create (max 3)
    const availableForCollateral = totalLovelace - feeBuffer;
    const possibleUtxos = Number(availableForCollateral / collateralAmount);
    const numCollateralUtxos = Math.min(possibleUtxos, 3);

    if (numCollateralUtxos < 1) {
      throw new Error("Insufficient balance to create collateral UTxO");
    }

    this.resetBuilder();
    
    // Add outputs for each collateral UTxO
    for (let i = 0; i < numCollateralUtxos; i++) {
      this.mesh.txOut(walletAddress, [
        { unit: "lovelace", quantity: collateralAmount.toString() },
      ]);
    }

    const tx = await this.mesh
      .selectUtxosFrom(utxos)
      .changeAddress(walletAddress)
      .complete();

    return { tx };
  };

  /**
   * Deploys a new crowdfund by minting the auth token and locking it at the crowdfund script address.
   */
  setupCrowdfund = async (datum: CrowdfundDatumTS) => {
    const { utxos, collateral, walletAddress } = await this.ensureWalletInfo();
    console.log("utxos:", utxos);
    console.log("paramUtxo:", this.paramUtxo);
    if (!this.paramUtxo && utxos.length > 0) {
      // Calculate minimum required lovelace for transaction
      // Outputs: crowdfund (~2 ADA) + reference script (80 ADA) + fees (~0.2 ADA)
      const minRequiredLovelace = BigInt(82_200_000); // ~82.2 ADA

      // Sort UTxOs by lovelace amount (descending)
      const sortedUtxos = utxos
        .map((utxo) => ({
          ...utxo,
          lovelaceAmount: lovelaceOf(utxo.output.amount),
        }))
        .sort((a, b) => (b.lovelaceAmount > a.lovelaceAmount ? 1 : -1));

      // Find first UTXO large enough to cover the cost
      const sufficientUtxo = sortedUtxos.find(
        (utxo) => utxo.lovelaceAmount >= minRequiredLovelace,
      );

      if (sufficientUtxo) {
        this.paramUtxo = sufficientUtxo;
      } else if (sortedUtxos.length > 0) {
        // Use the largest UTXO available - Mesh will add more inputs via selectUtxosFrom
        const largestUtxo = sortedUtxos[0]!;
        this.paramUtxo = largestUtxo;
        console.warn(
          `No single UTXO large enough. Using largest UTXO (${largestUtxo.lovelaceAmount.toString()} lovelace). Additional inputs will be selected automatically.`,
        );
      }
    }
    const crowdfundAddress = this.ensureCrowdfundAddress();
    const shareTokenPolicy = this.getShareTokenPolicyId();
    const stakeScriptHash = this.getStakePublishHash();
    const param = this.ensureFullParamUtxo();

    const datumValue = this.buildCrowdfundDatum(
      {
        ...datum,
        crowdfund_address: crowdfundAddress,
        share_token: shareTokenPolicy,
        stake_script: stakeScriptHash,
      },
      shareTokenPolicy,
      stakeScriptHash,
    );

    const refAddress = this.getRefAddress();
    if (!refAddress) {
      throw new Error("Reference address not set");
    }

    const assetMetadata = {
      name: "Crowdfund Auth Token",
      image: "ipfs://QmRzicpReutwCkM6aotuKjErFCUD213DpwPq6ByuzMJaua",
      mediaType: "image/jpg",
      description: "This NFT was minted by Mesh (https://meshjs.dev/).",
    };
    const metadata = { [this.getAuthTokenPolicyId()]: { [""]: { ...assetMetadata } } };

    const crowdfundAssets = [{ unit: this.getAuthTokenPolicyId(), quantity: "1" }];
    if (this.govActionType === "TreasuryWithdrawalsAction") {
      const initialFunded = BigInt(datum.current_fundraised_amount ?? 0);
      const depositBuffer =
        BigInt(this.governance.stakeRegisterDeposit) +
        BigInt(this.governance.drepRegisterDeposit);
      const minAfterCerts = 3_000_000n;
      const requiredLovelace = initialFunded + depositBuffer + minAfterCerts;
      crowdfundAssets.push({
        unit: "lovelace",
        quantity: requiredLovelace.toString(),
      });
    }

    const sumLovelace = (assets: Amount[]) =>
      assets.reduce((sum, asset) => {
        if (asset.unit !== "lovelace") return sum;
        return sum + BigInt(asset.quantity);
      }, 0n);

    const requiredOutputLovelace =
      sumLovelace(crowdfundAssets) + 80_000_000n;
    const feeBuffer = 2_000_000n;
    const requiredInputLovelace = requiredOutputLovelace + feeBuffer;

    const paramLovelace = lovelaceOf(param.output.amount);
    let selectedTotal = paramLovelace;
    const selectedInputs: UTxO[] = [param];

    const isParamInput = (utxo: UTxO) =>
      utxo.input.txHash === param.input.txHash &&
      utxo.input.outputIndex === param.input.outputIndex;

    const candidateUtxos = utxos
      .filter((utxo) => !isParamInput(utxo))
      .sort((a, b) => {
        const aLovelace = lovelaceOf(a.output.amount);
        const bLovelace = lovelaceOf(b.output.amount);
        return aLovelace === bLovelace ? 0 : aLovelace > bLovelace ? -1 : 1;
      });

    for (const utxo of candidateUtxos) {
      if (selectedTotal >= requiredInputLovelace) break;
      selectedInputs.push(utxo);
      selectedTotal += lovelaceOf(utxo.output.amount);
    }

    if (selectedTotal < requiredInputLovelace) {
      throw new Error(
        `Insufficient balance for crowdfund setup. Needed ${requiredInputLovelace.toString()} lovelace, ` +
          `available ${selectedTotal.toString()} lovelace.`,
      );
    }

    this.resetBuilder();
    let txBuilder = this.mesh.txIn(
      param.input.txHash,
      param.input.outputIndex,
      param.output.amount,
      param.output.address,
      0,
    );

    for (const utxo of selectedInputs.slice(1)) {
      txBuilder = txBuilder.txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
        0,
      );
    }

    const tx = await txBuilder
      .mintPlutusScriptV3()
      .mint("1", this.getAuthTokenPolicyId(), "")
      .mintingScript(this.getAuthTokenCbor())
      .metadataValue(721, metadata)
      .mintRedeemerValue(this.buildMintRedeemer(MintPolarityTag.Mint))
      .txOut(crowdfundAddress, crowdfundAssets)
      .txOutInlineDatumValue(datumValue, "Mesh")
      // Reference script for spend validator attached to output 1
      // After transaction submission, store txHash with setRefSpendTxHash(txHash, 1)
      .txOut(refAddress, [{ unit: "lovelace", quantity: "80000000" }])
      .txOutReferenceScript(this.getCrowdfundSpendCbor(), "V3")
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .changeAddress(walletAddress)
      .complete();
    return {
      tx,
      paramUtxo: param.input,
      authTokenId: this.getAuthTokenPolicyId(),
      stake_script_hash: stakeScriptHash,
      share_token: shareTokenPolicy,
      crowdfund_address: crowdfundAddress,
    };
  };

  /**
   * Setup the stake reference script
   * Creates a transaction that outputs the stake validator script as a reference script
   * The reference script is attached to output 0
   * After transaction submission, store txHash with setRefStakeTxHash(txHash, 0)
   *
   * @returns - Transaction hex
   */
  setupStakeRefScript = async () => {
    const { utxos, collateral, walletAddress } = await this.ensureWalletInfo();
    const refAddress = this.getRefAddress();
    if (!refAddress) {
      throw new Error("Reference address not set");
    }

    this.resetBuilder();
    const tx = await this.mesh
      .txOut(refAddress, [{ unit: "lovelace", quantity: "70000000" }])
      .txOutReferenceScript(this.getStakePublishCbor(), "V3")
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .txOut(walletAddress, [{ unit: "lovelace", quantity: "5000000" }])
      .selectUtxosFrom(utxos)
      .changeAddress(walletAddress)
      .complete();

    return { tx };
  };

  /**
   * Contribute ADA to the crowdfund while minting proportional share tokens.
   */
  contributeCrowdfund = async (
    contributionAmount: number,
    datum: CrowdfundDatumTS,
  ) => {
    const { utxos, collateral, walletAddress } = await this.ensureWalletInfo();
    const authTokenUtxo = await this.fetchCrowdfundUtxo();

    // Validate UTxO structure
    if (
      !authTokenUtxo ||
      !authTokenUtxo.output ||
      !authTokenUtxo.output.amount
    ) {
      throw new Error("Invalid auth token UTxO structure");
    }
    if (!Array.isArray(authTokenUtxo.output.amount)) {
      throw new Error("authTokenUtxo.output.amount is not an array");
    }

    const newScriptValue = adjustLovelace(
      authTokenUtxo.output.amount,
      BigInt(contributionAmount),
    );
    const shareTokenPolicy = datum.share_token || this.getShareTokenPolicyId();
    const shareTokenOutput = [
      { unit: "lovelace", quantity: "2000000" },
      { unit: shareTokenPolicy, quantity: contributionAmount.toString() },
    ];
    const updatedDatum = this.buildCrowdfundDatum(
      {
        ...datum,
        current_fundraised_amount:
          (datum.current_fundraised_amount || 0) + contributionAmount,
      },
      shareTokenPolicy,
      datum.stake_script || this.getStakePublishHash(),
    );

    const slot = env.NEXT_PUBLIC_GOV_TESTNET
      ? await this.getSlotAfterMinutesAsync(5)
      : this.getSlotAfterMinutes(5);

    console.log(
      `[contributeCrowdfund] Using slot: ${slot} for transaction validity`,
    );

    // Check if reference script is set (outputIndex can be 0, so check !== undefined)
    const refSpendUtxo = this.ref_spend_txhash;
    const refSpendOutputIndex = this.ref_spend_outputIndex;

    if (!refSpendUtxo || refSpendOutputIndex === undefined) {
      throw new Error(
        `Reference script not set. ref_spend_txhash: ${refSpendUtxo || "undefined"}, ref_spend_outputIndex: ${refSpendOutputIndex === undefined ? "undefined" : refSpendOutputIndex}. ` +
          `Make sure the crowdfund has spendRefScript set in the database and it's passed to the constructor.`,
      );
    }
    const spendScriptRef = this.getCrowdfundSpendScriptRef();

    this.resetBuilder();
    let tx: string;
    try {
      tx = await this.mesh
        .spendingPlutusScriptV3()
        .txIn(
          authTokenUtxo.input.txHash,
          authTokenUtxo.input.outputIndex,
          authTokenUtxo.output.amount,
          authTokenUtxo.output.address,
          0,
        )
        .txInScript(this.getCrowdfundSpendCbor())
        .txInInlineDatumPresent()
        .spendingTxInReference(
          refSpendUtxo,
          refSpendOutputIndex,
          spendScriptRef.scriptSize,
          spendScriptRef.scriptHash,
        )
        .txInRedeemerValue(
          this.buildSpendRedeemer(CrowdfundGovRedeemerTag.ContributeFund),
        )
        .mintPlutusScriptV3()
        .mint(
          contributionAmount.toString(),
          shareTokenPolicy,
          "",
        )
        .mintingScript(this.getShareTokenCbor())
        .mintRedeemerValue(this.buildMintRedeemer(MintPolarityTag.Mint))
        .txOut(this.ensureCrowdfundAddress(), newScriptValue)
        .txOutInlineDatumValue(updatedDatum, "Mesh")
        .txOut(walletAddress, shareTokenOutput)
        .txInCollateral(
          collateral.input.txHash,
          collateral.input.outputIndex,
          collateral.output.amount,
          collateral.output.address,
        )
        .changeAddress(walletAddress)
        .selectUtxosFrom(utxos)
        .invalidHereafter(Number(slot))
        .complete();
    } catch (error) {
      const err = new Error(
        `contributeCrowdfund tx build failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      const errorType = typeof error;
      const errorProps =
        error && typeof error === "object"
          ? Object.getOwnPropertyNames(error)
          : undefined;
      const builderBody = (this.mesh as any)?.meshTxBuilderBody;
      const builderSnapshot = builderBody
        ? {
            fee: builderBody.fee,
            changeAddress: builderBody.changeAddress,
            validityRange: builderBody.validityRange,
            inputs: builderBody.inputs,
            outputs: builderBody.outputs,
            mints: builderBody.mints,
            collaterals: builderBody.collaterals,
            requiredSignatures: builderBody.requiredSignatures,
            referenceInputs: builderBody.referenceInputs,
            withdrawals: builderBody.withdrawals,
            votes: builderBody.votes,
          }
        : undefined;

      (err as { details?: Record<string, unknown> }).details = {
        stage: "contribute.complete",
        contributionAmount,
        walletAddress,
        hasEvaluator: Boolean((this.mesh as any)?.evaluator),
        utxoCount: utxos?.length ?? 0,
        collateral: {
          txHash: collateral.input.txHash,
          outputIndex: collateral.input.outputIndex,
        },
        authTokenUtxo: {
          txHash: authTokenUtxo.input.txHash,
          outputIndex: authTokenUtxo.input.outputIndex,
          address: authTokenUtxo.output.address,
          amount: authTokenUtxo.output.amount,
        },
        refSpend: { txHash: refSpendUtxo, outputIndex: refSpendOutputIndex },
        networkId: this.networkId,
        originalError: error,
        originalErrorType: errorType,
        originalErrorProps: errorProps,
        builderSnapshot,
      };
      throw err;
    }

    const evaluateTx = await this.mesh.evaluator?.evaluateTx(tx);
    console.log("evaluateTx:", evaluateTx);

    return { tx };
  };

  /**
   * Withdraw funds prior to governance completion (burning share tokens).
   */
  withdrawCrowdfund = async (
    withdrawAmount: number,
    datum: CrowdfundDatumTS,
  ) => {
    const { utxos, collateral, walletAddress } = await this.ensureWalletInfo();
    const authTokenUtxo = await this.fetchCrowdfundUtxo();
    const shareTokenPolicy = datum.share_token || this.getShareTokenPolicyId();
    const isKeyHashAddress = (address: string | undefined) => {
      if (!address) return false;
      try {
        const decoded = deserializeAddress(address) as any;
        return Boolean(decoded?.pubKeyHash);
      } catch {
        return false;
      }
    };
    const selectionUtxos = utxos.filter((u) =>
      isKeyHashAddress(u?.output?.address),
    );
    if (selectionUtxos.length === 0) {
      throw new Error("No valid key-hash UTxOs available for input selection.");
    }
    const requiredBurn = BigInt(withdrawAmount);
    const shareTokenInputs: UTxO[] = [];
    let remainingBurn = requiredBurn;

    for (const utxo of utxos) {
      const amounts = utxo?.output?.amount ?? [];
      if (!Array.isArray(amounts)) continue;
      const shareTokenEntry = amounts.find((asset) => asset.unit === shareTokenPolicy);
      if (!shareTokenEntry) continue;
      const qty = BigInt(shareTokenEntry.quantity ?? "0");
      if (qty <= 0n) continue;
      if (utxo?.output?.address?.startsWith("addr")) {
        try {
          const decoded = deserializeAddress(utxo.output.address) as any;
          const hasPaymentScript = Boolean(decoded?.scriptHash);
          if (hasPaymentScript) {
            continue;
          }
        } catch {
          // ignore address decode errors; skip script inputs conservatively
          continue;
        }
      }
      shareTokenInputs.push(utxo);
      remainingBurn -= qty;
      if (remainingBurn <= 0n) break;
    }

    if (requiredBurn > 0n && remainingBurn > 0n) {
      throw new Error(
        `Insufficient share tokens to burn. Required: ${requiredBurn.toString()}, ` +
          `available: ${(requiredBurn - remainingBurn).toString()}. ` +
          `Ensure the contributor UTxO holding share tokens is available.`,
      );
    }
    const newScriptValue = adjustLovelace(
      authTokenUtxo.output.amount,
      -BigInt(withdrawAmount),
    );
    const updatedDatum = this.buildCrowdfundDatum(
      {
        ...datum,
        current_fundraised_amount:
          (datum.current_fundraised_amount || 0) - withdrawAmount,
      },
      shareTokenPolicy,
      datum.stake_script || this.getStakePublishHash(),
    );
    const slot = env.NEXT_PUBLIC_GOV_TESTNET
      ? await this.getSlotAfterMinutesAsync(5)
      : this.getSlotAfterMinutes(5);

    // Check if reference script is set (outputIndex can be 0, so check !== undefined)
    const refSpendUtxo = this.ref_spend_txhash;
    const refSpendOutputIndex = this.ref_spend_outputIndex;

    if (!refSpendUtxo || refSpendOutputIndex === undefined) {
      throw new Error(
        `Reference script not set. ref_spend_txhash: ${refSpendUtxo || "undefined"}, ref_spend_outputIndex: ${refSpendOutputIndex === undefined ? "undefined" : refSpendOutputIndex}. ` +
          `Make sure the crowdfund has spendRefScript set in the database and it's passed to the constructor.`,
      );
    }
    const spendScriptRef = this.getCrowdfundSpendScriptRef();

    this.resetBuilder();
    let tx: string;
    try {
      let txBuilder = this.mesh
        .spendingPlutusScriptV3()
        .txIn(
          authTokenUtxo.input.txHash,
          authTokenUtxo.input.outputIndex,
          authTokenUtxo.output.amount,
          authTokenUtxo.output.address,
          0,
        )
        .spendingTxInReference(
          refSpendUtxo,
          refSpendOutputIndex,
          spendScriptRef.scriptSize,
          spendScriptRef.scriptHash,
        )
        .txInInlineDatumPresent()
        .txInRedeemerValue(
          this.buildSpendRedeemer(CrowdfundGovRedeemerTag.ContributorWithdrawal),
        );

      for (const utxo of shareTokenInputs) {
        txBuilder = txBuilder.txIn(
          utxo.input.txHash,
          utxo.input.outputIndex,
          utxo.output.amount,
          utxo.output.address,
          0,
        );
      }

      tx = await txBuilder
        .mintPlutusScriptV3()
        .mint(
          (-withdrawAmount).toString(),
          shareTokenPolicy,
          "",
        )
        .mintingScript(this.getShareTokenCbor())
        .mintRedeemerValue(this.buildMintRedeemer(MintPolarityTag.Burn))
        .txOut(this.ensureCrowdfundAddress(), newScriptValue)
        .txOutInlineDatumValue(updatedDatum, "Mesh")
        .txInCollateral(
          collateral.input.txHash,
          collateral.input.outputIndex,
          collateral.output.amount,
          collateral.output.address,
        )
        .changeAddress(walletAddress)
        .selectUtxosFrom(selectionUtxos)
        .invalidHereafter(Number(slot))
        .complete();
    } catch (error) {
      const err = new Error(
        `withdrawCrowdfund tx build failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      const errorType = typeof error;
      const errorProps =
        error && typeof error === "object"
          ? Object.getOwnPropertyNames(error)
          : undefined;
      const builderBody = (this.mesh as any)?.meshTxBuilderBody;
      const builderSnapshot = builderBody
        ? {
            fee: builderBody.fee,
            changeAddress: builderBody.changeAddress,
            validityRange: builderBody.validityRange,
            inputs: builderBody.inputs,
            outputs: builderBody.outputs,
            mints: builderBody.mints,
            collaterals: builderBody.collaterals,
            requiredSignatures: builderBody.requiredSignatures,
            referenceInputs: builderBody.referenceInputs,
            withdrawals: builderBody.withdrawals,
            votes: builderBody.votes,
          }
        : undefined;

      (err as { details?: Record<string, unknown> }).details = {
        stage: "withdraw.complete",
        withdrawAmount,
        walletAddress,
        hasEvaluator: Boolean((this.mesh as any)?.evaluator),
        utxoCount: utxos?.length ?? 0,
        collateral: {
          txHash: collateral.input.txHash,
          outputIndex: collateral.input.outputIndex,
        },
        authTokenUtxo: {
          txHash: authTokenUtxo.input.txHash,
          outputIndex: authTokenUtxo.input.outputIndex,
          address: authTokenUtxo.output.address,
          amount: authTokenUtxo.output.amount,
        },
        refSpendUtxo: {
          txHash: refSpendUtxo,
          outputIndex: refSpendOutputIndex,
        },
        builderSnapshot,
        originalError:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
        originalErrorType: errorType,
        originalErrorProps: errorProps,
      };
      throw err;
    }

    return { tx };
  };

  registerCerts = async ({
    datum,
    anchorDrep,
  }: {
    datum: CrowdfundDatumTS;
    anchorDrep?: GovernanceAnchor;
  }) => {
    let walletAddress: string | undefined;
    let utxoCount = 0;
    let certDeposits = 0;
    let requiredAda = 0n;
    let totalAda = 0n;
    let authTokenUtxo: UTxO | undefined;
    let proposalAction: GovernanceAction | undefined;
    let proposalAnchor: Anchor | undefined;
    let failureStage = "init";

    try {
      failureStage = "ensureWalletInfo";
      const {
        utxos: allUtxos,
        collateral,
        walletAddress: resolvedWalletAddress,
      } = await this.ensureWalletInfo();
      walletAddress = resolvedWalletAddress;
      utxoCount = Array.isArray(allUtxos) ? allUtxos.length : 0;

      // Calculate required ADA for certificate deposits + gov deposit + fees
      const protocolParams = (this.mesh as any)?._protocolParams as
        | { drepDeposit?: number; drep_deposit?: number; poolDeposit?: number }
        | undefined;
      const drepDeposit =
        this.governance.drepRegisterDeposit ||
        protocolParams?.drepDeposit ||
        protocolParams?.drep_deposit ||
        protocolParams?.poolDeposit ||
        0;
      certDeposits = this.governance.stakeRegisterDeposit + drepDeposit;
      requiredAda = BigInt(
        certDeposits + this.governance.govDeposit + 15_000_000,
      ); // ~15 ADA for fees

      // Sort UTxOs by ADA amount (descending) and select efficiently
      const sortedUtxos = allUtxos
        .map((utxo) => ({
          ...utxo,
          adaAmount: BigInt(
            utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity ||
              "0",
          ),
        }))
        .sort((a, b) => (b.adaAmount > a.adaAmount ? 1 : -1));

      const maxInputs = 30;
      // Select UTxOs until we have enough ADA
      const selectedUtxos = [];
      totalAda = 0n;

      for (const utxo of sortedUtxos) {
        if (selectedUtxos.length >= maxInputs) break;

        selectedUtxos.push(utxo);
        totalAda += utxo.adaAmount;

        if (totalAda >= requiredAda) {
          break;
        }
      }

      if (totalAda < requiredAda) {
        throw new Error(
          `Insufficient wallet balance for register certs. Required: ${requiredAda.toString()}, ` +
            `available: ${totalAda.toString()}, selected inputs: ${selectedUtxos.length}.`,
        );
      }

      const utxos = selectedUtxos;
      failureStage = "fetchCrowdfundUtxo";
      authTokenUtxo = await this.fetchCrowdfundUtxo();

      // Verify crowdfund has sufficient funds for certificate deposits only
      const crowdfundLovelace = lovelaceOf(authTokenUtxo.output.amount);
      const requiredLovelace = BigInt(certDeposits);

      if (crowdfundLovelace < requiredLovelace) {
        throw new Error(
          `Insufficient crowdfund balance. Required: ${requiredLovelace.toString()}, Available: ${crowdfundLovelace.toString()}`,
        );
      }

      // Deduct only certificate deposits (not gov deposit)
      // RegisterCerts keeps the same Crowdfund datum (no state transition)
      const updatedValue = adjustLovelace(
        authTokenUtxo.output.amount,
        -BigInt(certDeposits),
      );
      // Output same Crowdfund datum (matching validator line 244: output_datum_check = only_output_datum == auth_input_datum)
      // Use the exact datum from the input UTxO to ensure exact equality
      // Note: inlineDatum may not be in the TypeScript type but exists at runtime
      const outputWithInlineDatum = authTokenUtxo.output as any;
      let outputDatum;
      if (outputWithInlineDatum.inlineDatum) {
        // Check if inlineDatum is already a Mesh Data object (has type and content properties)
        if (
          typeof outputWithInlineDatum.inlineDatum === "object" &&
          outputWithInlineDatum.inlineDatum !== null &&
          "type" in outputWithInlineDatum.inlineDatum &&
          "content" in outputWithInlineDatum.inlineDatum
        ) {
          // Use the datum directly if it's already in Mesh Data format
          outputDatum = outputWithInlineDatum.inlineDatum;
          console.log("[registerCerts] Using inline datum directly from UTxO");
        } else if (typeof outputWithInlineDatum.inlineDatum === "string") {
          // If it's a CBOR hex string, we need to parse it
          // For now, fallback to building from parameter since parsing CBOR requires additional utilities
          console.warn(
            "[registerCerts] Inline datum is CBOR hex string, building from parameter to ensure correct structure",
          );
          outputDatum = this.buildCrowdfundDatum(
            datum,
            datum.share_token || this.getShareTokenPolicyId(),
            datum.stake_script || this.getStakePublishHash(),
          );
        } else {
          // Unknown format, fallback to building from parameter
          console.warn(
            "[registerCerts] Unknown inline datum format, falling back to building from parameter",
          );
          outputDatum = this.buildCrowdfundDatum(
            datum,
            datum.share_token || this.getShareTokenPolicyId(),
            datum.stake_script || this.getStakePublishHash(),
          );
        }
      } else {
        // Fallback to building from parameter if no inline datum
        console.warn(
          "[registerCerts] No inline datum found in UTxO, building from parameter",
        );
        outputDatum = this.buildCrowdfundDatum(
          datum,
          datum.share_token || this.getShareTokenPolicyId(),
          datum.stake_script || this.getStakePublishHash(),
        );
      }

      failureStage = "prepareSlots";
      const slot = env.NEXT_PUBLIC_GOV_TESTNET
        ? await this.getSlotAfterMinutesAsync(10)
        : this.getSlotAfterMinutes(10);
      const rewardAddress = this.getGovernanceRewardAddress();
      const drepId = this.getDrepId();

      // Validate pool ID format
      if (
        !this.governance.delegatePoolId ||
        this.governance.delegatePoolId.length < 56
      ) {
        throw new Error(
          `Invalid pool ID format. Expected 56+ characters, got ${this.governance.delegatePoolId?.length || 0}. Pool ID: "${this.governance.delegatePoolId}"`,
        );
      }

      // Resolve DRep anchor
      let drepAnchorResolved = ensureAnchorOptional(
        "drep",
        anchorDrep,
        this.governance.anchorDrep,
      );

      if (
        !drepAnchorResolved ||
        !drepAnchorResolved.url ||
        !drepAnchorResolved.hash
      ) {
        throw new Error(
          "DRep anchor is required for registerCerts. Please provide anchorDrep.",
        );
      }

      // Validate reference scripts (from validator line 236-239)
      const refSpendUtxo = this.ref_spend_txhash;
      const refSpendOutputIndex = this.ref_spend_outputIndex;
      if (!refSpendUtxo || refSpendOutputIndex === undefined) {
        throw new Error(
          `Spend reference script not set. ref_spend_txhash: ${refSpendUtxo || "undefined"}, ref_spend_outputIndex: ${refSpendOutputIndex === undefined ? "undefined" : refSpendOutputIndex}. ` +
            `Make sure the crowdfund has spendRefScript set in the database and it's passed to the constructor.`,
        );
      }

      const refStakeUtxo = this.ref_stake_txhash;
      const refStakeOutputIndex = this.ref_stake_outputIndex;
      if (!refStakeUtxo || refStakeOutputIndex === undefined) {
        throw new Error(
          `Stake reference script not set. ref_stake_txhash: ${refStakeUtxo || "undefined"}, ref_stake_outputIndex: ${refStakeOutputIndex === undefined ? "undefined" : refStakeOutputIndex}. ` +
            `Call setupStakeRefScript first to create the stake reference script transaction.`,
        );
      }

      const refStakeCborLength = (
        this.getStakePublishCbor().length / 2
      ).toString();
      const stakeScriptHash = this.getStakePublishHash();
      const spendScriptRef = this.getCrowdfundSpendScriptRef();
      console.log("outputDatum:", outputDatum);

      console.log(utxos);

      // Get governance action and anchor for the proposal
      // RegisterCerts must include a proposal in the same transaction (validator line 261-264)
      const canonicalAction = this.getCanonicalGovernanceAction();
      proposalAction = canonicalAction;
      const govAnchor = ensureAnchor(
        "governance",
        undefined,
        this.governance.anchorGovAction,
      );
      proposalAnchor = {
        anchorUrl: govAnchor.url,
        anchorDataHash: govAnchor.hash,
      } as Anchor;

      console.log("[registerCerts] Including proposal with governance action:", {
        kind: canonicalAction.kind,
        anchor: govAnchor,
      });

      // Build transaction matching validator structure (lines 231-286)
      failureStage = "buildTx";
      this.resetBuilder();
      let txBuilder = this.mesh
        .spendingPlutusScriptV3()
        .txIn(
          authTokenUtxo.input.txHash,
          authTokenUtxo.input.outputIndex,
          authTokenUtxo.output.amount,
          authTokenUtxo.output.address,
          0,
        )
        .txInInlineDatumPresent()
        .spendingTxInReference(
          refSpendUtxo,
          refSpendOutputIndex,
          spendScriptRef.scriptSize,
          spendScriptRef.scriptHash,
        ) //Spend reference script for better perfomance
        .txInRedeemerValue(
          this.buildSpendRedeemer(CrowdfundGovRedeemerTag.RegisterCerts),
        )
        .txOut(this.ensureCrowdfundAddress(), updatedValue)
        .txOutInlineDatumValue(outputDatum, "Mesh")

        // Register stake certificate
        .registerStakeCertificate(rewardAddress as string)
        // Delegate stake to pool
        .delegateStakeCertificate(
          rewardAddress as string,
          this.governance.delegatePoolId,
        )
        .certificateTxInReference(
          refStakeUtxo,
          refStakeOutputIndex,
          refStakeCborLength,
          stakeScriptHash,
          "V3",
        )
        .certificateRedeemerValue(
          mConStr(0, []), //PublishRedeemer.Register
          undefined,
          { mem: 200000, steps: 200000000 },
        )
        // Register DRep certificate
        .drepRegistrationCertificate(drepId, {
          anchorUrl: drepAnchorResolved.url,
          anchorDataHash: drepAnchorResolved.hash,
        })
        .certificateTxInReference(
          refStakeUtxo,
          refStakeOutputIndex,
          refStakeCborLength,
          stakeScriptHash,
          "V3",
        )
        .certificateRedeemerValue(
          mConStr(0, []), //PublishRedeemer.Register
          undefined,
          { mem: 200000, steps: 200000000 },
        )
        // Delegate vote to DRep
        .voteDelegationCertificate({ dRepId: drepId }, rewardAddress)
        .certificateTxInReference(
          refStakeUtxo,
          refStakeOutputIndex,
          refStakeCborLength,
          stakeScriptHash,
          "V3",
        )
        .certificateRedeemerValue(
          mConStr(0, []), //PublishRedeemer.Register
          undefined,
          { mem: 200000, steps: 200000000 },
        );

      // Add governance proposal (required by validator line 261-264)
      const proposalDeposit = this.governance.govDeposit.toString();

      failureStage = "attachProposal";
      const proposalMethodExists =
        typeof (txBuilder as { proposal?: unknown }).proposal === "function";
      let proposalItemType = "BasicProposal";
      const proposalItem = {
        type: "BasicProposal" as const,
        proposalType: {
          governanceAction: canonicalAction,
          anchor: proposalAnchor,
          rewardAccount: rewardAddress,
          deposit: proposalDeposit,
        },
      };
      if (proposalMethodExists) {
        txBuilder = (txBuilder as any).proposal(
          canonicalAction,
          proposalAnchor,
          rewardAddress,
          proposalDeposit,
        );
      } else {
        const txAny = txBuilder as {
          meshTxBuilderBody?: { proposals?: unknown[] };
        };
        if (!txAny.meshTxBuilderBody) {
          throw new Error("MeshTxBuilder missing meshTxBuilderBody for proposal");
        }
        if (!Array.isArray(txAny.meshTxBuilderBody.proposals)) {
          txAny.meshTxBuilderBody.proposals = [];
        }
        txAny.meshTxBuilderBody.proposals.push(proposalItem);
        proposalItemType = proposalItem.type;
      }

      // RegisterCerts only registers certificates and keeps the Crowdfund state
      failureStage = "finalizeBuilder";
      const tx = txBuilder
        .txInCollateral(
          collateral.input.txHash,
          collateral.input.outputIndex,
          collateral.output.amount,
          collateral.output.address,
        )
        .requiredSignerHash(this.proposerKeyHash)
        .selectUtxosFrom(utxos)
        .changeAddress(walletAddress)
        .invalidHereafter(Number(slot));

      const txBody = tx as {
        meshTxBuilderBody?: { proposals?: unknown[] };
      };
      if (!txBody.meshTxBuilderBody) {
        throw new Error("MeshTxBuilder missing meshTxBuilderBody for proposal");
      }
      if (!Array.isArray(txBody.meshTxBuilderBody.proposals)) {
        txBody.meshTxBuilderBody.proposals = [];
      }
      if (txBody.meshTxBuilderBody.proposals.length === 0) {
        txBody.meshTxBuilderBody.proposals.push(proposalItem);
      }

      console.log("tx:", tx);

      //await tx.evaluateRedeemers();
      failureStage = "completeTx";
      const completeTx = await tx.complete();
      console.log("completeTx:", completeTx);
      failureStage = "evaluateTx";
      const provider = getProvider(this.networkId) as {
        evaluateTx?: (tx: string) => Promise<unknown>;
      };
      if (typeof provider?.evaluateTx === "function") {
        const evaluateTx = await provider.evaluateTx(completeTx);
        console.log("evaluateTx:", evaluateTx);
      } else {
        console.warn(
          "[registerCerts] Provider does not support evaluateTx; skipping evaluation",
        );
      }

      const builderBody = (this.mesh as any)?.meshTxBuilderBody;
      const totalDepositRaw = (this.mesh as any)?.getTotalDeposit?.();
      const totalDeposit =
        typeof totalDepositRaw === "bigint"
          ? totalDepositRaw.toString()
          : totalDepositRaw;
      const sumLovelace = (amounts: any[] | undefined) => {
        if (!Array.isArray(amounts)) return 0n;
        const lovelace = amounts.find((asset) => asset?.unit === "lovelace");
        return BigInt(lovelace?.quantity ?? "0");
      };
      const inputLovelace = builderBody?.inputs?.reduce(
        (sum: bigint, input: any) => sum + sumLovelace(input?.txIn?.amount),
        0n,
      );
      const extraInputLovelace = builderBody?.extraInputs?.reduce(
        (sum: bigint, input: any) =>
          sum + sumLovelace(input?.output?.amount ?? input?.amount),
        0n,
      );
      const outputLovelace = builderBody?.outputs?.reduce(
        (sum: bigint, output: any) => sum + sumLovelace(output?.amount),
        0n,
      );
      const outputBreakdown = builderBody?.outputs?.map((output: any) => ({
        address: typeof output?.address === "string"
          ? `${output.address.slice(0, 12)}...${output.address.slice(-6)}`
          : undefined,
        lovelace: sumLovelace(output?.amount).toString(),
      }));
      const manualTotalDeposit = (() => {
        if (!builderBody) return undefined;
        let accum = 0n;
        const protocolKeyDeposit =
          (this.mesh as any)?._protocolParams?.keyDeposit ??
          this.governance.stakeRegisterDeposit;
        for (const cert of builderBody.certificates ?? []) {
          const certType = cert?.certType;
          if (!certType?.type) continue;
          if (certType.type === "RegisterStake") {
            accum += BigInt(protocolKeyDeposit ?? 0);
          } else if (certType.type === "RegisterPool") {
            accum += BigInt(
              (this.mesh as any)?._protocolParams?.poolDeposit ?? 0,
            );
          } else if (certType.type === "DRepRegistration") {
            accum += BigInt(certType.coin ?? 0);
          } else if (certType.type === "StakeRegistrationAndDelegation") {
            accum += BigInt(certType.coin ?? 0);
          } else if (certType.type === "VoteRegistrationAndDelegation") {
            accum += BigInt(certType.coin ?? 0);
          } else if (certType.type === "StakeVoteRegistrationAndDelegation") {
            accum += BigInt(certType.coin ?? 0);
          }
        }
        for (const proposal of builderBody.proposals ?? []) {
          const deposit = proposal?.proposalType?.deposit;
          if (deposit === undefined || deposit === null) continue;
          accum += BigInt(deposit);
        }
        return accum.toString();
      })();

      let parsedSummary: Record<string, unknown> | undefined;
      try {
        const serializer = (this.mesh as any)?.serializer;
        if (serializer && this.fetcher && typeof TxParser === "function") {
          const parser = new TxParser(serializer, this.fetcher);
          const parsed = await parser.parse(completeTx);
          parsedSummary = {
            parsedInputs: parsed?.inputs?.length ?? 0,
            parsedOutputs: parsed?.outputs?.length ?? 0,
            parsedCertificates: parsed?.certificates?.length ?? 0,
            parsedProposals: parsed?.proposals?.length ?? 0,
            parsedFee: parsed?.fee ?? undefined,
          };
        } else if (serializer && this.fetcher) {
          parsedSummary = { parseSkipped: "TxParser unavailable" };
        }
      } catch (parseError) {
        parsedSummary = {
          parseError:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        };
      }

      const debug = builderBody
        ? {
            proposalCount: builderBody.proposals?.length ?? 0,
            proposalDeposits: builderBody.proposals?.map(
              (p: any) => p?.proposalType?.deposit,
            ),
            proposalMethodExists,
            proposalItemType: proposalItemType ?? null,
            certificateTypes: builderBody.certificates?.map(
              (c: any) => c?.certType?.type,
            ),
            certDeposits,
            governanceDeposits: {
              stakeRegisterDeposit: this.governance.stakeRegisterDeposit,
              drepRegisterDeposit: this.governance.drepRegisterDeposit,
              govDeposit: this.governance.govDeposit,
            },
            totalDeposit,
            manualTotalDeposit,
            implicitDepositAtSelect: (this.mesh as any)?._lastImplicitDeposit
              ? (this.mesh as any)._lastImplicitDeposit.toString?.() ??
                (this.mesh as any)._lastImplicitDeposit
              : undefined,
            fee: builderBody.fee,
            inputCount: builderBody.inputs?.length ?? 0,
            outputCount: builderBody.outputs?.length ?? 0,
            inputLovelace: inputLovelace?.toString(),
            extraInputsCount: builderBody.extraInputs?.length ?? 0,
            extraInputLovelace: extraInputLovelace?.toString(),
            outputLovelace: outputLovelace?.toString(),
            parsedSummary,
            outputBreakdown,
          }
        : undefined;

      return { tx: completeTx, debug };
    } catch (error) {
      const rawErrorProps =
        error && typeof error === "object"
          ? Object.getOwnPropertyNames(error as object)
          : [];
      const rawErrorSnapshot =
        error && typeof error === "object"
          ? Object.fromEntries(
              rawErrorProps.map((prop) => [prop, (error as any)[prop]]),
            )
          : undefined;
      const message =
        error instanceof Error && error.message
          ? `Register certs failed: ${error.message}`
          : "Register certs failed";
      const wrapped = new Error(message);
      (wrapped as { cause?: unknown }).cause = error;
      (wrapped as { details?: unknown }).details = {
        stage: "registerCerts",
        failureStage,
        walletAddress,
        utxoCount,
        certDeposits,
        govDeposit: this.governance.govDeposit,
        requiredAda: requiredAda.toString(),
        totalAda: totalAda.toString(),
        authTokenUtxo: authTokenUtxo
          ? {
              txHash: authTokenUtxo.input.txHash,
              outputIndex: authTokenUtxo.input.outputIndex,
              address: authTokenUtxo.output.address,
              amount: authTokenUtxo.output.amount,
            }
          : undefined,
        proposalAction,
        proposalAnchor,
        builderBody: (this.mesh as { meshTxBuilderBody?: unknown }).meshTxBuilderBody,
        proposalItem: (this.mesh as unknown as { proposalItem?: unknown }).proposalItem,
        rawErrorProps,
        rawErrorSnapshot,
        originalError:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : String(error),
      };
      throw wrapped;
    }
  };

  /**
   * Propose governance action: Transition from Crowdfund → Proposed
   * Locks gov_deposit
   */
  proposeGovAction = async ({
    datum,
    anchorGovAction,
    governanceAction,
  }: ProposeGovActionArgs) => {
    const { utxos, collateral, walletAddress } = await this.ensureWalletInfo();

    const authTokenUtxo = await this.fetchCrowdfundUtxo();

    const govDeposit = this.governance.govDeposit;

    // Verify crowdfund has sufficient funds for deposit
    const crowdfundLovelace = lovelaceOf(authTokenUtxo.output.amount);
    const requiredLovelace = BigInt(govDeposit);

    if (crowdfundLovelace < requiredLovelace) {
      throw new Error(
        `Insufficient crowdfund balance. Required: ${requiredLovelace.toString()}, Available: ${crowdfundLovelace.toString()}`,
      );
    }

    const updatedValue = adjustLovelace(
      authTokenUtxo.output.amount,
      -BigInt(govDeposit),
    );
    // Use current_fundraised_amount from datum (not actual lovelace) - validator expects this exact value
    const fundsControlled = BigInt(datum.current_fundraised_amount);
    // Build Proposed datum from Crowdfund datum (transition: Crowdfund → Proposed)
    const proposedDatum = this.buildProposedDatum(datum, fundsControlled);
    const slot = env.NEXT_PUBLIC_GOV_TESTNET
      ? await this.getSlotAfterMinutesAsync(10)
      : this.getSlotAfterMinutes(10);
    const rewardAddress = this.getGovernanceRewardAddress();

    let govAnchor = ensureAnchor(
      "governance",
      anchorGovAction,
      this.governance.anchorGovAction,
    );

    // Get the governance action (defaults to InfoAction if not provided)
    const rawProposalAction =
      governanceAction ||
      this.governance.governanceAction || {
        kind: "InfoAction",
        action: {},
      };
    // Use canonical form (sorted withdrawals) so tx bytes match parametrized bytes
    const proposalAction = this.normalizeGovernanceAction(rawProposalAction);

    // Validate governance action matches the configured type
    if (this.govActionType === 'TreasuryWithdrawalsAction') {
      if (proposalAction.kind !== 'TreasuryWithdrawalsAction') {
        throw new Error(
          `Governance action type mismatch. Expected TreasuryWithdrawalsAction, got ${proposalAction.kind}. ` +
          `The validator is parameterized with TreasuryWithdrawal (VGovernanceAction constructor 2).`,
        );
      }
      // Validate that withdrawals are provided
      const withdrawals = proposalAction.action?.withdrawals;
      if (!withdrawals || Object.keys(withdrawals).length === 0) {
        throw new Error('TreasuryWithdrawalsAction requires withdrawals in the action object');
      }
      // Validate that beneficiaries match withdrawals if provided
      if (this.treasuryBeneficiaries && this.treasuryBeneficiaries.length > 0) {
        const withdrawalKeys = Object.keys(withdrawals);
        const beneficiaryAddresses = this.treasuryBeneficiaries.map(b => b.address);
        const addressesMatch = withdrawalKeys.every(addr => beneficiaryAddresses.includes(addr)) &&
          beneficiaryAddresses.every(addr => withdrawalKeys.includes(addr));
        if (!addressesMatch) {
          console.warn(
            '[proposeGovAction] Warning: Beneficiaries in config do not match withdrawals in action. ' +
            'Using withdrawals from action object.'
          );
        }
      }
    } else {
      // InfoAction (NicePoll, constructor 6)
      if (proposalAction.kind !== "InfoAction") {
        throw new Error(
          `Governance action type mismatch. Expected InfoAction (NicePoll), got ${proposalAction.kind}. ` +
          `The validator is parameterized with NicePoll (VGovernanceAction constructor 6).`,
        );
      }
    }

    // Validate spend reference script is set
    const refSpendUtxo = this.ref_spend_txhash;
    const refSpendOutputIndex = this.ref_spend_outputIndex;
    if (!refSpendUtxo || refSpendOutputIndex === undefined) {
      throw new Error(
        `Spend reference script not set. ref_spend_txhash: ${refSpendUtxo || "undefined"}, ref_spend_outputIndex: ${refSpendOutputIndex === undefined ? "undefined" : refSpendOutputIndex}. ` +
          `Make sure the crowdfund has spendRefScript set in the database and it's passed to the constructor.`,
      );
    }
    const spendScriptRef = this.getCrowdfundSpendScriptRef();

    // Validate stake reference script is set
    const refStakeUtxo = this.ref_stake_txhash;
    const refStakeOutputIndex = this.ref_stake_outputIndex;
    if (!refStakeUtxo || refStakeOutputIndex === undefined) {
      throw new Error(
        `Stake reference script not set. ref_stake_txhash: ${refStakeUtxo || "undefined"}, ref_stake_outputIndex: ${refStakeOutputIndex === undefined ? "undefined" : refStakeOutputIndex}. ` +
          `Call setupStakeRefScript first to create the stake reference script transaction.`,
      );
    }

    const refStakeCborLength = (
      this.getStakePublishCbor().length / 2
    ).toString();

    this.resetBuilder();
    const txBuilder = this.mesh
      .spendingPlutusScriptV3()
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
        0,
      )
      .txInInlineDatumPresent()
      .spendingTxInReference(
        refSpendUtxo,
        refSpendOutputIndex,
        spendScriptRef.scriptSize,
        spendScriptRef.scriptHash,
      )
      .txInRedeemerValue(
        this.buildSpendRedeemer(CrowdfundGovRedeemerTag.ProposeGovAction),
      )
      .txOut(this.ensureCrowdfundAddress(), updatedValue)
      .txOutInlineDatumValue(proposedDatum, "Mesh");

    const normalizedWithdrawals =
      proposalAction.kind === "TreasuryWithdrawalsAction"
        ? Object.entries(
            proposalAction.action?.withdrawals || {},
          ).sort(([a], [b]) => a.localeCompare(b))
        : [];
    console.log("[proposeGovAction] Proposal passed to .proposal():", {
      raw: proposalAction,
      kind: proposalAction.kind,
      normalizedWithdrawalsSorted: normalizedWithdrawals,
    });
    console.log(
      "[proposeGovAction] raw proposalAction JSON:",
      JSON.stringify(proposalAction),
    );

    const proposalDeposit = this.governance.govDeposit.toString();
    const proposalAnchor = {
      anchorUrl: govAnchor.url,
      anchorDataHash: govAnchor.hash,
    } as Anchor;

    const txBuilderWithProposal = txBuilder;
    const txAny = txBuilderWithProposal as {
      meshTxBuilderBody?: { proposals?: unknown[] };
    };
    if (!txAny.meshTxBuilderBody) {
      throw new Error("MeshTxBuilder missing meshTxBuilderBody for proposal");
    }
    if (!Array.isArray(txAny.meshTxBuilderBody.proposals)) {
      txAny.meshTxBuilderBody.proposals = [];
    }
    txAny.meshTxBuilderBody.proposals.push({
      type: "BasicProposal",
      proposalType: {
        governanceAction: proposalAction,
        anchor: proposalAnchor,
        rewardAccount: rewardAddress,
        deposit: proposalDeposit,
      },
    });

    const tx = await txBuilderWithProposal
      //adds governance proposal to the transaction
      // proposalAction is already a proper GovernanceAction type from MeshJS
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .txOut(walletAddress, [{ unit: "lovelace", quantity: "5000000" }])
      .selectUtxosFrom(utxos)
      .changeAddress(walletAddress)
      .invalidHereafter(Number(slot));

    console.log(tx);

    const completeTx = await tx.complete();
    console.log("completeTx:", completeTx);
    console.log(
      "[proposeGovAction] Compare [gov_action_param] serialized hex with the proposal in the tx; if they differ, the validator's proposal_check will fail.",
    );
    const evaluateTx = await this.mesh.evaluator?.evaluateTx(completeTx);
    console.log("evaluateTx:", evaluateTx);

    return { tx: completeTx };
  };

  voteOnGovAction = async ({ datum, voteKind }: VoteOnGovActionArgs) => {
    const { utxos, collateral, walletAddress } = await this.ensureWalletInfo();
    const authTokenUtxo = await this.fetchCrowdfundUtxo();
    const drepId = this.getDrepId();

    // Use datum from DB - handle both CrowdfundDatumTS and ProposedDatumTS
    const datumAny = datum as any;
    const stakeScript = datumAny.stake_script;
    const shareToken = datumAny.share_token;
    // funds_controlled in ProposedDatumTS, current_fundraised_amount in CrowdfundDatumTS
    const fundsControlled = BigInt(datumAny.funds_controlled ?? datumAny.current_fundraised_amount);
    const deadline = datumAny.deadline;

    const govActionId: GovernanceActionIdTS = {
      transaction: authTokenUtxo.input.txHash,
      proposal_procedure: 0,
    };

    const votedDatum = this.buildVotedDatum(
      stakeScript,
      shareToken,
      fundsControlled,
      govActionId,
      deadline,
    );

    const slot = env.NEXT_PUBLIC_GOV_TESTNET
      ? await this.getSlotAfterMinutesAsync(5)
      : this.getSlotAfterMinutes(5);

    this.resetBuilder();
    const tx = await this.mesh
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .spendingPlutusScriptV3()
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
        0,
      )
      .txInScript(this.getCrowdfundSpendCbor())
      .txInInlineDatumPresent()
      .txInRedeemerValue(
        this.buildSpendRedeemer(CrowdfundGovRedeemerTag.VoteOnGovAction),
      )
      .txOut(this.ensureCrowdfundAddress(), authTokenUtxo.output.amount)
      .txOutInlineDatumValue(votedDatum, "Mesh")
      .votePlutusScriptV3()
      .vote(
        { type: "DRep", drepId },
        {
          txHash: govActionId.transaction,
          txIndex: govActionId.proposal_procedure,
        },
        { voteKind },
      )
      .voteScript(this.getStakeVoteCbor())
      .voteRedeemerValue("")
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .invalidHereafter(Number(slot))
      .complete();

      const evaluateTx = await this.mesh.evaluator?.evaluateTx(tx);
    console.log("evaluateTx:", evaluateTx);


    return { tx, govActionId };
  };

  deregisterGovAction = async ({ datum }: DeregisterGovActionArgs) => {
    const { utxos, collateral } = await this.ensureWalletInfo();
    const authTokenUtxo = await this.fetchCrowdfundUtxo();
    const refundTotal =
      this.governance.stakeRegisterDeposit +
      this.governance.drepRegisterDeposit +
      this.governance.govDeposit;

    const refundedValue = adjustLovelace(
      authTokenUtxo.output.amount,
      BigInt(refundTotal),
    );

    // Use datum from DB - handle both VotedDatumTS and CrowdfundDatumTS
    const datumAny = datum as any;
    const stakeScript = datumAny.stake_script;
    const shareToken = datumAny.share_token;
    const fundsControlled = BigInt(datumAny.funds_controlled ?? datumAny.current_fundraised_amount);

    const refundableDatum = this.buildRefundableDatum(
      stakeScript,
      shareToken,
      fundsControlled,
    );

    const drepId = this.getDrepId();
    const rewardAddress = this.getGovernanceRewardAddress();
    const slot = env.NEXT_PUBLIC_GOV_TESTNET
      ? await this.getSlotAfterMinutesAsync(10)
      : this.getSlotAfterMinutes(10);

    this.resetBuilder();
    const tx = await this.mesh
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .spendingPlutusScriptV3()
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
        0,
      )
      .txInScript(this.getCrowdfundSpendCbor())
      .txInInlineDatumPresent()
      .txInRedeemerValue(
        this.buildSpendRedeemer(CrowdfundGovRedeemerTag.DeregisterCerts),
      )
      .txOut(this.ensureCrowdfundAddress(), refundedValue)
      .txOutInlineDatumValue(refundableDatum, "Mesh")
      .drepDeregistrationCertificate(
        drepId,
        this.governance.drepRegisterDeposit.toString(),
      )
      .certificateScript(this.getStakePublishCbor(), "V3")
      .certificateRedeemerValue(mConStr0([]))
      .deregisterStakeCertificate(rewardAddress as string)
      .certificateScript(this.getStakePublishCbor(), "V3")
      .certificateRedeemerValue(mConStr0([]))
      .changeAddress(this.ensureCrowdfundAddress())
      .selectUtxosFrom(utxos)
      .invalidHereafter(Number(slot))
      .complete();

    return { tx };
  };

  withdrawAfterGovernance = async ({
    datum,
    withdrawAmount,
  }: PostGovernanceWithdrawalArgs) => {
    if (withdrawAmount <= 0) {
      throw new Error("withdrawAmount must be greater than zero");
    }

    const { utxos, collateral, walletAddress } = await this.ensureWalletInfo();
    const authTokenUtxo = await this.fetchCrowdfundUtxo();

    // Use datum from DB - handle both RefundableDatumTS and CrowdfundDatumTS
    const datumAny = datum as any;
    const stakeScript = datumAny.stake_script;
    const shareToken = datumAny.share_token;
    const fundsControlled = BigInt(datumAny.funds_controlled ?? datumAny.current_fundraised_amount);

    if (BigInt(withdrawAmount) > fundsControlled) {
      throw new Error("withdrawAmount exceeds available refundable balance");
    }

    const withdrawBigInt = BigInt(withdrawAmount);

    const newValue = adjustLovelace(
      authTokenUtxo.output.amount,
      -withdrawBigInt,
    );

    const updatedDatum = this.buildRefundableDatum(
      stakeScript,
      shareToken,
      fundsControlled - withdrawBigInt,
    );

    const slot = env.NEXT_PUBLIC_GOV_TESTNET
      ? await this.getSlotAfterMinutesAsync(5)
      : this.getSlotAfterMinutes(5);

    this.resetBuilder();
    const tx = await this.mesh
      .spendingPlutusScriptV3()
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
        0,
      )
      .txInScript(this.getCrowdfundSpendCbor())
      .txInInlineDatumPresent()
      .txInRedeemerValue(
        this.buildSpendRedeemer(CrowdfundGovRedeemerTag.ContributorWithdrawal),
      )
      .mintPlutusScriptV3()
      .mint(
        (-withdrawBigInt).toString(),
        shareToken || this.getShareTokenPolicyId(),
        "",
      )
      .mintingScript(this.getShareTokenCbor())
      .mintRedeemerValue(this.buildMintRedeemer(MintPolarityTag.Burn))
      .txOut(this.ensureCrowdfundAddress(), newValue)
      .txOutInlineDatumValue(updatedDatum, "Mesh")
      .txOut(walletAddress, [
        { unit: "lovelace", quantity: withdrawBigInt.toString() },
      ])
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .invalidHereafter(Number(slot))
      .complete();

    return { tx };
  };
}
