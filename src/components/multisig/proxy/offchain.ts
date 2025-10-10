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
import { parseDatumCbor } from "@meshsdk/core-cst";

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
export class MeshProxyContract extends MeshTxInitiator {
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
    super(inputs);
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

  spendProxySimple = async (
    outputs: { address: string; unit: string; amount: string }[],
  ) => {
    const { utxos, collateral, walletAddress } =
      await this.getWalletInfoForTx();

    if (utxos?.length <= 0) {
      throw new Error("No UTxOs found");
    }

    if (this.proxyAddress === undefined) {
      throw new Error("Proxy address not set. Please setupProxy first.");
    }

    const blockchainProvider = this.mesh.fetcher;
    if (!blockchainProvider) {
      throw new Error("Blockchain provider not found");
    }

    const proxyUtxos = await blockchainProvider.fetchAddressUTxOs(
      this.proxyAddress,
    );

    const freeProxyUtxos = proxyUtxos[0]!;
    console.log("freeProxyUtxos", freeProxyUtxos);

    const paramScriptAT = this.getAuthTokenCbor();
    const policyIdAT = resolveScriptHash(paramScriptAT, "V3");

    const authTokenUtxos = utxos.filter((utxo) =>
      utxo.output.amount.some((asset) => asset.unit === policyIdAT),
    );

    console.log("authTokenUtxos", authTokenUtxos);
    console.log("policyIdAT", policyIdAT);

    if (!authTokenUtxos || authTokenUtxos.length === 0) {
      throw new Error("No AuthToken found at control wallet address");
    }
    //ToDo check if AuthToken utxo is used in a pending transaction and blocked then use a free AuthToken
    const authTokenUtxo = authTokenUtxos[0];
    if (!authTokenUtxo) {
      throw new Error("No AuthToken found");
    }
    const authTokenUtxoAmt = authTokenUtxo.output.amount;
    if (!authTokenUtxoAmt) {
      throw new Error("No AuthToken amount found");
    }

    //prepare Proxy spend
    //1 Get
    const txHex = await this.mesh
      .spendingPlutusScriptV3()
      .txIn(
        freeProxyUtxos.input.txHash,
        freeProxyUtxos.input.outputIndex,
        freeProxyUtxos.output.amount,
        freeProxyUtxos.output.address,
      )
      .txInScript(this.getProxyCbor())
      .txInRedeemerValue(mConStr0([]))
      .txInDatumValue(mConStr0([])) // Add empty datum since script expects Option<Data>
      .txIn(
        authTokenUtxo.input.txHash,
        authTokenUtxo.input.outputIndex,
        authTokenUtxo.output.amount,
        authTokenUtxo.output.address,
      )
      .txInCollateral(
        collateral.input.txHash,
        collateral.input.outputIndex,
        collateral.output.amount,
        collateral.output.address,
      )
      .txOut(walletAddress, [{ unit: policyIdAT, quantity: "1" }])


    for (const output of outputs) {
      txHex.txOut(output.address, [
        { unit: output.unit, quantity: output.amount },
      ]);
    }

    txHex.changeAddress(walletAddress)
    // Only pass pubkey (KeyHash) UTxOs for coin selection
    .selectUtxosFrom(utxos)

    const tx = await txHex.complete();
    console.log("tx", tx);

    return tx;
  };

  /**
   * Fetch the balance of the proxy address
   *
   * @returns - Array of assets with their quantities at the proxy address
   *
   * @example
   * ```typescript
   * const balance = await contract.getProxyBalance();
   * console.log(balance); // [{ unit: "lovelace", quantity: "1000000" }, ...]
   * ```
   */
  getProxyBalance = async () => {
    if (this.proxyAddress === undefined) {
      throw new Error("Proxy address not set. Please setupProxy first.");
    }

    const blockchainProvider = this.mesh.fetcher;
    if (!blockchainProvider) {
      throw new Error("Blockchain provider not found");
    }

    const utxos = await blockchainProvider.fetchAddressUTxOs(this.proxyAddress);

    // Aggregate all assets from UTxOs
    const balanceMap = new Map<string, bigint>();

    for (const utxo of utxos) {
      for (const asset of utxo.output.amount) {
        const currentAmount = balanceMap.get(asset.unit) || BigInt(0);
        balanceMap.set(asset.unit, currentAmount + BigInt(asset.quantity));
      }
    }

    // Convert back to string format for consistency
    const balance = Array.from(balanceMap.entries()).map(
      ([unit, quantity]) => ({
        unit,
        quantity: quantity.toString(),
      }),
    );

    return balance;
  };
}
