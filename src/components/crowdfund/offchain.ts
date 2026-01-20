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
  mCredential,
  mNone,
  mSome,
  mOutputReference,
  mPubKeyAddress,
  mScriptAddress,
  list,
  resolveSlotNo,
  stringToHex,
} from "@meshsdk/common";
import {
  TxParser,
  UTxO,
  applyParamsToScript,
  deserializeAddress,
  resolveScriptHash,
  resolveScriptHashDRepId,
  serializeData,
  serializePlutusScript,
} from "@meshsdk/core";
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
  private govActionType?: 'InfoAction' | 'TreasuryWithdrawalsAction';
  private treasuryBeneficiaries?: TreasuryBeneficiary[];

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

  setParamUtxo = (paramUtxo: UTxO) => {
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
  setparamUtxo = (paramUtxo: UTxO) => {
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
      const decoded = deserializeAddress(address);
      if (decoded?.scriptHash) {
        return { hash: decoded.scriptHash, isScript: true };
      }
      if (decoded?.pubKeyHash) {
        return { hash: decoded.pubKeyHash, isScript: false };
      }
      throw new Error("Address does not contain a payment credential");
    } catch (error) {
      throw new Error(
        `Invalid payment address for treasury beneficiary: ${address}. ` +
          `Expected a payment address (addr/addr_test).`,
      );
    }
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
    const governanceAction = this.governance.governanceAction;
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
        const credential = mCredential(credentialHashHex, isScriptCredential);

        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/18581f75-925e-4598-bb51-86be65d552be',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offchain.ts:421',message:'mCredential result',data:{index,credentialHashHex,isScriptCredential,credentialType:typeof credential,credentialAlternative:credential?.alternative,credentialFields:credential?.fields,credentialFieldsTypes:credential?.fields?.map((f:any)=>typeof f),hasUndefined:credential?.fields?.some((f:any)=>f===undefined)},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
        // #endregion
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
        // #region agent log
        fetch('http://127.0.0.1:7243/ingest/18581f75-925e-4598-bb51-86be65d552be',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offchain.ts:467',message:'Pair structure created',data:{index,credential:credential?JSON.stringify(credential):null,amountBigInt:amountBigInt?.toString(),pairFields:pair?.fields?.map((f:any)=>typeof f),pairAlternative:pair?.alternative},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'E'})}).catch(()=>{});
        // #endregion
        console.log(`[getGovActionParam] Withdrawal ${index} pair structure:`, pair);
        
        return pair;
      });
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/18581f75-925e-4598-bb51-86be65d552be',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offchain.ts:473',message:'beneficiaryPairs before list()',data:{count:beneficiaryPairs.length,pairs:beneficiaryPairs.map((p:any,i:number)=>({index:i,alternative:p?.alternative,fieldsCount:p?.fields?.length,field0Type:typeof p?.fields?.[0],field1Type:typeof p?.fields?.[1],field0:JSON.stringify(p?.fields?.[0]),field1:p?.fields?.[1]?.toString()}))},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      console.log(`[getGovActionParam] beneficiaryPairs count:`, beneficiaryPairs.length);
      
      // In Plutus Data, a list is represented as an array of Data values
      // We pass the array directly - applyParamsToScript will serialize it correctly
      const beneficiariesList = beneficiaryPairs;
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/18581f75-925e-4598-bb51-86be65d552be',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offchain.ts:485',message:'beneficiariesList as array',data:{isArray:Array.isArray(beneficiariesList),length:beneficiariesList?.length,firstItem:beneficiariesList?.[0]?{alternative:beneficiariesList[0].alternative,fieldsCount:beneficiariesList[0].fields?.length}:null},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'A'})}).catch(()=>{});
      // #endregion
      console.log(`[getGovActionParam] beneficiariesList:`, beneficiariesList);
      
      // Guardrails: None for now (can be enhanced later if policyHash is provided)
      const guardrailsOption = mNone();
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/18581f75-925e-4598-bb51-86be65d552be',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offchain.ts:491',message:'guardrailsOption created',data:{alternative:guardrailsOption?.alternative,fieldsCount:guardrailsOption?.fields?.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run2',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      console.log(`[getGovActionParam] guardrailsOption:`, guardrailsOption);
      
      // VTreasuryWithdrawal: constructor 2 with [beneficiariesList, guardrailsOption]
      // beneficiariesList is an array of pairs, guardrailsOption is an Option
      // Return raw Data object - applyParamsToScript handles serialization
      const finalStructure = mConStr(2, [beneficiariesList as any, guardrailsOption]);
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/18581f75-925e-4598-bb51-86be65d552be',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'offchain.ts:488',message:'finalStructure created',data:{alternative:finalStructure?.alternative,fieldsCount:finalStructure?.fields?.length,field0Type:typeof finalStructure?.fields?.[0],field1Type:typeof finalStructure?.fields?.[1],field0Keys:finalStructure?.fields?.[0]?Object.keys(finalStructure.fields[0]):null,field1Keys:finalStructure?.fields?.[1]?Object.keys(finalStructure.fields[1]):null},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      console.log(`[getGovActionParam] Final structure (raw Data):`, finalStructure);
      
      return finalStructure;
    }
    
    if (this.govActionType === "InfoAction") {
      // InfoAction: NicePoll (constructor 6) with no fields
      // This must match the governanceAction passed to proposeGovAction()
      // Return raw Data object - applyParamsToScript handles serialization
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
    const govActionParam = this.getGovActionParam();
    // Serialize the Data object to CBOR bytes (hex string) since the validator expects ByteArray
    // The validator parameter gov_action is typed as ByteArray, so we need to serialize it explicitly
    const govActionParamSerialized = serializeData(govActionParam);
    
    return applyParamsToScript(compiled, [
      this.getAuthTokenPolicyId(),
      stringToHex(this.proposerKeyHash),
      govActionParamSerialized, // Pass serialized CBOR bytes instead of Data object
      this.decodePoolIdToHex(this.governance.delegatePoolId), // Decode bech32 pool ID to hex hash
      this.governance.stakeRegisterDeposit,
      this.governance.drepRegisterDeposit,
      this.governance.govDeposit,
    ]);
    
    console.log("[getCrowdfundSpendCbor] Cached CBOR computed");
    return this.cachedCrowdfundSpendCbor;
  }

  private getCrowdfundSpendHash() {
    return resolveScriptHash(this.getCrowdfundSpendCbor(), "V3");
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

  private ensureCrowdfundAddress() {
    if (!this.cachedCrowdfundAddress) {
      const stakeScriptHash = resolveScriptHash(
        this.getStakePublishCbor(),
        "V3",
      );
      const { address } = serializePlutusScript(
        { code: this.getCrowdfundSpendCbor(), version: "V3" },
        stakeScriptHash,
        this.networkId,
      );
      this.cachedCrowdfundAddress = address;
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
    return { utxos, collateral, walletAddress };
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

    this.mesh.reset();
    
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

    this.mesh.reset();
    const tx = await this.mesh
      .txIn(
        param.input.txHash,
        param.input.outputIndex,
        param.output.amount,
        param.output.address,
      )
      .mintPlutusScriptV3()
      .mint("1", this.getAuthTokenPolicyId(), "")
      .mintingScript(this.getAuthTokenCbor())
      .metadataValue(721, metadata)
      .mintRedeemerValue(this.buildMintRedeemer(MintPolarityTag.Mint))
      .txOut(crowdfundAddress, [
        { unit: this.getAuthTokenPolicyId(), quantity: "1" },
      ])
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
      .selectUtxosFrom(utxos)
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

    this.mesh.reset();
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
    const updatedDatum = this.buildCrowdfundDatum(
      {
        ...datum,
        current_fundraised_amount:
          (datum.current_fundraised_amount || 0) + contributionAmount,
      },
      datum.share_token || this.getShareTokenPolicyId(),
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

    this.mesh.reset();
    const tx = await this.mesh
      .spendingPlutusScriptV3()
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
      )
      .txInScript(this.getCrowdfundSpendCbor())
      .txInInlineDatumPresent()
      .spendingTxInReference(refSpendUtxo, refSpendOutputIndex)
      .txInRedeemerValue(
        this.buildSpendRedeemer(CrowdfundGovRedeemerTag.ContributeFund),
      )
      .mintPlutusScriptV3()
      .mint(
        contributionAmount.toString(),
        datum.share_token || this.getShareTokenPolicyId(),
        "",
      )
      .mintingScript(this.getShareTokenCbor())
      .mintRedeemerValue(this.buildMintRedeemer(MintPolarityTag.Mint))
      .txOut(this.ensureCrowdfundAddress(), newScriptValue)
      .txOutInlineDatumValue(updatedDatum, "Mesh")
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .invalidHereafter(Number(slot))
      .setFee('1700000')
      .complete();

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
      datum.share_token || this.getShareTokenPolicyId(),
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

    this.mesh.reset();
    const tx = await this.mesh
      .spendingPlutusScriptV3()
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
      )
      .spendingTxInReference(refSpendUtxo, refSpendOutputIndex)
      .txInInlineDatumPresent()
      .txInRedeemerValue(
        this.buildSpendRedeemer(CrowdfundGovRedeemerTag.ContributorWithdrawal),
      )
      .mintPlutusScriptV3()
      .mint(
        (-withdrawAmount).toString(),
        datum.share_token || this.getShareTokenPolicyId(),
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
      .selectUtxosFrom(utxos)
      .invalidHereafter(Number(slot))
      .setFee('1700000')
      .complete();

    return { tx };
  };

  registerCerts = async ({
    datum,
    anchorDrep,
  }: {
    datum: CrowdfundDatumTS;
    anchorDrep?: GovernanceAnchor;
  }) => {
    const {
      utxos: allUtxos,
      collateral,
      walletAddress,
    } = await this.ensureWalletInfo();

    // Calculate required ADA for certificate deposits only (no gov deposit)
    const certDeposits =
      this.governance.stakeRegisterDeposit +
      this.governance.drepRegisterDeposit;
    const requiredAda = BigInt(certDeposits + 15_000_000); // ~15 ADA for fees

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

    // Select UTxOs until we have enough ADA, but limit to max 10 inputs
    const selectedUtxos = [];
    let totalAda = 0n;

    for (const utxo of sortedUtxos) {
      if (selectedUtxos.length >= 10) break;

      selectedUtxos.push(utxo);
      totalAda += utxo.adaAmount;

      if (totalAda >= requiredAda && selectedUtxos.length >= 3) {
        break;
      }
    }

    if (totalAda < requiredAda) {
      console.warn(
        `[registerCerts] Warning: Selected UTxOs may not have enough ADA. Required: ${requiredAda.toString()}, Available: ${totalAda.toString()}`,
      );
    }

    const utxos = selectedUtxos;
    const authTokenUtxo = await this.fetchCrowdfundUtxo();

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
    console.log("outputDatum:", outputDatum);

    console.log(utxos);
    // Build transaction matching validator structure (lines 231-286)
    this.mesh.reset();
    const tx = await this.mesh
      .spendingPlutusScriptV3()
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
      )
      .txInInlineDatumPresent()
      .spendingTxInReference(refSpendUtxo, refSpendOutputIndex) //Spend reference script for better perfomance
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
        this.getStakePublishHash(),
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
        this.getStakePublishHash(),
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
        this.getStakePublishHash(),
        "V3",
      )
      .certificateRedeemerValue(
        mConStr(0, []), //PublishRedeemer.Register
        undefined,
        { mem: 200000, steps: 200000000 },
      )
      // RegisterCerts only registers certificates and keeps the Crowdfund state
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .txOut(walletAddress, [{ unit: "lovelace", quantity: "5000000" }])
      .requiredSignerHash(this.proposerKeyHash)
      .selectUtxosFrom(utxos)
      .changeAddress(walletAddress)
      .invalidHereafter(Number(slot));

    console.log("tx:", tx);

    //await tx.evaluateRedeemers();
    const completeTx = await tx.complete();
    console.log("completeTx:", completeTx);
    const provider = getProvider(this.networkId);
    const evaluateTx = await provider.evaluateTx(completeTx);
    console.log("evaluateTx:", evaluateTx);

    return { tx: completeTx };
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
    const proposalAction = governanceAction ||
      this.governance.governanceAction || {
        kind: "InfoAction",
        action: {},
      };

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

    this.mesh.reset();
    const tx = await this.mesh
      .spendingPlutusScriptV3()
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
      )
      .txInInlineDatumPresent()
      .spendingTxInReference(refSpendUtxo, refSpendOutputIndex)
      .txInRedeemerValue(
        this.buildSpendRedeemer(CrowdfundGovRedeemerTag.ProposeGovAction),
      )
      .txOut(this.ensureCrowdfundAddress(), updatedValue)
      .txOutInlineDatumValue(proposedDatum, "Mesh")
      //adds governance proposal to the transaction
      // proposalAction is already a proper GovernanceAction type from MeshJS

      .proposal(
        proposalAction,
        {
          anchorUrl: govAnchor.url,
          anchorDataHash: govAnchor.hash,
        } as Anchor,
        rewardAddress,
      )
      // .proposalTxInReference(
      //   refStakeUtxo,
      //   refStakeOutputIndex,
      //   refStakeCborLength,
      //   this.getStakePublishHash(),
      //   "V3",
      // )
      // .proposalRedeemerValue(
      //   mConStr(0, []),
      // )
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

    this.mesh.reset();
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

    this.mesh.reset();
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

    this.mesh.reset();
    const tx = await this.mesh
      .spendingPlutusScriptV3()
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
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
