import { mOutputReference } from "@meshsdk/common";
import {
  resolveScriptHash,
  serializePlutusScript,
  applyParamsToScript,
  resolveScriptHashDRepId,
} from "@meshsdk/core";
import type { UTxO, MeshTxBuilder } from "@meshsdk/core";

import { MeshTxInitiator } from "./common";
import type { MeshTxInitiatorInput } from "./common";
import blueprint from "./aiken-workspace/plutus.json";

import {
  buildProxySetupTx,
  buildProxySpendTx,
  buildProxyDRepCertificateTx,
  buildProxyVoteTx,
  deriveProxyScripts,
} from "@/lib/proxy/txBuilders";
import {
  selectProxyUtxosForOutputs,
  selectAuthTokenUtxo,
} from "@/lib/proxy/utxoUtils";

// Cache for DRep status to avoid multiple API calls
const drepStatusCache = new Map<string, { data: unknown; timestamp: number }>();
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
    this.networkId = inputs.networkId ?? 0;
    this.msCbor = msCbor;

    // Set the proxyAddress if paramUtxo is provided
    if (contract.paramUtxo) {
      this.paramUtxo = contract.paramUtxo;
      this.setProxyAddress();
    }
  }

  private _resolveWalletInputs = async (
    msUtxos?: UTxO[],
    msWalletAddress?: string,
  ) => {
    if (this.msCbor && (!msUtxos || !msWalletAddress)) {
      throw new Error(
        "No UTxOs and wallet address for multisig script cbor found",
      );
    }
    const walletInfo = await this.getWalletInfoForTx();
    if (this.msCbor && msUtxos && msWalletAddress) {
      return {
        utxos: msUtxos,
        walletAddress: msWalletAddress,
        collateral: walletInfo.collateral,
      };
    }
    return walletInfo;
  };

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
    const { utxos, walletAddress, collateral } =
      await this._resolveWalletInputs(msUtxos, msWalletAddress);

    const result = buildProxySetupTx({
      txBuilder: this.mesh,
      network: this.networkId,
      walletUtxos: utxos,
      walletAddress,
      collateral,
      multisigScriptCbor: this.msCbor,
      stakeCredential: this.stakeCredential,
    });

    this.paramUtxo = result.paramUtxo;
    this.setProxyAddress();

    return { tx: this.mesh, ...result };
  };

  spendProxySimple = async (
    outputs: { address: string; unit: string; amount: string }[],
    msUtxos?: UTxO[],
    msWalletAddress?: string,
  ) => {
    const { utxos, walletAddress, collateral } =
      await this._resolveWalletInputs(msUtxos, msWalletAddress);

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

    const scripts = deriveProxyScripts({
      paramUtxo: this.paramUtxo,
      network: this.networkId,
      stakeCredential: this.stakeCredential,
    });
    const selectedProxyUtxos = selectProxyUtxosForOutputs(
      proxyUtxos,
      outputs,
      500_000n, // browser fee buffer preserved
    );
    const authTokenUtxo = selectAuthTokenUtxo(utxos, scripts.authTokenId);

    buildProxySpendTx({
      txBuilder: this.mesh,
      network: this.networkId,
      proxyAddress: this.proxyAddress,
      paramUtxo: this.paramUtxo,
      walletUtxos: [], // browser passes empty per D6 resolution
      proxyUtxos: selectedProxyUtxos,
      authTokenUtxo,
      collateral,
      outputs,
      walletAddress,
      multisigScriptCbor: this.msCbor,
      stakeCredential: this.stakeCredential,
    });

    return this.mesh;
  };

  manageProxyDrep = async (
    action: "register" | "deregister" | "update",
    anchorUrl?: string,
    anchorJson?: object,
    msUtxos?: UTxO[],
    msWalletAddress?: string,
  ) => {
    if (this.proxyAddress === undefined) {
      throw new Error("Proxy address not set. Please setupProxy first.");
    }
    if (
      (action === "register" || action === "update") &&
      (!anchorUrl || !anchorJson)
    ) {
      throw new Error(
        "Anchor URL and JSON are required for register and update actions",
      );
    }

    const { utxos, walletAddress, collateral } =
      await this._resolveWalletInputs(msUtxos, msWalletAddress);

    const scripts = deriveProxyScripts({
      paramUtxo: this.paramUtxo,
      network: this.networkId,
      stakeCredential: this.stakeCredential,
    });
    const authTokenUtxo = selectAuthTokenUtxo(utxos, scripts.authTokenId);

    buildProxyDRepCertificateTx({
      txBuilder: this.mesh,
      network: this.networkId,
      paramUtxo: this.paramUtxo,
      walletUtxos: utxos,
      authTokenUtxo,
      collateral,
      walletAddress,
      action,
      anchorUrl,
      anchorJson,
      multisigScriptCbor: this.msCbor,
      stakeCredential: this.stakeCredential,
    });

    return this.mesh;
  };

  /**
   * Register a proxy DRep
   *
   * @param anchorUrl - URL for the DRep metadata
   * @param anchorJson - Raw JSON-LD metadata object (hash is computed internally)
   * @param msUtxos - Optional multisig UTxOs
   * @param msWalletAddress - Optional multisig wallet address
   * @returns - Transaction hex for signing
   */
  registerProxyDrep = async (
    anchorUrl: string,
    anchorJson: object,
    msUtxos?: UTxO[],
    msWalletAddress?: string,
  ) => {
    return this.manageProxyDrep(
      "register",
      anchorUrl,
      anchorJson,
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
   * @param anchorJson - Raw JSON-LD metadata object (hash is computed internally)
   * @param msUtxos - Optional multisig UTxOs
   * @param msWalletAddress - Optional multisig wallet address
   * @returns - Transaction hex for signing
   */
  updateProxyDrep = async (
    anchorUrl: string,
    anchorJson: object,
    msUtxos?: UTxO[],
    msWalletAddress?: string,
  ) => {
    return this.manageProxyDrep(
      "update",
      anchorUrl,
      anchorJson,
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
          const currentAmount = balanceMap.get(asset.unit) ?? BigInt(0);
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
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to fetch proxy balance: ${errorMessage}`);
    }
  };

  getDrepId = () => {
    const proxyCbor = this.getProxyCbor();
    const proxyScriptHash = resolveScriptHash(proxyCbor, "V3");
    return resolveScriptHashDRepId(proxyScriptHash);
  };

  getDrepStatus = async (forceRefresh = false) => {
    const drepId = this.getDrepId();

    // Check cache first
    const cached = drepStatusCache.get(drepId);
    if (!forceRefresh && cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
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
    } catch (error: unknown) {
      // Parse the error if it's a stringified JSON
      let parsedError: unknown = error;
      if (typeof error === 'string') {
        try {
          parsedError = JSON.parse(error);
        } catch {
          // If parsing fails, use the original error
        }
      }

      // Handle specific error cases - check multiple possible 404 indicators
      const errorObj = error as Record<string, unknown>;
      const parsedObj = parsedError as Record<string, unknown>;
      const is404 = errorObj?.status === 404 ||
                   (errorObj?.response as Record<string, unknown>)?.status === 404 ||
                   (errorObj?.data as Record<string, unknown>)?.status_code === 404 ||
                   parsedObj?.status === 404 ||
                   (parsedObj?.data as Record<string, unknown>)?.status_code === 404 ||
                   (errorObj?.message as string)?.includes('404') ||
                   (errorObj?.message as string)?.includes('Not Found') ||
                   (errorObj?.message as string)?.includes('not found') ||
                   (errorObj?.message as string)?.includes('NOT_FOUND') ||
                   ((errorObj?.response as Record<string, unknown>)?.data as Record<string, unknown>)?.status_code === 404 ||
                   ((errorObj?.data as Record<string, unknown>)?.status_code === 404);

      if (is404) {
        // DRep not registered yet - cache null result
        drepStatusCache.set(drepId, {
          data: null,
          timestamp: Date.now()
        });
        return null;
      }

      // For other errors, don't cache and re-throw
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`Failed to fetch DRep status: ${errorMessage}`);
    }
  };

  /**
   * Get DRep delegators and their delegation amounts
   * @param forceRefresh Whether to bypass cache
   * @returns Array of delegators with addresses and amounts, plus total delegation
   */
  getDrepDelegators = async (forceRefresh = false) => {
    const drepId = this.getDrepId();

    // First check if DRep is registered - don't fetch delegators if not registered
    const drepStatus = await this.getDrepStatus(forceRefresh);
    if (!drepStatus || drepStatus === null) {
      // DRep is not registered, return empty result
      console.log(`DRep ${drepId} is not registered, skipping delegators fetch`);
      return {
        delegators: [],
        totalDelegation: "0",
        totalDelegationADA: 0,
        count: 0
      };
    }

    // Check cache first
    const cacheKey = `${drepId}_delegators`;
    const cached = drepStatusCache.get(cacheKey);
    if (!forceRefresh && cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
      return cached.data;
    }

    if (!this.mesh.fetcher) {
      throw new Error("Blockchain provider not found");
    }

    try {
      const delegators = await this.mesh.fetcher.get(
        `/governance/dreps/${drepId}/delegators?count=100&page=1&order=asc`,
      );

      // Calculate total delegation amount
      const totalDelegation = delegators.reduce((sum: bigint, delegator: { amount: string }) => {
        return sum + BigInt(delegator.amount);
      }, BigInt(0));

      const result = {
        delegators,
        totalDelegation: totalDelegation.toString(),
        totalDelegationADA: Number(totalDelegation) / 1000000, // Convert to ADA
        count: delegators.length
      };

      // Cache the successful result
      drepStatusCache.set(cacheKey, {
        data: result,
        timestamp: Date.now()
      });

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.log(`Failed to fetch DRep delegators: ${errorMessage}`);

      // Return empty result for errors
      return {
        delegators: [],
        totalDelegation: "0",
        totalDelegationADA: 0,
        count: 0
      };
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
      metadata?: unknown;
    }>,
    msUtxos?: UTxO[],
    msWalletAddress?: string,
  ): Promise<MeshTxBuilder> => {
    if (!votes || votes.length === 0) {
      throw new Error("No votes provided");
    }

    if (this.proxyAddress === undefined) {
      throw new Error("Proxy address not set. Please setupProxy first.");
    }

    const { utxos, walletAddress, collateral } =
      await this._resolveWalletInputs(msUtxos, msWalletAddress);

    const scripts = deriveProxyScripts({
      paramUtxo: this.paramUtxo,
      network: this.networkId,
      stakeCredential: this.stakeCredential,
    });
    const authTokenUtxo = selectAuthTokenUtxo(utxos, scripts.authTokenId);

    buildProxyVoteTx({
      txBuilder: this.mesh,
      network: this.networkId,
      paramUtxo: this.paramUtxo,
      walletUtxos: utxos,
      authTokenUtxo,
      collateral,
      walletAddress,
      votes,
      multisigScriptCbor: this.msCbor,
      stakeCredential: this.stakeCredential,
    });

    return this.mesh;
  };
}
