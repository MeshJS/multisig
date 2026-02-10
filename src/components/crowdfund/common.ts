import {
  BrowserWallet,
  IEvaluator,
  IFetcher,
  IWallet,
  LanguageVersion,
  MeshWallet,
  OfflineFetcher,
  serializePlutusScript,
  UTxO,
} from "@meshsdk/core";
import { OfflineEvaluator } from "@meshsdk/core-csl";
import { MeshTxBuilder } from "@meshsdk/transaction";

export type MeshTxInitiatorInput = {
  mesh: MeshTxBuilder;
  fetcher?: IFetcher;
  evaluator?: IEvaluator;
  wallet?: IWallet;
  networkId?: number;
  stakeCredential?: string;
  version?: number;
};

export class MeshTxInitiator {
  mesh: MeshTxBuilder;
  fetcher?: IFetcher;
  evaluator?: IEvaluator;
  wallet?: IWallet;
  stakeCredential?: string;
  networkId = 0;
  version = 2;
  languageVersion: LanguageVersion = "V2";

  constructor({
    mesh,
    fetcher,
    evaluator,
    wallet,
    networkId = 0,
    stakeCredential = "c08f0294ead5ab7ae0ce5471dd487007919297ba95230af22f25e575",
    version = 2,
  }: MeshTxInitiatorInput) {
    this.mesh = mesh;
    if (fetcher) {
      this.fetcher = fetcher;
    }
    if (evaluator) {
      this.evaluator = evaluator;
    }
    if (wallet) {
      this.wallet = wallet;
    }

    this.networkId = networkId;
    switch (this.networkId) {
      case 1:
        this.mesh.setNetwork("mainnet");
        break;
      default:
        this.mesh.setNetwork("preprod");
    }

    this.version = version;
    switch (this.version) {
      case 1:
        this.languageVersion = "V2";
        break;
      default:
        this.languageVersion = "V3";
    }

    if (stakeCredential) {
      this.stakeCredential = stakeCredential;
    }

    const meshAny = this.mesh as {
      complete?: (...args: unknown[]) => Promise<string>;
      meshTxBuilderBody?: { proposals?: unknown };
      txInCollateral?: (...args: unknown[]) => MeshTxBuilder;
      collateralQueueItem?: { txIn?: { scriptSize?: number } };
    };
    if (meshAny?.complete) {
      const originalComplete = meshAny.complete.bind(meshAny);
      meshAny.complete = async (...args: unknown[]) => {
        if (meshAny.meshTxBuilderBody) {
          if (!Array.isArray(meshAny.meshTxBuilderBody.proposals)) {
            meshAny.meshTxBuilderBody.proposals = [];
          }
          if (!Array.isArray(meshAny.meshTxBuilderBody.scriptMetadata)) {
            meshAny.meshTxBuilderBody.scriptMetadata = [];
          }
        }
        return originalComplete(...args);
      };
    }

    if (meshAny?.txInCollateral) {
      const originalTxInCollateral = meshAny.txInCollateral.bind(meshAny);
      meshAny.txInCollateral = (...args: unknown[]) => {
        const result = originalTxInCollateral(...args);
        try {
          if (meshAny.collateralQueueItem?.txIn) {
            if (meshAny.collateralQueueItem.txIn.scriptSize === undefined) {
              meshAny.collateralQueueItem.txIn.scriptSize = 0;
            }
          }
          const body = meshAny.meshTxBuilderBody as
            | { collaterals?: Array<{ txIn?: { scriptSize?: number } }> }
            | undefined;
          if (body?.collaterals && Array.isArray(body.collaterals)) {
            for (const item of body.collaterals) {
              if (item?.txIn && item.txIn.scriptSize === undefined) {
                item.txIn.scriptSize = 0;
              }
            }
          }
        } catch {
          // Best effort: avoid blocking tx build if collateral patching fails.
        }
        return result;
      };
    }

    if (typeof meshAny?.selectUtxos === "function") {
      const originalSelectUtxos = meshAny.selectUtxos.bind(meshAny);
      meshAny.selectUtxos = async (...args: unknown[]) => {
        try {
          meshAny._lastImplicitDeposit = meshAny.getTotalDeposit?.();
        } catch {
          // best effort only
        }
        return originalSelectUtxos(...args);
      };
    }
  }

  getScriptAddress = (scriptCbor: string) => {
    const { address } = serializePlutusScript(
      { code: scriptCbor, version: this.languageVersion },
      this.stakeCredential,
      this.networkId,
    );
    return address;
  };

  protected signSubmitReset = async () => {
    const signedTx = this.mesh.completeSigning();
    const txHash = await this.mesh.submitTx(signedTx);
    this.resetBuilder();
    return txHash;
  };

  protected resetBuilder = () => {
    this.mesh.reset();
    this.mesh.setNetwork(this.networkId === 1 ? "mainnet" : "preprod");
    const body = (this.mesh as { meshTxBuilderBody?: { proposals?: unknown } })
      .meshTxBuilderBody;
    if (body) {
      if (!Array.isArray(body.proposals)) {
        body.proposals = [];
      }
      if (!Array.isArray((body as { scriptMetadata?: unknown }).scriptMetadata)) {
        (body as { scriptMetadata?: unknown }).scriptMetadata = [];
      }
    }
  };

  protected queryUtxos = async (walletAddress: string): Promise<UTxO[]> => {
    if (this.fetcher) {
      const utxos = await this.fetcher.fetchAddressUTxOs(walletAddress);
      return utxos;
    }
    return [];
  };

  protected getWalletDappAddress = async () => {
    if (this.wallet) {
      const usedAddresses = await this.wallet.getUsedAddresses();
      if (usedAddresses.length > 0) {
        return usedAddresses[0];
      }
      const unusedAddresses = await this.wallet.getUnusedAddresses();
      if (unusedAddresses.length > 0) {
        return unusedAddresses[0];
      }
    }
    return "";
  };

  protected getWalletCollateral = async (): Promise<UTxO | undefined> => {
    if (this.wallet) {
      const utxos = await this.wallet.getCollateral();
      return utxos[0];
    }
    return undefined;
  };

  protected getWalletUtxosWithMinLovelace = async (
    lovelace: number,
    providedUtxos: UTxO[] = [],
  ) => {
    let utxos: UTxO[] = providedUtxos;
    if (this.wallet && (!providedUtxos || providedUtxos.length === 0)) {
      utxos = await this.wallet.getUtxos();
    }
    return utxos.filter((u) => {
      const lovelaceAmount = u.output.amount.find(
        (a: any) => a.unit === "lovelace",
      )?.quantity;
      return Number(lovelaceAmount) > lovelace;
    });
  };

  protected getWalletUtxosWithToken = async (
    assetHex: string,
    userUtxos: UTxO[] = [],
  ) => {
    let utxos: UTxO[] = userUtxos;
    if (this.wallet && userUtxos.length === 0) {
      utxos = await this.wallet.getUtxos();
    }
    return utxos.filter((u) => {
      const assetAmount = u.output.amount.find(
        (a: any) => a.unit === assetHex,
      )?.quantity;
      return Number(assetAmount) >= 1;
    });
  };

  protected getAddressUtxosWithMinLovelace = async (
    walletAddress: string,
    lovelace: number,
    providedUtxos: UTxO[] = [],
  ) => {
    let utxos: UTxO[] = providedUtxos;
    if (this.fetcher && (!providedUtxos || providedUtxos.length === 0)) {
      utxos = await this.fetcher.fetchAddressUTxOs(walletAddress);
    }
    return utxos.filter((u) => {
      const lovelaceAmount = u.output.amount.find(
        (a: any) => a.unit === "lovelace",
      )?.quantity;
      return Number(lovelaceAmount) > lovelace;
    });
  };

  protected getAddressUtxosWithToken = async (
    walletAddress: string,
    assetHex: string,
    userUtxos: UTxO[] = [],
  ) => {
    let utxos: UTxO[] = userUtxos;
    if (this.fetcher && userUtxos.length === 0) {
      utxos = await this.fetcher.fetchAddressUTxOs(walletAddress);
    }
    return utxos.filter((u) => {
      const assetAmount = u.output.amount.find(
        (a: any) => a.unit === assetHex,
      )?.quantity;
      return Number(assetAmount) >= 1;
    });
  };

  protected getWalletInfoForTx = async () => {
    const utxos = await this.wallet?.getUtxos();
    const collateral = await this.getWalletCollateral();
    const walletAddress = await this.getWalletDappAddress();
    if (!utxos || utxos?.length === 0) {
      throw new Error("No utxos found");
    }
    if (!collateral) {
      throw new Error("No collateral found");
    }
    if (!walletAddress) {
      throw new Error("No wallet address found");
    }
    const MAX_UTXOS = 20;
    const trimmedUtxos =
      utxos.length > MAX_UTXOS
        ? [...utxos]
            .sort((a, b) => {
              const aLovelace = BigInt(
                a.output.amount.find((amt) => amt.unit === "lovelace")?.quantity ??
                  "0",
              );
              const bLovelace = BigInt(
                b.output.amount.find((amt) => amt.unit === "lovelace")?.quantity ??
                  "0",
              );
              return aLovelace === bLovelace ? 0 : aLovelace > bLovelace ? -1 : 1;
            })
            .slice(0, MAX_UTXOS)
        : utxos;
    return { utxos: trimmedUtxos, collateral, walletAddress };
  };

  protected _getUtxoByTxHash = async (
    txHash: string,
    scriptCbor?: string,
  ): Promise<UTxO | undefined> => {
    if (this.fetcher) {
      const utxos = await this.fetcher?.fetchUTxOs(txHash);
      let scriptUtxo = utxos[0];

      if (scriptCbor) {
        const scriptAddr = serializePlutusScript(
          { code: scriptCbor, version: this.languageVersion },
          this.stakeCredential,
          this.networkId,
        ).address;
        scriptUtxo =
          utxos.filter((utxo) => utxo.output.address === scriptAddr)[0] ||
          utxos[0];
      }

      return scriptUtxo;
    }

    return undefined;
  };
}
