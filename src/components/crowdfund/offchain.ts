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
  OfflineFetcher,
  UTxO,
  applyParamsToScript,
  resolveScriptHash,
  resolveScriptHashDRepId,
  serializePlutusScript,
} from "@meshsdk/core";
import { resolveTxHash, scriptHashToRewardAddress } from "@meshsdk/core-cst";

import blueprint from "./gov-crowdfundV2/plutus.json";
import {
  CrowdfundDatumTS,
  RegisteredCertsDatumTS,
  ProposedDatumTS,
  VotedDatumTS,
  RefundableDatumTS,
  GovernanceActionIdTS,
} from "./crowdfund";
import { MeshTxInitiator, MeshTxInitiatorInput } from "./common";
import { env } from "@/env";

// Import Sancho slot resolver
import { resolveSlotNoSancho } from "./test_sancho_utils";
import { OfflineEvaluator } from "@meshsdk/core-csl";

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
}

interface RegisterCertsArgs {
  datum: CrowdfundDatumTS;
  anchorDrep?: GovernanceAnchor;
}

interface ProposeGovActionArgs {
  datum: RegisteredCertsDatumTS;
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
  CompleteCrowdfund = 1,
  PreMatureContributorWithdrawal = 2,
  PreMatureRemoveEmptyInstance = 3,
  RegisterCerts = 4,
  ProposeGovAction = 5,
  VoteOnGovAction = 6,
  DeregisterCerts = 7,
  AfterCompleteContributorWithdrawal = 8,
  AfterCompleteRemoveEmptyInstance = 9,
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
  private readonly governance: GovernanceConfig;
  private paramUtxo?: UTxO | { txHash: string; outputIndex: number };
  private cachedCrowdfundAddress?: string;
  private cachedGovActionParam?: ReturnType<typeof mConStr>;
  private ref_spend_txhash?: string; // Reference script transaction hash
  private ref_spend_outputIndex?: number; // Reference script output index
  private ref_stake_txhash?: string; // Stake reference script transaction hash
  private ref_stake_outputIndex?: number; // Stake reference script output index
  private refAddress?: string; // Address where reference scripts are stored

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
    if (contract.spendRefScript) {
      this.ref_spend_txhash = contract.spendRefScript.txHash;
      this.ref_spend_outputIndex = contract.spendRefScript.outputIndex;
      console.log(
        "[MeshCrowdfundContract constructor] Set spend reference script:",
        {
          txHash: this.ref_spend_txhash,
          outputIndex: this.ref_spend_outputIndex,
          spendRefScript: contract.spendRefScript,
        },
      );
    } else {
      console.warn(
        "[MeshCrowdfundContract constructor] No spendRefScript provided. Reference script will not be available.",
      );
    }
    if (contract.stakeRefScript) {
      this.ref_stake_txhash = contract.stakeRefScript.txHash;
      this.ref_stake_outputIndex = contract.stakeRefScript.outputIndex;
      console.log(
        "[MeshCrowdfundContract constructor] Set stake reference script:",
        {
          txHash: this.ref_stake_txhash,
          outputIndex: this.ref_stake_outputIndex,
        },
      );
    }
    if (contract.refAddress) {
      this.refAddress = contract.refAddress;
      console.log(
        "[MeshCrowdfundContract constructor] Set reference address:",
        this.refAddress,
      );
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
    return resolveScriptHashDRepId(this.getCrowdfundSpendHash());
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

  private buildRegisteredCertsDatum(
    datum: CrowdfundDatumTS,
    fundsControlled: bigint,
  ) {
    return mConStr1([
      datum.stake_script || this.getStakePublishHash(),
      datum.share_token || this.getShareTokenPolicyId(),
      fundsControlled,
      datum.deadline ?? 0,
    ]);
  }

  private buildProposedDatum(
    datum: RegisteredCertsDatumTS,
    fundsControlled: bigint,
  ) {
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
   * Create a simple hash for URL shortening fallback
   */
  private async createSimpleHash(url: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(url);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return hashHex.slice(0, 8); // Use first 8 characters
  }

  /**
   * Shorten a URL if it exceeds Cardano's 64-character limit for governance anchors
   */
  private async shortenUrlIfNeeded(
    url: string,
    context: string,
  ): Promise<string> {
    console.log(`[${context}] Checking URL length: ${url.length} chars`);

    if (url.length <= 64) {
      console.log(
        `[${context}] URL is within 64 char limit, no shortening needed`,
      );
      return url;
    }

    console.log(
      `[${context}] URL too long (${url.length} chars), attempting to shorten...`,
    );
    console.log(`[${context}] Original URL: ${url}`);

    // Try API-based shortening first
    try {
      const response = await fetch("/api/shorten-url", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      });

      console.log(
        `[${context}] Shortener API response status: ${response.status}`,
      );

      if (response.ok) {
        const result = await response.json();
        console.log(`[${context}] Shortener API result:`, result);

        const shortUrl = `https://${result.shortUrl}`;
        console.log(
          `[${context}] URL shortened from ${url.length} to ${shortUrl.length} chars`,
        );
        console.log(`[${context}] Shortened URL: ${shortUrl}`);

        if (shortUrl.length <= 64) {
          return shortUrl;
        } else {
          console.error(
            `[${context}] WARNING: Shortened URL is still too long! (${shortUrl.length} chars)`,
          );
        }
      } else {
        const errorText = await response.text();
        console.error(
          `[${context}] Failed to shorten URL (${response.status}): ${errorText}`,
        );
      }
    } catch (error) {
      console.error(`[${context}] URL shortening service failed:`, error);
    }

    // Fallback: Use a simple approach - just use the hash part of the URL
    console.log(
      `[${context}] Using fallback approach: extracting meaningful part of URL...`,
    );

    try {
      // For Vercel blob URLs, try to extract just the essential part
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split("/");
      const filename = pathParts[pathParts.length - 1];

      if (filename && filename.length > 0) {
        // Create a short URL using just the domain and filename
        const shortUrl = `${urlObj.protocol}//${urlObj.hostname}/${filename}`;

        if (shortUrl.length <= 64) {
          console.log(
            `[${context}] Created short URL from filename: ${shortUrl} (${shortUrl.length} chars)`,
          );
          return shortUrl;
        }

        // If still too long, use just the hash of the filename
        const hash = await this.createSimpleHash(filename);
        const hashUrl = `${urlObj.protocol}//${urlObj.hostname}/${hash}.json`;

        if (hashUrl.length <= 64) {
          console.log(
            `[${context}] Created hash-based URL: ${hashUrl} (${hashUrl.length} chars)`,
          );
          return hashUrl;
        }
      }

      // Last resort: create a minimal URL
      const hash = await this.createSimpleHash(url);
      const minimalUrl = `https://s.co/${hash}`;

      if (minimalUrl.length <= 64) {
        console.log(
          `[${context}] Created minimal URL: ${minimalUrl} (${minimalUrl.length} chars)`,
        );
        console.warn(
          `[${context}] WARNING: Using placeholder domain 's.co' - this URL may not resolve!`,
        );
        return minimalUrl;
      }
    } catch (fallbackError) {
      console.error(`[${context}] Fallback shortening failed:`, fallbackError);
    }

    throw new Error(
      `Unable to create URL under 64 characters. Original URL (${url.length} chars) exceeds Cardano governance anchor limit. Consider using a shorter domain or file naming scheme.`,
    );
  }

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

    const refAddress = this.getRefAddress();
    if (!refAddress) {
      throw new Error("Reference address not set");
    }

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
      // Reference script for spend validator attached to output 1
      // After transaction submission, store txHash with setRefSpendTxHash(txHash, 1)
      .txOut(refAddress, [{ unit: "lovelace", quantity: "60000000" }])
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
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
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
   * Register certificates: Transition from Crowdfund → RegisteredCerts
   * Locks stake_register_deposit + drep_register_deposit
   */
  registerCerts = async ({ datum, anchorDrep }: RegisterCertsArgs) => {
    console.log("[registerCerts] Starting certificate registration");
    console.log("[registerCerts] Input parameters:", {
      datum: datum ? "present" : "missing",
      anchorDrep: anchorDrep ? "present" : "missing",
    });

    const {
      utxos: allUtxos,
      collateral,
      walletAddress,
    } = await this.ensureWalletInfo();

    // Optimize UTxO selection to avoid "Maximum Input Count Exceeded" error
    // Calculate required ADA for deposits and fees (estimate ~10 ADA for fees)
    const requiredAda = BigInt(
      this.governance.stakeRegisterDeposit +
        this.governance.drepRegisterDeposit +
        10_000_000, // ~10 ADA for fees
    );

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

    // Select UTxOs until we have enough ADA, but limit to max 10 inputs to be more conservative
    const selectedUtxos = [];
    let totalAda = 0n;

    for (const utxo of sortedUtxos) {
      if (selectedUtxos.length >= 10) break; // More conservative limit to prevent input count error

      selectedUtxos.push(utxo);
      totalAda += utxo.adaAmount;

      // If we have enough ADA and at least 3 UTxOs, we can stop early
      if (totalAda >= requiredAda && selectedUtxos.length >= 3) {
        break;
      }
    }

    console.log("[registerCerts] UTxO optimization:", {
      totalUtxos: allUtxos.length,
      selectedUtxos: selectedUtxos.length,
      totalAda: totalAda.toString(),
      requiredAda: requiredAda.toString(),
      sufficient: totalAda >= requiredAda,
      selectedUtxoDetails: selectedUtxos.map((u) => ({
        txHash: u.input.txHash.substring(0, 8) + "...",
        ada: u.adaAmount.toString(),
      })),
    });

    if (totalAda < requiredAda) {
      console.warn(
        `[registerCerts] Warning: Selected UTxOs may not have enough ADA. Required: ${requiredAda.toString()}, Available: ${totalAda.toString()}`,
      );
    }

    const utxos = selectedUtxos;
    console.log("[registerCerts] Wallet info:", {
      utxosCount: utxos.length,
      collateralPresent: !!collateral,
    });

    const authTokenUtxo = await this.fetchCrowdfundUtxo();
    console.log("[registerCerts] Auth token UTXO:", {
      txHash: authTokenUtxo.input.txHash,
      outputIndex: authTokenUtxo.input.outputIndex,
      lovelaceAmount: lovelaceOf(authTokenUtxo.output.amount),
    });

    const depositTotal =
      this.governance.stakeRegisterDeposit +
      this.governance.drepRegisterDeposit;
    console.log("[registerCerts] Deposit calculations:", {
      stakeRegisterDeposit: this.governance.stakeRegisterDeposit,
      drepRegisterDeposit: this.governance.drepRegisterDeposit,
      depositTotal,
    });

    // Verify crowdfund has sufficient funds for deposits
    const crowdfundLovelace = lovelaceOf(authTokenUtxo.output.amount);
    const requiredLovelace = BigInt(depositTotal);

    if (crowdfundLovelace < requiredLovelace) {
      throw new Error(
        `Insufficient crowdfund balance. Required: ${requiredLovelace.toString()}, Available: ${crowdfundLovelace.toString()}`,
      );
    }

    console.log("[registerCerts] Crowdfund funding verification:", {
      available: crowdfundLovelace.toString(),
      required: requiredLovelace.toString(),
      sufficient: crowdfundLovelace >= requiredLovelace,
    });

    const updatedValue = adjustLovelace(
      authTokenUtxo.output.amount,
      -BigInt(depositTotal),
    );
    const fundsControlled = lovelaceOf(authTokenUtxo.output.amount);
    const registeredCertsDatum = this.buildRegisteredCertsDatum(
      datum,
      fundsControlled,
    );
    const slot = this.getSlotAfterMinutes(10);
    const drepId = this.getDrepId();
    const rewardAddress = this.getGovernanceRewardAddress();

    // Validate pool ID format
    if (
      !this.governance.delegatePoolId ||
      this.governance.delegatePoolId.length < 56
    ) {
      throw new Error(
        `Invalid pool ID format. Expected 56+ characters, got ${this.governance.delegatePoolId?.length || 0}. Pool ID: "${this.governance.delegatePoolId}"`,
      );
    }

    console.log("[registerCerts] Generated values:", {
      slot,
      drepId,
      rewardAddress,
      fundsControlled,
      delegatePoolId: this.governance.delegatePoolId,
      delegatePoolIdLength: this.governance.delegatePoolId?.length,
    });

    let drepAnchorResolved = ensureAnchorOptional(
      "drep",
      anchorDrep,
      this.governance.anchorDrep,
    );
    console.log(
      "[registerCerts] DRep anchor resolved (before shortening):",
      drepAnchorResolved ? "present" : "missing",
    );

    // Shorten DRep anchor URL if it exists and needs shortening
    if (drepAnchorResolved) {
      drepAnchorResolved = {
        ...drepAnchorResolved,
        url: await this.shortenUrlIfNeeded(
          drepAnchorResolved.url,
          "registerCerts:drep",
        ),
      };
    }

    console.log(
      "[registerCerts] Final DRep anchor:",
      drepAnchorResolved ? "present" : "missing",
    );

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

    console.log(this.getCrowdfundSpendCbor());
    console.log(this.getStakePublishCbor());


    const refSpendCborLength = (
      this.getCrowdfundSpendCbor().length / 2
    ).toString();
    const refStakeCborLength = (
      this.getStakePublishCbor().length / 2
    ).toString();

    this.mesh.reset();
    // Build transaction step by step to handle optional DRep registration
    let txBuilder = this.mesh
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
        this.buildSpendRedeemer(CrowdfundGovRedeemerTag.RegisterCerts),
      )
      .txOut(this.ensureCrowdfundAddress(), updatedValue)
      .txOutInlineDatumValue(registeredCertsDatum, "Mesh");

    // Conditionally add DRep registration certificate only if anchor is provided
    if (
      drepAnchorResolved &&
      drepAnchorResolved.url &&
      drepAnchorResolved.hash
    ) {
      txBuilder = txBuilder
        //adds drep registration certificate to the transaction
        .drepRegistrationCertificate(drepId, {
          anchorUrl: drepAnchorResolved.url,
          anchorDataHash: drepAnchorResolved.hash,
        })
        .certificateTxInReference(
          refSpendUtxo,
          refSpendOutputIndex,
          refSpendCborLength,
          this.getCrowdfundSpendHash(),
          "V3",
        )
        .certificateRedeemerValue(
          this.buildSpendRedeemer(CrowdfundGovRedeemerTag.RegisterCerts),
        )
        //adds vote delegation certificate to the transaction
        .voteDelegationCertificate({ dRepId: drepId }, rewardAddress)
        .certificateTxInReference(
          refSpendUtxo,
          refSpendOutputIndex,
          refSpendCborLength,
          this.getCrowdfundSpendHash(),
          "V3",
        )
        .certificateRedeemerValue(
          mConStr(CrowdfundGovRedeemerTag.RegisterCerts, []),
        );
    }
    const tx = await txBuilder
      //adds stake registration certificate to the transaction
      .registerStakeCertificate(rewardAddress as string)
      .certificateTxInReference(
        refStakeUtxo,
        refStakeOutputIndex,
        refStakeCborLength,
        this.getStakePublishHash(),
        "V3",
      )
      .certificateRedeemerValue(
        mConStr(CrowdfundGovRedeemerTag.RegisterCerts, []),
      )
      //adds stake delegation certificate to the transaction
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
        mConStr(CrowdfundGovRedeemerTag.RegisterCerts, []),
      )
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .selectUtxosFrom(utxos)
      .changeAddress(walletAddress)
      .invalidHereafter(Number(slot))
      .complete();

    console.log("[registerCerts] Transaction built successfully");

    return { tx };
  };

  /**
   * Propose governance action: Transition from RegisteredCerts → Proposed
   * Locks gov_deposit
   */
  proposeGovAction = async ({
    datum,
    anchorGovAction,
    governanceAction,
  }: ProposeGovActionArgs) => {
    console.log("[proposeGovAction] Starting governance proposal");
    console.log("[proposeGovAction] Input parameters:", {
      datum: datum ? "present" : "missing",
      anchorGovAction: anchorGovAction ? "present" : "missing",
      governanceAction: governanceAction ? "present" : "missing",
    });

    const { utxos, collateral, walletAddress } = await this.ensureWalletInfo();

    const authTokenUtxo = await this.fetchCrowdfundUtxo();
    console.log("[proposeGovAction] Auth token UTXO:", {
      txHash: authTokenUtxo.input.txHash,
      outputIndex: authTokenUtxo.input.outputIndex,
      lovelaceAmount: lovelaceOf(authTokenUtxo.output.amount),
    });

    const govDeposit = this.governance.govDeposit;
    console.log("[proposeGovAction] Deposit calculations:", {
      govDeposit,
    });

    // Verify crowdfund has sufficient funds for deposit
    const crowdfundLovelace = lovelaceOf(authTokenUtxo.output.amount);
    const requiredLovelace = BigInt(govDeposit);

    if (crowdfundLovelace < requiredLovelace) {
      throw new Error(
        `Insufficient crowdfund balance. Required: ${requiredLovelace.toString()}, Available: ${crowdfundLovelace.toString()}`,
      );
    }

    console.log("[proposeGovAction] Crowdfund funding verification:", {
      available: crowdfundLovelace.toString(),
      required: requiredLovelace.toString(),
      sufficient: crowdfundLovelace >= requiredLovelace,
    });

    const updatedValue = adjustLovelace(
      authTokenUtxo.output.amount,
      -BigInt(govDeposit),
    );
    const fundsControlled = lovelaceOf(authTokenUtxo.output.amount);
    const proposedDatum = this.buildProposedDatum(datum, fundsControlled);
    const slot = this.getSlotAfterMinutes(10);
    const rewardAddress = this.getGovernanceRewardAddress();

    console.log("[proposeGovAction] Generated values:", {
      slot,
      rewardAddress,
      fundsControlled,
    });

    let govAnchor = ensureAnchor(
      "governance",
      anchorGovAction,
      this.governance.anchorGovAction,
    );
    console.log(
      "[proposeGovAction] Governance anchor (before shortening):",
      govAnchor,
    );

    // Shorten governance anchor URL if needed
    govAnchor = {
      ...govAnchor,
      url: await this.shortenUrlIfNeeded(
        govAnchor.url,
        "proposeGovAction:governance",
      ),
    };

    console.log("[proposeGovAction] Final governance anchor:", govAnchor);

    const proposalAction = governanceAction ||
      this.governance.governanceAction || {
        kind: "InfoAction",
        action: {},
      };

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
      .proposal(
        proposalAction,
        {
          anchorUrl: govAnchor.url,
          anchorDataHash: govAnchor.hash,
        },
        rewardAddress,
      )
      .proposalTxInReference(
        refStakeUtxo,
        refStakeOutputIndex,
        refStakeCborLength,
        this.getStakePublishHash(),
        "V3",
      )
      .proposalRedeemerValue(
        mConStr(CrowdfundGovRedeemerTag.ProposeGovAction, []),
      )
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .selectUtxosFrom(utxos)
      .changeAddress(walletAddress)
      .invalidHereafter(Number(slot))
      .complete();

    console.log("[proposeGovAction] Transaction built successfully");

    return { tx };
  };

  /**
   * @deprecated Use registerCerts + proposeGovAction instead
   * This method is kept for backward compatibility but should be split into separate calls.
   * Note: This method only builds the transaction for registerCerts. You must call proposeGovAction
   * separately after submitting the registerCerts transaction.
   */
  registerGovAction = async ({
    datum,
    anchorGovAction,
    anchorDrep,
    governanceAction,
  }: RegisterGovActionArgs) => {
    console.warn(
      "[registerGovAction] DEPRECATED: This method only builds registerCerts transaction. Use registerCerts + proposeGovAction separately.",
    );
    // Only return registerCerts transaction - user must call proposeGovAction separately
    return await this.registerCerts({ datum, anchorDrep });
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
