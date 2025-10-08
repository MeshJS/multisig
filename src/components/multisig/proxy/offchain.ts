import {
    AssetMetadata,
    conStr0,
    Data,
    integer,
    mConStr0,
    mOutputReference,
    mPubKeyAddress,
    stringToHex,
  } from "@meshsdk/common";
  import {
    deserializeAddress,
    resolveScriptHash,
    serializeAddressObj,
    serializePlutusScript,
    UTxO,
    applyCborEncoding,
    applyParamsToScript,
  } from "@meshsdk/core";
  import {
    parseDatumCbor
  } from "@meshsdk/core-cst";
  
  import { MeshTxInitiator, MeshTxInitiatorInput } from "./common";
  import blueprint from "./aiken-workspace/plutus.json";



/**
 * Mesh Plutus NFT contract class
 * 
 * This NFT minting script enables users to mint NFTs with an automatically incremented index, which increases by one for each newly minted NFT. 
 * 
 * To facilitate this process, the first step is to set up a one-time minting policy by minting an oracle token. This oracle token is essential as it holds the current state and index of the NFTs, acting as a reference for the minting sequence. 
 * 
 * With each new NFT minted, the token index within the oracle is incremented by one, ensuring a consistent and orderly progression in the numbering of the NFTs.
 */
export class MeshProxyContract  {
  paramUtxo: UTxO["input"] = { outputIndex: 0, txHash: "" };
  proxyAddress?: string;
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

  getProxyCbor = () => {
    const authTokenPolicyId = this.getAuthTokenPolicyId();
    return applyParamsToScript(blueprint.validators[2]!.compiledCode, [
      authTokenPolicyId,
    ]);
  };

  setProxyAddress = () => {
    const proxyAddress = serializePlutusScript(
      {
        code: this.getProxyCbor(),
        version: "V3",
      },
      this.stakeCredential,
      this.networkId,
    ).address;
    this.proxyAddress = proxyAddress;
    return proxyAddress;
  };

  constructor(
    inputs: MeshTxInitiatorInput,
    contract: {
      paramUtxo?: UTxO["input"];
    },
  ) {
    this.stakeCredential = inputs.stakeCredential;
    this.networkId = inputs.networkId ? inputs.networkId : 0;
    // Set the proxyAddress if paramUtxo is provided
    if (contract.paramUtxo) {
      this.paramUtxo = contract.paramUtxo;
      this.setProxyAddress();
    }
  }

/**
 * Set up a proxy address with fixed amount of 10 auth tokens, that will be sent to the owner multisig
 * Moving an auth token unlocks the proxy address.
 * 
 * @returns - Transaction hex to be signed by the owner multisig
 *
 * @example
 * ```typescript
 * const { tx, paramUtxo } = await contract.setupProxy();
 * ```
 */
  setupProxy = async () => {
    const { utxos, collateral, walletAddress } =
      await this.getWalletInfoForTx();

    //look for, get and set a paramUtxo for minting the AuthToken
    if (utxos?.length <= 0) {
      throw new Error("No UTxOs found");
    }
    const paramUtxo = utxos[0]!;
    this.paramUtxo = paramUtxo.input;

    //Set proxyAddress depending on the paramUtxo
    const proxyAddress = this.setProxyAddress();
    if (!proxyAddress) {
      throw new Error("Proxy address not set");
    }

    //prepare AuthToken mint
    const policyId = this.getAuthTokenPolicyId();
    const tokenName = "";

    // Try completing the transaction step by step
    const tx = this.mesh
      .txIn(
        paramUtxo.input.txHash,
        paramUtxo.input.outputIndex,
        paramUtxo.output.amount,
        paramUtxo.output.address,
      )
      .mintPlutusScriptV3()
      .mint("10", policyId, tokenName)
      .mintingScript(this.getAuthTokenCbor())
      .mintRedeemerValue(mConStr0([]))
      .txOut(walletAddress, [{ unit: policyId, quantity: "10" }])
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
      proxyAddress: proxyAddress,
    };

  };


  /**
   * Mint NFT token with an automatically incremented index, which increases by one for each newly minted NFT.
   * @param assetMetadata - Asset metadata
   * @returns - Transaction hex
   *
   * @example
   * ```typescript
   * const assetMetadata = {
   *  ...demoAssetMetadata,
   * name: `Mesh Token ${oracleData.nftIndex}`,
   * };
   * const tx = await contract.mintPlutusNFT(assetMetadata);
   * ```
   */
  mintPlutusNFT = async (assetMetadata?: AssetMetadata) => {
    const { utxos, collateral, walletAddress } =
      await this.getWalletInfoForTx();
    if (utxos?.length <= 0) {
      throw new Error("No UTxOs found");
    }

    const {
      nftIndex,
      policyId,
      lovelacePrice,
      oracleUtxo,
      oracleNftPolicyId,
      feeCollectorAddress,
      feeCollectorAddressObj,
    } = await this.getOracleData();

    const tokenName = `${this.collectionName} (${nftIndex})`;
    const tokenNameHex = stringToHex(tokenName);

    const updatedOracleDatum: OracleDatum = conStr0([
      integer((nftIndex as number) + 1),
      integer(lovelacePrice),
      feeCollectorAddressObj,
    ]);

    const tx = this.mesh
      .spendingPlutusScriptV3()
      .txIn(
        oracleUtxo.input.txHash,
        oracleUtxo.input.outputIndex,
        oracleUtxo.output.amount,
        oracleUtxo.output.address,
      )
      .txInRedeemerValue(mConStr0([]))
      .txInScript(this.getOracleCbor())
      .txInInlineDatumPresent()
      .txOut(this.oracleAddress, [{ unit: oracleNftPolicyId, quantity: "1" }])
      .txOutInlineDatumValue(updatedOracleDatum, "JSON")
      .mintPlutusScriptV3()
      .mint("1", policyId, tokenNameHex)
      .mintingScript(this.getNFTCbor());

    if (assetMetadata) {
      const metadata = { [policyId]: { [tokenName]: { ...assetMetadata } } };
      tx.metadataValue(721, metadata);
    }

    tx.mintRedeemerValue(mConStr0([]))
      .txOut(feeCollectorAddress, [
        { unit: "lovelace", quantity: lovelacePrice.toString() },
      ])
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .changeAddress(walletAddress)
      .selectUtxosFrom(utxos);

    const txHex = await tx.complete();
    return txHex;
  };


}