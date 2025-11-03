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
import { MeshCrowdfundGovExtensionContract } from "../gov-extension/offchain";
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
export class MeshCrowdfundContract extends MeshTxInitiator {
  proposerKeyHash: string;
  paramUtxo: UTxO["input"] = { outputIndex: 0, txHash: "" };
  crowdfundAddress?: string;
  stakeCredential?: string | undefined;
  networkId: number;

  getAuthTokenCbor = () => {
    return applyParamsToScript(blueprint.validators[0]!.compiledCode, [
      mOutputReference(this.paramUtxo.txHash, this.paramUtxo.outputIndex),
    ]);
  };
  getAuthTokenPolicyId = () => {
    return resolveScriptHash(this.getAuthTokenCbor(), "V3");
  };

  getCrowdfundCbor = () => {
    const authTokenPolicyId = this.getAuthTokenPolicyId();
    return applyParamsToScript(blueprint.validators[2]!.compiledCode, [
      authTokenPolicyId,
      stringToHex(this.proposerKeyHash),
    ]);
  };

  setCrowdfundAddress = () => {
    const crowdfundAddress = serializePlutusScript(
      {
        code: this.getCrowdfundCbor(),
        version: "V3",
      },
      this.stakeCredential,
      this.networkId,
    ).address;
    this.crowdfundAddress = crowdfundAddress;
    return crowdfundAddress;
  };

  getShareTokenCbor = () => {
    const authTokenPolicyId = resolveScriptHash(this.getAuthTokenCbor(), "V3");
    return applyParamsToScript(blueprint.validators[4]!.compiledCode, [
      authTokenPolicyId,
    ]);
  };

  constructor(
    inputs: MeshTxInitiatorInput,
    contract: {
      proposerKeyHash: string;
      paramUtxo?: UTxO["input"];
    },
  ) {
    super(inputs);
    this.proposerKeyHash = contract.proposerKeyHash;
    this.stakeCredential = inputs.stakeCredential;
    this.networkId = inputs.networkId ? inputs.networkId : 0;
    // Set the crowdfundAddress if paramUtxo is provided
    if (contract.paramUtxo) {
      this.paramUtxo = contract.paramUtxo;
      this.setCrowdfundAddress();
    }
  }
  /**
   * Setup the crowdfund contract
   * Mints a one time AuthToken and deposits it at the crowdfundAddress, which is parameterized by the AuthToken and the proposerKeyHash
   *
   * @returns - Transaction hex and paramUtxo
   *
   * ```typescript
   * const { tx, paramUtxo } = await contract.setupCrowdfund();
   * ```
   */
  setupCrowdfund = async (datum: CrowdfundDatumTS) => {
    const { utxos, collateral, walletAddress } =
      await this.getWalletInfoForTx();

    //look for, get and set a paramUtxo for minting the AuthToken
    if (utxos?.length <= 0) {
      throw new Error("No UTxOs found");
    }
    const paramUtxo = utxos[0]!;
    this.paramUtxo = paramUtxo.input;

    //Set crowdfundAddress depending on the paramUtxo
    const crowdfundAddress = this.setCrowdfundAddress();
    if (!crowdfundAddress) {
      throw new Error("Crowdfund address not set");
    }

    //prepare AuthToken mint
    //ToDo add default MeshCrowdfund image to authtoken add param to pass custom image path.
    const policyId = this.getAuthTokenPolicyId();
    const tokenName = "";

    //prepare Completion scripthash for the datum
    const completion_scriptHash = resolveScriptHash(
      this.getCrowdfundCbor(),
      "V3",
    );

    //prepare ShareToken policy for the datum
    const paramScriptST = this.getShareTokenCbor();
    const policyIdST = resolveScriptHash(paramScriptST, "V3");

    // Ensure all values are defined and valid
    const mDatum = mConStr0([
      completion_scriptHash, // completion_script
      policyIdST, // share_token
      mPubKeyAddress(crowdfundAddress), // crowdfund_address
      datum.fundraise_target || 100000000000, // fundraise_target - add fallback
      datum.current_fundraised_amount || 0, // current_fundraised_amount - add fallback
      mBool(datum.allow_over_subscription || false), // allow_over_subscription
      datum.deadline || 0, // deadline - add fallback
      datum.expiry_buffer || 100, // expiry_buffer - add fallback
      mPubKeyAddress(datum.fee_address), // fee_address
      datum.min_charge || 2000000, // min_charge - add fallback
    ]);

    // Try completing the transaction step by step
    const tx = this.mesh
      .txIn(
        paramUtxo.input.txHash,
        paramUtxo.input.outputIndex,
        paramUtxo.output.amount,
        paramUtxo.output.address,
      )
      .mintPlutusScriptV3()
      .mint("1", policyId, tokenName)
      .mintingScript(this.getAuthTokenCbor())
      .mintRedeemerValue(mConStr0([]))
      .txOut(crowdfundAddress, [{ unit: policyId, quantity: "1" }])
      .txOutInlineDatumValue(mDatum, "Mesh")
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos);

    const txHex = await tx.complete();

    return {
      tx: txHex,
      paramUtxo: paramUtxo.input,
      authTokenId: policyId,
      completion_scriptHash: completion_scriptHash,
      share_token: policyIdST,
      crowdfund_address: crowdfundAddress,
    };
  };

  /**
   *
   */
  contributeCrowdfund = async (
    contributionAmount: number,
    datum: CrowdfundDatumTS,
  ) => {
    const { utxos, collateral, walletAddress } =
      await this.getWalletInfoForTx();

    if (utxos?.length <= 0) {
      throw new Error("No UTxOs found");
    }
    if (this.crowdfundAddress === undefined) {
      throw new Error(
        "Crowdfund address not set. Please setupCrowdfund first.",
      );
    }

    //find authToken at crowdfundAddress
    const blockchainProvider = this.mesh.fetcher;
    if (!blockchainProvider) {
      throw new Error("Blockchain provider not found");
    }

    const paramScriptAT = this.getAuthTokenCbor();
    const policyIdAT = resolveScriptHash(paramScriptAT, "V3");

    const authTokenUtxos = await blockchainProvider.fetchAddressUTxOs(
      this.crowdfundAddress,
      policyIdAT,
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
    const authTokenUtxoAmt = authTokenUtxo.output.amount;
    if (!authTokenUtxoAmt) {
      throw new Error("No AuthToken amount found");
    }

    //calculate the new amount of Ada at the crowdfundAddress (to keep all funds in one utxo)
    const newCrowdfundAmount = authTokenUtxoAmt.map((amt) =>
      amt.unit == "lovelace"
        ? {
            unit: amt.unit,
            quantity: (
              BigInt(amt.quantity) + BigInt(contributionAmount)
            ).toString(),
          }
        : amt,
    );

    //prepare the new datum as Mesh Data type
    const mDatum = mConStr0([
      datum.completion_script,
      datum.share_token,
      mPubKeyAddress(datum.crowdfund_address),
      datum.fundraise_target,
      datum.current_fundraised_amount + contributionAmount,
      mBool(datum.allow_over_subscription),
      datum.deadline,
      datum.expiry_buffer,
      mPubKeyAddress(datum.fee_address),
      datum.min_charge,
    ]);

    //prepare shareToken mint
    const paramScript = this.getShareTokenCbor();
    const policyId = resolveScriptHash(paramScript, "V3");
    const tokenName = datum.completion_script;

    //Set time-to-live (TTL) for the transaction.
    let minutes = 5; // add 5 minutes
    let nowDateTime = new Date();
    let dateTimeAdd5Min = new Date(nowDateTime.getTime() + minutes * 60000);
    const slot = resolveSlotNo(
      this.networkId ? "mainnet" : "preprod",
      dateTimeAdd5Min.getTime(),
    );

    // deposit Ada at crowdfundAddress
    // mint ShareToken and send to walletAddress

    const txHex = await this.mesh
      .spendingPlutusScriptV3()
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
      )

      //Mint ShareToken with Redeemer
      .mintPlutusScriptV3()
      .mint(contributionAmount.toString(), policyId, tokenName)
      .mintingScript(paramScript)
      .mintRedeemerValue(mConStr0([]))

      //Add Script and Redeemer
      .txInRedeemerValue(mConStr0([]))
      .txInScript(this.getCrowdfundCbor())
      .txInInlineDatumPresent()

      //Output to Crowdfund addresses and attach datum
      .txOut(this.crowdfundAddress, newCrowdfundAmount)
      .txOutInlineDatumValue(mDatum, "Mesh")

      //Add coinselection infos, TTL, and complete
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      //Output to User address
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .invalidHereafter(Number(slot))
      .complete();

    return { tx: txHex };
  };

  /**
   * Withdraw funds from the crowdfund contract
   * 
   * Allows contributors to withdraw their previously contributed funds from the crowdfund.
   * This operation:
   * - Burns share tokens proportional to the withdrawal amount (negative mint)
   * - Reduces the ADA amount at the crowdfund address
   * - Updates the crowdfund datum with the new current_fundraised_amount
   * - Sends the withdrawn ADA to the user's wallet
   * 
   * The transaction spends the UTxO containing the AuthToken at the crowdfund address,
   * mints a negative amount of share tokens to burn them, and outputs the remaining
   * funds back to the crowdfund address with an updated datum.
   * 
   * @param withdrawAmount - The amount of ADA (in lovelace) to withdraw from the crowdfund
   * @param datum - The current crowdfund datum containing all crowdfund state information
   * @returns An object containing the transaction hex string ready to be signed and submitted
   * 
   * @throws {Error} If no UTxOs are found in the wallet
   * @throws {Error} If the crowdfund address is not set (requires setupCrowdfund first)
   * @throws {Error} If the blockchain provider is not found
   * @throws {Error} If no AuthToken is found at the crowdfund address
   * @throws {Error} If multiple AuthTokens are found (should only be one)
   * 
   * @example
   * ```typescript
   * const { tx } = await contract.withdrawCrowdfund(
   *   5000000, // Withdraw 5 ADA (5,000,000 lovelace)
   *   currentDatum
   * );
   * const signedTx = await wallet.signTx(tx);
   * const txHash = await wallet.submitTx(signedTx);
   * ```
   */
  withdrawCrowdfund = async (
    withdrawAmount: number,
    datum: CrowdfundDatumTS,
  ) => {
    const { utxos, collateral, walletAddress } =
      await this.getWalletInfoForTx();

    if (utxos?.length <= 0) {
      throw new Error("No UTxOs found");
    }
    if (this.crowdfundAddress === undefined) {
      throw new Error(
        "Crowdfund address not set. Please setupCrowdfund first.",
      );
    }

    //find authToken at crowdfundAddress
    const blockchainProvider = this.mesh.fetcher;
    if (!blockchainProvider) {
      throw new Error("Blockchain provider not found");
    }

    const paramScriptAT = this.getAuthTokenCbor();
    const policyIdAT = resolveScriptHash(paramScriptAT, "V3");

    const authTokenUtxos = await blockchainProvider.fetchAddressUTxOs(
      this.crowdfundAddress,
      policyIdAT,
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
    const authTokenUtxoAmt = authTokenUtxo.output.amount;
    if (!authTokenUtxoAmt) {
      throw new Error("No AuthToken amount found");
    }

    // Calculate the new amount of ADA at the crowdfundAddress (to keep all funds in one UTxO)
    // This subtracts the withdrawal amount from the current lovelace balance
    const newCrowdfundAmount = authTokenUtxoAmt.map((amt) =>
      amt.unit == "lovelace"
        ? {
            unit: amt.unit,
            quantity: (
              BigInt(amt.quantity) - BigInt(withdrawAmount)
            ).toString(),
          }
        : amt,
    );

    // Prepare the new datum as Mesh Data type
    // Updates the current_fundraised_amount by subtracting the withdrawal amount
    const mDatum = mConStr0([
      datum.completion_script,
      datum.share_token,
      mPubKeyAddress(datum.crowdfund_address),
      datum.fundraise_target,
      datum.current_fundraised_amount - withdrawAmount, // Decrease by withdrawal amount
      mBool(datum.allow_over_subscription),
      datum.deadline,
      datum.expiry_buffer,
      mPubKeyAddress(datum.fee_address),
      datum.min_charge,
    ]);

    // Prepare shareToken mint policy for burning tokens
    const paramScript = this.getShareTokenCbor();
    const policyId = resolveScriptHash(paramScript, "V3");
    const tokenName = datum.completion_script;

    // Set time-to-live (TTL) for the transaction (5 minutes from now)
    let minutes = 5; // add 5 minutes
    let nowDateTime = new Date();
    let dateTimeAdd5Min = new Date(nowDateTime.getTime() + minutes * 60000);
    const slot = resolveSlotNo(
      this.networkId ? "mainnet" : "preprod",
      dateTimeAdd5Min.getTime(),
    );

    // Build transaction: spend crowdfund UTxO, burn share tokens, update datum, return funds to user

    const txHex = await this.mesh
      .spendingPlutusScriptV3()
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
      )

      // Burn ShareToken (negative mint amount) with Redeemer
      // A negative mint amount burns tokens, reducing the user's share token balance
      .mintPlutusScriptV3()
      .mint((-withdrawAmount).toString(), policyId, tokenName)
      .mintingScript(paramScript)
      .mintRedeemerValue(mConStr1([])) // Redeemer constructor 1 for burning

      // Add Script and Redeemer for spending the crowdfund UTxO
      .txInRedeemerValue(mConStr2([])) // Redeemer constructor 2 for withdrawal action
      .txInScript(this.getCrowdfundCbor())
      .txInInlineDatumPresent()

      //Output to Crowdfund addresses and attach datum
      .txOut(this.crowdfundAddress, newCrowdfundAmount)
      .txOutInlineDatumValue(mDatum, "Mesh")

      //Add coinselection infos, TTL, and complete
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      //Output to User address
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos)
      .invalidHereafter(Number(slot))
      .complete();

    return { tx: txHex };
  };

  /**
   *
   */
  completeCrowdfund = async (
    crowdfundGovExtensionContract: MeshCrowdfundGovExtensionContract,
  ) => {
    const { collateral } = await this.getWalletInfoForTx();

    if (this.crowdfundAddress === undefined) {
      throw new Error(
        "Crowdfund address not set. Please setupCrowdfund first.",
      );
    }
    const cfGAddress = crowdfundGovExtensionContract.crowdfundGovAddress;
    if (!cfGAddress) {
      throw new Error("Crowdfund Gov address not set. Please setupCrowdfundGovExtension first.");
    }

    const authTokenUtxo = await this.findAuthTokenUtxo();
    if (!authTokenUtxo) {
      throw new Error("No AuthToken found");
    }

    const slot = this.getSlotAfterMinutes(5);

    const txHex = this.mesh
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
      .txInScript(this.getCrowdfundCbor())
      .txInInlineDatumPresent()
      .txInRedeemerValue(mConStr1([]))
      .txOut(cfGAddress, authTokenUtxo.output.amount)
      .invalidHereafter(Number(slot))
      .complete();

    return { tx: txHex };
  };

  /**
   *
   */
  removeCrowdfund = async () => {};

  private findAuthTokenUtxo = async (): Promise<UTxO> => {
    if (!this.crowdfundAddress) {
      throw new Error(
        "Crowdfund address not set. Please setupCrowdfund first.",
      );
    }
    const blockchainProvider = this.mesh.fetcher;
    if (!blockchainProvider) {
      throw new Error("Blockchain provider not found");
    }
    const authTokenUtxos = await blockchainProvider.fetchAddressUTxOs(
      this.crowdfundAddress,
      this.getAuthTokenPolicyId(),
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
