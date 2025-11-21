import {
  GovernanceAction,
  RewardAddress,
  mBool,
  mConStr,
  mConStr0,
  mConStr1,
  mConStr2,
  mConStr3,
  mOutputReference,
  mPubKeyAddress,
  resolveSlotNo,
  stringToHex,
} from "@meshsdk/common";
import {
  UTxO,
  applyParamsToScript,
  resolveScriptHash,
  resolveScriptHashDRepId,
  serializePlutusScript,
} from "@meshsdk/core";
import { scriptHashToRewardAddress } from "@meshsdk/core-cst";

import blueprint from "./gov-crowdfundV2/plutus.json";
import {
  CrowdfundDatumTS,
  ProposedDatumTS,
  VotedDatumTS,
  RefundableDatumTS,
  GovernanceActionIdTS,
} from "./crowdfund";
import { MeshTxInitiator, MeshTxInitiatorInput } from "./common";
import { env } from "@/env";

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
  CompleteCrowdfund = 1,
  PreMatureContributorWithdrawal = 2,
  PreMatureRemoveEmptyInstance = 3,
  RegisterCerts = 4,
  VoteOnGovAction = 5,
  DeregisterCerts = 6,
  AfterCompleteContributorWithdrawal = 7,
  AfterCompleteRemoveEmptyInstance = 8,
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

export class MeshCrowdfundContract extends MeshTxInitiator {
  private readonly proposerKeyHash: string;
  private readonly governance: GovernanceConfig;
  private paramUtxo?: UTxO | { txHash: string; outputIndex: number };
  private cachedCrowdfundAddress?: string;
  private cachedGovActionParam?: ReturnType<typeof mConStr>;

  constructor(
    inputs: MeshTxInitiatorInput,
    contract: MeshCrowdfundContractConfig,
  ) {
    super(inputs);
    this.proposerKeyHash = contract.proposerKeyHash;
    this.governance = contract.governance;
    if (contract.paramUtxo) {
      this.paramUtxo = contract.paramUtxo;
    }
  }

  setParamUtxo = (paramUtxo: UTxO) => {
    this.paramUtxo = paramUtxo;
    this.cachedCrowdfundAddress = undefined;
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

  private getGovActionParam() {
    if (!this.cachedGovActionParam) {
      // TODO: allow richer governance action encoding once UI supports it.
      this.cachedGovActionParam = mConStr(6, []);
    }
    return this.cachedGovActionParam;
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

  private getCrowdfundSpendCbor() {
    const compiled = findValidator(VALIDATOR_TITLES.SPEND);
    return applyParamsToScript(compiled, [
      this.getAuthTokenPolicyId(),
      stringToHex(this.proposerKeyHash),
      this.getGovActionParam(),
      stringToHex(this.governance.delegatePoolId),
      this.governance.stakeRegisterDeposit,
      this.governance.drepRegisterDeposit,
      this.governance.govDeposit,
    ]);
  }

  private getCrowdfundSpendHash() {
    return resolveScriptHash(this.getCrowdfundSpendCbor(), "V3");
  }

  private getStakeScriptCbor(entry: keyof typeof VALIDATOR_TITLES) {
    const compiled = findValidator(VALIDATOR_TITLES[entry]);
    return applyParamsToScript(compiled, [
      this.getAuthTokenPolicyId(),
      this.getCrowdfundSpendCbor(),
      this.governance.govActionPeriod,
    ]);
  }

  private getStakePublishCbor() {
    return this.getStakeScriptCbor("STAKE_PUBLISH");
  }

  private getStakePublishHash() {
    return resolveScriptHash(this.getStakePublishCbor(), "V3");
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
    return scriptHashToRewardAddress(
      this.getStakePublishHash(),
      this.networkId,
    );
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
    const govActionIdData = mConStr0([
      govActionId.transaction,
      govActionId.proposal_procedure,
    ]);

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
   * Deploys a new crowdfund by minting the auth token and locking it at the crowdfund script address.
   */
  setupCrowdfund = async (datum: CrowdfundDatumTS) => {
    const { utxos, collateral, walletAddress } = await this.ensureWalletInfo();
    if (!this.paramUtxo && utxos.length > 0) {
      this.paramUtxo = utxos[0];
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
      .mintRedeemerValue(this.buildMintRedeemer(MintPolarityTag.Mint))
      .txOut(crowdfundAddress, [
        { unit: this.getAuthTokenPolicyId(), quantity: "1" },
      ])
      .txOutInlineDatumValue(datumValue, "Mesh")
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
   * Contribute ADA to the crowdfund while minting proportional share tokens.
   */
  contributeCrowdfund = async (
    contributionAmount: number,
    datum: CrowdfundDatumTS,
  ) => {
    const { utxos, collateral, walletAddress } = await this.ensureWalletInfo();
    const authTokenUtxo = await this.fetchCrowdfundUtxo();
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
      .complete();

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

    console.log(
      `[withdrawCrowdfund] Using slot: ${slot} for transaction validity`,
    );

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
        this.buildSpendRedeemer(
          CrowdfundGovRedeemerTag.PreMatureContributorWithdrawal,
        ),
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
      .complete();

    return { tx };
  };

  /**
   * Execute the RegisterCerts flow to lock deposits, register stake/dRep
   * certificates, delegate, and submit the governance proposal.
   */
  registerGovAction = async ({
    datum,
    anchorGovAction,
    anchorDrep,
    governanceAction,
  }: RegisterGovActionArgs) => {
    const { utxos, collateral } = await this.ensureWalletInfo();
    const authTokenUtxo = await this.fetchCrowdfundUtxo();
    const depositTotal =
      this.governance.stakeRegisterDeposit +
      this.governance.drepRegisterDeposit +
      this.governance.govDeposit;
    const updatedValue = adjustLovelace(
      authTokenUtxo.output.amount,
      -BigInt(depositTotal),
    );
    const fundsControlled = lovelaceOf(authTokenUtxo.output.amount);
    const proposedDatum = this.buildProposedDatum(datum, fundsControlled);
    const slot = this.getSlotAfterMinutes(10);
    const drepId = this.getDrepId();
    const rewardAddress = this.getGovernanceRewardAddress();
    const govAnchor = ensureAnchor(
      "governance",
      anchorGovAction,
      this.governance.anchorGovAction,
    );
    const drepAnchorResolved = ensureAnchor(
      "drep",
      anchorDrep,
      this.governance.anchorDrep,
    );
    const proposalAction = governanceAction ||
      this.governance.governanceAction || {
        kind: "InfoAction",
        action: {},
      };

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
        this.buildSpendRedeemer(CrowdfundGovRedeemerTag.RegisterCerts),
      )
      .txOut(this.ensureCrowdfundAddress(), updatedValue)
      .txOutInlineDatumValue(proposedDatum, "Mesh")
      .drepRegistrationCertificate(drepId, {
        anchorUrl: drepAnchorResolved.url,
        anchorDataHash: drepAnchorResolved.hash,
      })
      .certificateScript(this.getStakePublishCbor())
      .certificateRedeemerValue(mConStr0([]))
      .voteDelegationCertificate({ dRepId: drepId }, rewardAddress)
      .certificateScript(this.getStakePublishCbor())
      .certificateRedeemerValue(mConStr0([]))
      .registerStakeCertificate(rewardAddress as string)
      .delegateStakeCertificate(
        rewardAddress as string,
        this.governance.delegatePoolId,
      )
      .certificateScript(this.getStakePublishCbor())
      .certificateRedeemerValue(mConStr0([]))
      .proposal(
        proposalAction,
        {
          anchorUrl: govAnchor.url,
          anchorDataHash: govAnchor.hash,
        },
        rewardAddress,
      )
      .changeAddress(this.ensureCrowdfundAddress())
      .selectUtxosFrom(utxos)
      .invalidHereafter(Number(slot))
      .complete();

    return { tx };
  };

  voteOnGovAction = async ({ datum, voteKind }: VoteOnGovActionArgs) => {
    const { utxos, collateral } = await this.ensureWalletInfo();
    const authTokenUtxo = await this.fetchCrowdfundUtxo();
    const drepId = this.getDrepId();
    const govActionId: GovernanceActionIdTS = {
      transaction: authTokenUtxo.input.txHash,
      proposal_procedure: 0,
    };

    const votedDatum = this.buildVotedDatum(
      datum.stake_script,
      datum.share_token,
      BigInt(datum.funds_controlled),
      govActionId,
      datum.deadline,
    );

    const slot = this.getSlotAfterMinutes(5);

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
      .changeAddress(this.ensureCrowdfundAddress())
      .selectUtxosFrom(utxos)
      .invalidHereafter(Number(slot))
      .complete();

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

    const refundableDatum = this.buildRefundableDatum(
      datum.stake_script,
      datum.share_token,
      BigInt(datum.funds_controlled),
    );

    const drepId = this.getDrepId();
    const rewardAddress = this.getGovernanceRewardAddress();
    const slot = this.getSlotAfterMinutes(10);

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
      .certificateScript(this.getStakePublishCbor())
      .certificateRedeemerValue(mConStr0([]))
      .deregisterStakeCertificate(rewardAddress as string)
      .certificateScript(this.getStakePublishCbor())
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
    if (withdrawAmount > datum.funds_controlled) {
      throw new Error("withdrawAmount exceeds available refundable balance");
    }

    const withdrawBigInt = BigInt(withdrawAmount);

    const { utxos, collateral, walletAddress } = await this.ensureWalletInfo();
    const authTokenUtxo = await this.fetchCrowdfundUtxo();

    const newValue = adjustLovelace(
      authTokenUtxo.output.amount,
      -withdrawBigInt,
    );

    const updatedDatum = this.buildRefundableDatum(
      datum.stake_script,
      datum.share_token,
      BigInt(datum.funds_controlled) - withdrawBigInt,
    );

    const slot = this.getSlotAfterMinutes(5);

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
        this.buildSpendRedeemer(
          CrowdfundGovRedeemerTag.AfterCompleteContributorWithdrawal,
        ),
      )
      .mintPlutusScriptV3()
      .mint(
        (-withdrawBigInt).toString(),
        datum.share_token || this.getShareTokenPolicyId(),
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
