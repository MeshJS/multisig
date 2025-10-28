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
  resolveScriptHashDRepId,
  MeshTxBuilder,
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
// Cache for DRep status to avoid multiple API calls
const drepStatusCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export class MeshProxyContract extends MeshTxInitiator {
  paramUtxo: UTxO["input"] = { outputIndex: 0, txHash: "" };
  proxyAddress?: string;
  stakeCredential?: string | undefined;
  networkId: number;
  msCbor?: string; // Multisig script cbor

  // Reset method to clear state for retry
  reset() {
    this.paramUtxo = { outputIndex: 0, txHash: "" };
    this.proxyAddress = undefined;
    this.stakeCredential = undefined;
  }

  // Static method to clear DRep status cache
  static clearDrepStatusCache(drepId?: string) {
    if (drepId) {
      drepStatusCache.delete(drepId);
    } else {
      drepStatusCache.clear();
    }
  }

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
    msCbor?: string,
  ) {
    super(inputs);
    this.stakeCredential = inputs.stakeCredential;
    this.networkId = inputs.networkId ? inputs.networkId : 0;
    this.msCbor = msCbor;

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
  setupProxy = async (msUtxos?: UTxO[], msWalletAddress?: string) => {
    if (this.msCbor && !msUtxos && !msWalletAddress) {
      throw new Error(
        "No UTxOs and wallet address for multisig script cbor found",
      );
    }

    let { utxos, collateral, walletAddress } = await this.getWalletInfoForTx();

    if (this.msCbor && msUtxos && msWalletAddress) {
      utxos = msUtxos;
      walletAddress = msWalletAddress;
    }

    //look for, get and set a paramUtxo for minting the AuthToken
    if (!utxos || utxos.length <= 0) {
      throw new Error("No UTxOs found");
    }
    const paramUtxo = utxos?.filter((utxo) =>
      utxo.output.amount
        .map(
          (asset) =>
            asset.unit === "lovelace" && Number(asset.quantity) >= 20000000,
        )
        .reduce((pa, ca, i, a) => pa || ca),
    )[0];
    if (!paramUtxo) {
      throw new Error(
        "Insufficicient balance. Create one utxo holding at Least 20 ADA.",
      );
    }
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
    let tx = await this.mesh.txIn(
      paramUtxo.input.txHash,
      paramUtxo.input.outputIndex,
      paramUtxo.output.amount,
      paramUtxo.output.address,
    );
    // Add the multisig script cbor if it exists
    if (this.msCbor) {
      tx.txInScript(this.msCbor);
    }

    tx.mintPlutusScriptV3()
      .mint("10", policyId, tokenName)
      .mintingScript(this.getAuthTokenCbor())
      .mintRedeemerValue(mConStr0([]))
      .txOut(proxyAddress, [{ unit: "lovelace", quantity: "1000000" }]);

    for (let i = 0; i < 10; i++) {
      tx.txOut(walletAddress, [{ unit: policyId, quantity: "1" }]);
    }

    tx.txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address,
    ).changeAddress(walletAddress);

    const txHex = tx;

    return {
      tx: txHex,
      paramUtxo: paramUtxo.input,
      authTokenId: policyId,
      proxyAddress: proxyAddress,
    };
  };

  spendProxySimple = async (
    outputs: { address: string; unit: string; amount: string }[],
    msUtxos?: UTxO[],
    msWalletAddress?: string,
  ) => {
    if (this.msCbor && !msUtxos && !msWalletAddress) {
      throw new Error(
        "No UTxOs and wallet address for multisig script cbor found",
      );
    }
    let { utxos, collateral, walletAddress } = await this.getWalletInfoForTx();
    // If multisig inputs are provided, use them instead of the wallet inputs
    if (this.msCbor && msUtxos && msWalletAddress) {
      utxos = msUtxos;
      walletAddress = msWalletAddress;
    }
    if (!utxos || utxos.length <= 0) {
      throw new Error("No UTxOs found");
    }
    if (!walletAddress) {
      throw new Error("No wallet address found");
    }
    if (!collateral) {
      throw new Error("No collateral found");
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

    // Calculate spend requirements and ensure coverage by proxy UTxOs
    const REQUIRED_FEE_BUFFER = BigInt(500_000); // 0.5 ADA buffer in lovelace

    const requiredByUnit = new Map<string, bigint>();
    for (const out of outputs) {
      const prev = requiredByUnit.get(out.unit) ?? BigInt(0);
      requiredByUnit.set(out.unit, prev + BigInt(out.amount));
    }
    // Add buffer to lovelace
    const lovelaceNeed =
      (requiredByUnit.get("lovelace") ?? BigInt(0)) + REQUIRED_FEE_BUFFER;
    requiredByUnit.set("lovelace", lovelaceNeed);

    const availableByUnit = new Map<string, bigint>();
    for (const utxo of proxyUtxos) {
      for (const asset of utxo.output.amount) {
        const prev = availableByUnit.get(asset.unit) ?? BigInt(0);
        availableByUnit.set(asset.unit, prev + BigInt(asset.quantity));
      }
    }

    for (const [unit, needed] of requiredByUnit.entries()) {
      const available = availableByUnit.get(unit) ?? BigInt(0);
      if (available < needed) {
        throw new Error(
          `Insufficient proxy balance for ${unit}. Needed: ${needed.toString()}, Available: ${available.toString()}`,
        );
      }
    }

    // Select as few UTxOs as possible to cover required amounts
    const remainingByUnit = new Map<string, bigint>(requiredByUnit);
    const candidateUtxos = [...proxyUtxos];
    const selectedUtxos: typeof proxyUtxos = [];

    const hasRemaining = () => {
      for (const value of remainingByUnit.values()) {
        if (value > BigInt(0)) return true;
      }
      return false;
    };

    const contributionScore = (utxo: (typeof proxyUtxos)[number]) => {
      let score = BigInt(0);
      for (const asset of utxo.output.amount) {
        const remaining = remainingByUnit.get(asset.unit) ?? BigInt(0);
        if (remaining > BigInt(0)) {
          const qty = BigInt(asset.quantity);
          score += qty < remaining ? qty : remaining;
        }
      }
      return score;
    };

    while (hasRemaining()) {
      let bestIdx = -1;
      let bestScore = BigInt(0);
      for (let i = 0; i < candidateUtxos.length; i++) {
        const s = contributionScore(candidateUtxos[i]!);
        if (s > bestScore) {
          bestScore = s;
          bestIdx = i;
        }
      }
      if (bestIdx === -1 || bestScore === BigInt(0)) {
        throw new Error(
          "Unable to select proxy UTxOs to cover required amounts.",
        );
      }
      const chosen = candidateUtxos.splice(bestIdx, 1)[0]!;
      selectedUtxos.push(chosen);
      // Decrease remaining by chosen utxo's amounts
      for (const asset of chosen.output.amount) {
        const remaining = remainingByUnit.get(asset.unit) ?? BigInt(0);
        if (remaining > BigInt(0)) {
          const qty = BigInt(asset.quantity);
          const newRemaining = remaining - (qty < remaining ? qty : remaining);
          remainingByUnit.set(asset.unit, newRemaining);
        }
      }
    }

    const freeProxyUtxos = selectedUtxos;
    const paramScriptAT = this.getAuthTokenCbor();
    const policyIdAT = resolveScriptHash(paramScriptAT, "V3");
    const authTokenUtxos = utxos.filter((utxo) =>
      utxo.output.amount.some((asset) => asset.unit === policyIdAT),
    );

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
    let txHex = await this.mesh;

    for (const input of freeProxyUtxos) {
      txHex
        .spendingPlutusScriptV3()
        .txIn(
          input.input.txHash,
          input.input.outputIndex,
          input.output.amount,
          input.output.address,
        )
        .txInScript(this.getProxyCbor())
        .txInInlineDatumPresent()
        .txInRedeemerValue(mConStr0([]));
    }

    txHex
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
      .txOut(walletAddress, [{ unit: policyIdAT, quantity: "1" }]);

    for (const output of outputs) {
      txHex.txOut(output.address, [
        { unit: output.unit, quantity: output.amount },
      ]);
    }

    txHex.changeAddress(this.proxyAddress);

    // Add the multisig script cbor if it exists (like in setupProxy)
    if (this.msCbor) {
      txHex.txInScript(this.msCbor);
    }

    return txHex;
  };

  manageProxyDrep = async (
    action: "register" | "deregister" | "update",
    anchorUrl?: string,
    anchorHash?: string,
    msUtxos?: UTxO[],
    msWalletAddress?: string,
  ) => {
    if (this.proxyAddress === undefined) {
      throw new Error("Proxy address not set. Please setupProxy first.");
    }
    if (
      (action === "register" || action === "update") &&
      (!anchorUrl || !anchorHash)
    ) {
      throw new Error(
        "Anchor URL and hash are required for register and update actions",
      );
    }
    if (this.msCbor && !msUtxos && !msWalletAddress) {
      throw new Error(
        "No UTxOs and wallet address for multisig script cbor found",
      );
    }
    let { utxos, collateral, walletAddress } = await this.getWalletInfoForTx();
    // If multisig inputs are provided, use them instead of the wallet inputs
    if (this.msCbor && msUtxos && msWalletAddress) {
      utxos = msUtxos;
      walletAddress = msWalletAddress;
    }
    if (!utxos || utxos.length <= 0) {
      throw new Error("No UTxOs found");
    }
    if (!walletAddress) {
      throw new Error("No wallet address found");
    }
    if (!collateral) {
      throw new Error("No collateral found");
    }
    if (this.proxyAddress === undefined) {
      throw new Error("Proxy address not set. Please setupProxy first.");
    }

    const blockchainProvider = this.mesh.fetcher;
    if (!blockchainProvider) {
      throw new Error("Blockchain provider not found");
    }

    const paramScriptAT = this.getAuthTokenCbor();
    const policyIdAT = resolveScriptHash(paramScriptAT, "V3");
    const authTokenUtxos = utxos.filter((utxo) =>
      utxo.output.amount.some((asset) => asset.unit === policyIdAT),
    );

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

    const proxyCbor = this.getProxyCbor();
    const proxyScriptHash = resolveScriptHash(proxyCbor, "V3");
    const drepId = resolveScriptHashDRepId(proxyScriptHash);

    const txHex = await this.mesh;
    txHex.txIn(
      authTokenUtxo.input.txHash,
      authTokenUtxo.input.outputIndex,
      authTokenUtxo.output.amount,
      authTokenUtxo.output.address,
    );

    if (this.msCbor) {
      txHex.txInScript(this.msCbor);
    }
    txHex.txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address,
    );

    // add more utxo inputs until the required amount is reached, use utxos list.
    // Register requires 505 ADA, deregister and update only need 2 ADA
    const requiredAmount =
      action === "register" ? BigInt(505000000) : BigInt(2000000);
    let totalAmount = BigInt(0);
    for (const utxo of utxos) {
      if (totalAmount >= requiredAmount) {
        break;
      }
      txHex.txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
      );
      if (this.msCbor) {
        txHex.txInScript(this.msCbor);
      }
      totalAmount += BigInt(
        utxo.output.amount.find((asset: any) => asset.unit === "lovelace")
          ?.quantity || "0",
      );
    }

    txHex.txOut(walletAddress, [{ unit: policyIdAT, quantity: "1" }]);

    // Add the appropriate certificate based on action
    if (action === "register") {
      txHex.drepRegistrationCertificate(drepId, {
        anchorUrl: anchorUrl!,
        anchorDataHash: anchorHash!,
      });
    } else if (action === "deregister") {
      txHex.drepDeregistrationCertificate(drepId, "500000000");
    } else if (action === "update") {
      txHex.drepUpdateCertificate(drepId, {
        anchorUrl: anchorUrl!,
        anchorDataHash: anchorHash!,
      });
    }

    txHex
      .certificateScript(this.getProxyCbor(), "V3")
      .certificateRedeemerValue(mConStr0([]))
      .changeAddress(walletAddress);

    return txHex;
  };

  /**
   * Register a proxy DRep
   *
   * @param anchorUrl - URL for the DRep metadata
   * @param anchorHash - Hash of the DRep metadata
   * @param msUtxos - Optional multisig UTxOs
   * @param msWalletAddress - Optional multisig wallet address
   * @returns - Transaction hex for signing
   */
  registerProxyDrep = async (
    anchorUrl: string,
    anchorHash: string,
    msUtxos?: UTxO[],
    msWalletAddress?: string,
  ) => {
    return this.manageProxyDrep(
      "register",
      anchorUrl,
      anchorHash,
      msUtxos,
      msWalletAddress,
    );
  };

  /**
   * Deregister a proxy DRep
   *
   * @param msUtxos - Optional multisig UTxOs
   * @param msWalletAddress - Optional multisig wallet address
   * @returns - Transaction hex for signing
   */
  deregisterProxyDrep = async (msUtxos?: UTxO[], msWalletAddress?: string) => {
    return this.manageProxyDrep(
      "deregister",
      undefined,
      undefined,
      msUtxos,
      msWalletAddress,
    );
  };

  /**
   * Update a proxy DRep
   *
   * @param anchorUrl - URL for the DRep metadata
   * @param anchorHash - Hash of the DRep metadata
   * @param msUtxos - Optional multisig UTxOs
   * @param msWalletAddress - Optional multisig wallet address
   * @returns - Transaction hex for signing
   */
  updateProxyDrep = async (
    anchorUrl: string,
    anchorHash: string,
    msUtxos?: UTxO[],
    msWalletAddress?: string,
  ) => {
    return this.manageProxyDrep(
      "update",
      anchorUrl,
      anchorHash,
      msUtxos,
      msWalletAddress,
    );
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

    try {
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
    } catch (error: any) {
      throw new Error(`Failed to fetch proxy balance: ${error?.message || 'Unknown error'}`);
    }
  };

  getDrepId = () => {
    const proxyCbor = this.getProxyCbor();
    const proxyScriptHash = resolveScriptHash(proxyCbor, "V3");
    return resolveScriptHashDRepId(proxyScriptHash);
  };

  getDrepStatus = async () => {
    const drepId = this.getDrepId();
    
    // Check cache first
    const cached = drepStatusCache.get(drepId);
    if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      return cached.data;
    }
    
    if (!this.mesh.fetcher) {
      throw new Error("Blockchain provider not found");
    }
    
    try {
      const drepStatus = await this.mesh.fetcher.get(
        `/governance/dreps/${drepId}`,
      );
      
      // Cache the successful result
      drepStatusCache.set(drepId, {
        data: drepStatus,
        timestamp: Date.now()
      });
      
      return drepStatus;
    } catch (error: any) {
      // Parse the error if it's a stringified JSON
      let parsedError = error;
      if (typeof error === 'string') {
        try {
          parsedError = JSON.parse(error);
        } catch {
          // If parsing fails, use the original error
        }
      }
      
      // Handle specific error cases - check multiple possible 404 indicators
      const is404 = error?.status === 404 || 
                   error?.response?.status === 404 || 
                   error?.data?.status_code === 404 ||
                   parsedError?.status === 404 ||
                   parsedError?.data?.status_code === 404 ||
                   error?.message?.includes('404') ||
                   error?.message?.includes('Not Found') ||
                   error?.message?.includes('not found') ||
                   error?.message?.includes('NOT_FOUND') ||
                   (error?.response?.data && error.response.data.status_code === 404) ||
                   (error?.data && error.data.status_code === 404);
      
      if (is404) {
        // DRep not registered yet - cache null result
        drepStatusCache.set(drepId, {
          data: null,
          timestamp: Date.now()
        });
        return null;
      }
      
      // For other errors, don't cache and re-throw
      console.log(`Failed to fetch DRep status: ${error?.message || 'Unknown error'}`);
    }
  };

  /**
   * Vote on governance proposals using proxy DRep
   * @param votes Array of vote objects with proposalId, voteKind, and optional metadata
   * @param msUtxos Multisig UTxOs for transaction inputs (optional)
   * @param msWalletAddress Multisig wallet address (optional)
   * @returns Transaction builder
   */
  voteProxyDrep = async (
    votes: Array<{
      proposalId: string;
      voteKind: "Yes" | "No" | "Abstain";
      metadata?: any;
    }>,
    msUtxos?: UTxO[],
    msWalletAddress?: string,
  ): Promise<MeshTxBuilder> => {
    if (!votes || votes.length === 0) {
      throw new Error("No votes provided");
    }

    // Get wallet info for transaction
    const walletInfo = await this.getWalletInfoForTx();

    // Use multisig inputs if provided, otherwise use regular wallet
    const utxos = msUtxos || walletInfo.utxos;
    const walletAddress = msWalletAddress || walletInfo.walletAddress;

    // Always get collateral from user's regular wallet
    let collateral: UTxO;
    try {
      const collateralInfo = await this.getWalletInfoForTx();
      const foundCollateral = collateralInfo.utxos.find((utxo: UTxO) =>
        utxo.output.amount.some(
          (amount: any) =>
            amount.unit === "lovelace" &&
            BigInt(amount.quantity) >= BigInt(5000000),
        ),
      );
      if (!foundCollateral) {
        throw new Error(
          "No suitable collateral UTxO found in regular wallet. Please add at least 5 ADA to your regular wallet.",
        );
      }
      collateral = foundCollateral;
    } catch (error) {
      throw new Error(
        "Failed to get collateral from regular wallet. Please ensure you have at least 5 ADA in your regular wallet for transaction collateral.",
      );
    }

    if (!walletAddress) {
      throw new Error("No wallet address found");
    }
    if (!collateral) {
      throw new Error("No collateral found");
    }
    if (this.proxyAddress === undefined) {
      throw new Error("Proxy address not set. Please setupProxy first.");
    }

    const blockchainProvider = this.mesh.fetcher;
    if (!blockchainProvider) {
      throw new Error("Blockchain provider not found");
    }

    const paramScriptAT = this.getAuthTokenCbor();
    const policyIdAT = resolveScriptHash(paramScriptAT, "V3");
    const authTokenUtxos = utxos.filter((utxo) =>
      utxo.output.amount.some((asset) => asset.unit === policyIdAT),
    );

    if (!authTokenUtxos || authTokenUtxos.length === 0) {
      throw new Error("No AuthToken found at control wallet address");
    }

    const authTokenUtxo = authTokenUtxos[0];
    if (!authTokenUtxo) {
      throw new Error("No AuthToken found");
    }
    const authTokenUtxoAmt = authTokenUtxo.output.amount;
    if (!authTokenUtxoAmt) {
      throw new Error("No AuthToken amount found");
    }

    const proxyCbor = this.getProxyCbor();
    const proxyScriptHash = resolveScriptHash(proxyCbor, "V3");
    const drepId = resolveScriptHashDRepId(proxyScriptHash);

    const txHex = await this.mesh;

    // 1. Add AuthToken UTxO first (following manageProxyDrep pattern)
    txHex.txIn(
      authTokenUtxo.input.txHash,
      authTokenUtxo.input.outputIndex,
      authTokenUtxo.output.amount,
      authTokenUtxo.output.address,
    );

    if (this.msCbor) {
      txHex.txInScript(this.msCbor);
    }

    // 2. Add collateral
    txHex.txInCollateral(
      collateral.input.txHash,
      collateral.input.outputIndex,
      collateral.output.amount,
      collateral.output.address,
    );

    // 3. Add additional UTxOs if needed (for voting fees)
    const requiredAmount = BigInt(2000000); // 2 ADA for voting
    let totalAmount = BigInt(0);
    for (const utxo of utxos) {
      if (totalAmount >= requiredAmount) {
        break;
      }
      txHex.txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
      );
      if (this.msCbor) {
        txHex.txInScript(this.msCbor);
      }
      totalAmount += BigInt(
        utxo.output.amount.find((asset: any) => asset.unit === "lovelace")
          ?.quantity || "0",
      );
    }

    // 4. Add output (return AuthToken)
    txHex.txOut(walletAddress, [{ unit: policyIdAT, quantity: "1" }]);

    console.log("votes", votes);
    console.log("txHex", txHex);

    // 5. Add votes for each proposal
    for (const vote of votes) {
      const [txHash, certIndex] = vote.proposalId.split("#");
      if (!txHash || certIndex === undefined) {
        throw new Error(`Invalid proposal ID format: ${vote.proposalId}`);
      }

      txHex
      .votePlutusScriptV3()
      .vote(
        {
          type: "DRep",
          drepId: drepId,
        },
        {
          txHash: txHash,
          txIndex: parseInt(certIndex),
        },
        {
          voteKind: vote.voteKind,
        },
      )
      .voteScript(this.getProxyCbor())
      .voteRedeemerValue("")
    }

    // 6. Add certificate script and redeemer (following manageProxyDrep pattern)
    txHex
      .changeAddress(walletAddress);

    return txHex;
  };
}
