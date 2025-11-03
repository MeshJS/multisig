import {
  mConStr0,
  mOutputReference,
  mPubKeyAddress,
  stringToHex,
  mBool,
  mConStr1,
  resolveSlotNo,
  keepRelevant,
  mConStr2,
  RewardAddress,
  GovernanceAction,
} from "@meshsdk/common";
import {
  resolveScriptHash,
  serializePlutusScript,
  UTxO,
  applyParamsToScript,
  resolveScriptHashDRepId,
} from "@meshsdk/core";
import { MeshTxInitiator, MeshTxInitiatorInput } from "../common";
import blueprint from "./plutus.json";
import { CrowdfundDatumTS } from "../crowdfund";
import { scriptHashToRewardAddress } from "@meshsdk/core-cst";

/**
 * Mesh Aiken Crowdfund contract class
 *
 * This script allows users to manage a simple crowdfund, which can be used to raise funds for a specific project or initiative.
 *
 * The script offers various functionalities such as creating a crowdfund, contributing to it, and withdrawing funds.
 *
 * Once setup with an AuthToken, users get shares proportional to their contributions, to manage their stake in the crowdfund.
 *
 */
export class MeshCrowdfundGovExtensionContract extends MeshTxInitiator {
  proposerKeyHash: string;
  crowdfundGovAddress?: string;
  networkId: number;

  authTokenPolicyId: string;
  gov_action_period: number;

  delegate_pool_id: string;
  gov_action: string;
  stake_register_deposit: number;
  drep_register_deposit: number;
  gov_deposit: number;

  getCrowdfundStartCbor = () => {
    return applyParamsToScript(blueprint.validators[4]!.compiledCode, [
      this.authTokenPolicyId,
      this.getCrowdfundSpendCbor(),
      this.gov_action_period,
    ]);
  };

  getCrowdfundSpendCbor = () => {
    return applyParamsToScript(blueprint.validators[0]!.compiledCode, [
      stringToHex(this.delegate_pool_id),
      stringToHex(this.gov_action),
      stringToHex(this.proposerKeyHash),
      this.stake_register_deposit,
      this.drep_register_deposit,
      this.gov_deposit,
    ]);
  };

  setCrowdfundAddress = () => {
    const crowdfundGovAddress = serializePlutusScript(
      {
        code: this.getCrowdfundSpendCbor(),
        version: "V3",
      },
      resolveScriptHash(this.getCrowdfundStartCbor(), "V3"),
      this.networkId,
      true,
    ).address;
    this.crowdfundGovAddress = crowdfundGovAddress;
    return crowdfundGovAddress;
  };

  constructor(
    inputs: MeshTxInitiatorInput,
    contract: {
      proposerKeyHash: string;
      authTokenPolicyId: string;
      gov_action_period: number;
      delegate_pool_id: string;
      gov_action: string;
      stake_register_deposit: number;
      drep_register_deposit: number;
      gov_deposit: number;
    },
  ) {
    super(inputs);
    this.proposerKeyHash = contract.proposerKeyHash;
    this.stakeCredential = inputs.stakeCredential;
    this.networkId = inputs.networkId ? inputs.networkId : 0;
    this.authTokenPolicyId = contract.authTokenPolicyId;
    this.gov_action_period = contract.gov_action_period;
    this.delegate_pool_id = contract.delegate_pool_id;
    this.gov_action = contract.gov_action;
    this.stake_register_deposit = contract.stake_register_deposit;
    this.drep_register_deposit = contract.drep_register_deposit;
    this.gov_deposit = contract.gov_deposit;

    this.setCrowdfundAddress();
  }

  registerCerts = async (
    anchorUrlGovAction?: string,
    anchorHashGovAction?: string,
    anchorUrlDrep?: string,
    anchorHashDrep?: string,
  ) => {
    if (
      !anchorUrlGovAction ||
      !anchorHashGovAction ||
      !anchorUrlDrep ||
      !anchorHashDrep
    ) {
      throw new Error("Anchor URL and hash are required");
    }
    if (!this.crowdfundGovAddress) {
      throw new Error(
        "Crowdfund address not set. Please setupCrowdfund first.",
      );
    }

    const walletInfo = await this.getWalletInfoForTx();
    let { utxos, walletAddress } = walletInfo;
    const { collateral } = walletInfo;

    // find auth token UTxO at crowdfund address
    const authTokenUtxo = await this.findAuthTokenUtxo();

    const drepId = this.getDrepId();
    const govAction: GovernanceAction = {
      kind: "InfoAction",
      action: {},
    };

    const anchorGovAction = {
      anchorUrl: anchorUrlGovAction,
      anchorDataHash: anchorHashGovAction,
    };

    const anchorDrep = {
      anchorUrl: anchorUrlDrep,
      anchorDataHash: anchorHashDrep,
    };

    const mDatum = mConStr0([
      this.getCrowdfundSpendCbor(),
      this.gov_action,
      this.proposerKeyHash,
      this.stake_register_deposit,
      this.drep_register_deposit,
      this.gov_deposit,
    ]);

    // Set time-to-live (TTL) for the transaction.
    const slot = this.getSlotAfterMinutes(5);

    return (
      this.mesh
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
        .txInRedeemerValue(mConStr0([]))

        //adds drep registration certificate to the transaction
        .drepRegistrationCertificate(drepId, anchorDrep)
        .certificateScript(this.getCrowdfundStartCbor())
        .certificateRedeemerValue(mConStr0([]))

        //adds vote delegation certificate to the transaction
        .voteDelegationCertificate(
          {
            dRepId: drepId,
          },
          this.getCfGRewardAddress() as string,
        )
        .certificateScript(this.getCrowdfundStartCbor())
        .certificateRedeemerValue(mConStr0([]))

        //adds stake registration and delegation certificate to the transaction
        .registerStakeCertificate(this.getCfGRewardAddress() as string)
        .delegateStakeCertificate(
          this.getCfGRewardAddress() as string,
          this.delegate_pool_id,
        )
        .certificateScript(this.getCrowdfundStartCbor())
        .certificateRedeemerValue(mConStr0([]))

        //adds gov action to the transaction
        .proposal(
          govAction,
          anchorGovAction,
          this.getCfGRewardAddress() as RewardAddress,
        )

        .changeAddress(this.crowdfundGovAddress)
        .invalidHereafter(Number(slot))
        .complete()
    );
  };

  deregisterCerts = () => {};

  voteOnGovAction = () => {};

  contributorWithdrawal = () => {};

  removeEmptyInstance = () => {};

  getDrepId = () => {
    return resolveScriptHashDRepId(
      resolveScriptHash(this.getCrowdfundStartCbor(), "V3"),
    );
  };

  getCfGRewardAddress = (): RewardAddress => {
    return scriptHashToRewardAddress(
      resolveScriptHash(this.getCrowdfundStartCbor(), "V3"),
      this.networkId,
    );
  };

  private findAuthTokenUtxo = async (): Promise<UTxO> => {
    if (!this.crowdfundGovAddress) {
      throw new Error(
        "Crowdfund address not set. Please setupCrowdfund first.",
      );
    }
    const blockchainProvider = this.mesh.fetcher;
    if (!blockchainProvider) {
      throw new Error("Blockchain provider not found");
    }
    const authTokenUtxos = await blockchainProvider.fetchAddressUTxOs(
      this.crowdfundGovAddress,
      this.authTokenPolicyId,
    );
    if (!authTokenUtxos || authTokenUtxos.length === 0) {
      throw new Error("No AuthToken found at crowdfund address");
    }
    if (authTokenUtxos.length > 1) {
      throw new Error("Multiple AuthTokens found at crowdfund address.");
    }
    const authTokenUtxo = authTokenUtxos[0];
    if (!authTokenUtxo) {
      throw new Error("No AuthToken found");
    }
    return authTokenUtxo;
  };

  private getSlotAfterMinutes = (minutes: number): string => {
    const nowDateTime = new Date();
    const dateTimeAdd = new Date(nowDateTime.getTime() + minutes * 60000);
    return resolveSlotNo(
      this.networkId ? "mainnet" : "preprod",
      dateTimeAdd.getTime(),
    );
  };
}
