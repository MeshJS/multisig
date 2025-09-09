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
} from "@meshsdk/common";
import {
  resolveScriptHash,
  serializePlutusScript,
  UTxO,
  applyParamsToScript,
} from "@meshsdk/core";
import { MeshTxInitiator, MeshTxInitiatorInput } from "../common";
import blueprint from "./plutus.json";
import { CrowdfundDatumTS } from "../crowdfund";

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

  /**
   *
   */
  removeCrowdfund = async () => {};
}
