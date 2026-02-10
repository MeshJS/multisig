import { MeshTxBuilder, MeshWallet } from "@meshsdk/core";
import { env } from "@/env";
import { getTestAgentProvider, type ProviderHint } from "./provider";
import { loadOrCreateMnemonics } from "./keys";
import { fetchAddressUtxos } from "./utxos";

type FaucetRequest = {
  address: string;
  amountLovelace: number;
  networkId: number;
};

type FaucetResult = {
  txHash: string;
  amountLovelace: number;
};

class FaucetError extends Error {
  details?: Record<string, unknown>;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "FaucetError";
    this.details = details;
  }
}

const getNumberEnv = (value: number | undefined, fallback: number) =>
  typeof value === "number" && !Number.isNaN(value) ? value : fallback;

const buildWalletAdapterAddress = async (wallet: any): Promise<string> => {
  if (typeof wallet.getChangeAddress === "function") {
    return wallet.getChangeAddress();
  }
  if (typeof wallet.getUsedAddresses === "function") {
    const used = await wallet.getUsedAddresses();
    if (used && used.length > 0) return used[0];
  }
  if (typeof wallet.getUnusedAddresses === "function") {
    const unused = await wallet.getUnusedAddresses();
    if (unused && unused.length > 0) return unused[0];
  }
  throw new Error("Unable to resolve faucet wallet address");
};

const toMnemonicWords = (mnemonic: string) =>
  mnemonic
    .split(" ")
    .map((word) => word.trim())
    .filter(Boolean);

export const sendFaucetFunds = async (
  {
    address,
    amountLovelace,
    networkId,
  }: FaucetRequest,
  providerHint?: ProviderHint,
): Promise<FaucetResult> => {
  if (networkId === 1) {
    throw new FaucetError("Faucet is disabled for mainnet", { networkId });
  }

  const { faucetMnemonic } = loadOrCreateMnemonics();

  const maxSend = getNumberEnv(env.FAUCET_MAX_SEND_LOVELACE, 50_000_000_000);
  const minBalance = getNumberEnv(env.FAUCET_MIN_BALANCE_LOVELACE, 50_000_000);

  if (amountLovelace <= 0) {
    throw new FaucetError("Faucet amount must be positive", { amountLovelace });
  }

  if (amountLovelace > maxSend) {
    throw new FaucetError(
      `Requested amount exceeds faucet cap (${amountLovelace} > ${maxSend})`,
      { amountLovelace, maxSend },
    );
  }

  const provider = getTestAgentProvider(networkId, providerHint);
  const providerName = provider?.constructor?.name ?? "UnknownProvider";
  const evaluator =
    typeof (provider as { evaluateTx?: unknown })?.evaluateTx === "function"
      ? provider
      : undefined;
  const faucetWallet: any = new MeshWallet({
    networkId,
    fetcher: provider,
    submitter: provider,
    evaluator: provider,
    key: {
      type: "mnemonic",
      words: toMnemonicWords(faucetMnemonic),
    },
  } as any);

  const changeAddress = await buildWalletAdapterAddress(faucetWallet);
  const maxAttempts = 3;
  const ignoredInputs = new Set<string>();

  const parseBadInput = (message: string) => {
    const txMatch = message.match(
      /SafeHash\\s+\\\\*"?([0-9a-fA-F]+)\\\\*"?/,
    );
    const ixMatch = message.match(/TxIx\\s+\\{unTxIx\\s+=\\s+(\\d+)\\}/);
    if (!txMatch || !ixMatch) return null;
    return `${txMatch[1]}#${ixMatch[1]}`;
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const utxos = await fetchAddressUtxos({
      address: changeAddress,
      provider,
      providerHint,
    });
    if (!utxos || utxos.length === 0) {
      throw new FaucetError(
        `Faucet wallet has no UTxOs (address: ${changeAddress}, provider: ${providerName}, networkId: ${networkId})`,
        {
          faucetAddress: changeAddress,
          networkId,
          provider: providerName,
          utxoCount: 0,
        },
      );
    }

    const filteredUtxos = utxos.filter((utxo: any) => {
      const key = `${utxo?.input?.txHash ?? ""}#${utxo?.input?.outputIndex ?? ""}`;
      return !ignoredInputs.has(key);
    });

    const totalLovelace = filteredUtxos.reduce((sum: bigint, utxo: any) => {
      const lovelace = utxo.output?.amount?.find((a: any) => a.unit === "lovelace");
      return sum + BigInt(lovelace?.quantity || "0");
    }, 0n);

    if (totalLovelace - BigInt(amountLovelace) < BigInt(minBalance)) {
      throw new FaucetError("Faucet balance too low to fulfill request", {
        faucetAddress: changeAddress,
        networkId,
        provider: providerName,
        totalLovelace: totalLovelace.toString(),
        minBalance,
        amountLovelace,
      });
    }

    try {
      const sorted = [...filteredUtxos].sort((a: any, b: any) => {
        const aLov = a.output?.amount?.find((asset: any) => asset.unit === "lovelace");
        const bLov = b.output?.amount?.find((asset: any) => asset.unit === "lovelace");
        const aVal = BigInt(aLov?.quantity || "0");
        const bVal = BigInt(bLov?.quantity || "0");
        return aVal === bVal ? 0 : aVal > bVal ? -1 : 1;
      });
      const feeBuffer = 2_000_000n;
      const required = BigInt(amountLovelace) + BigInt(minBalance) + feeBuffer;
      let selectedTotal = 0n;
      const selectedUtxos: any[] = [];
      for (const utxo of sorted) {
        if (selectedTotal >= required) break;
        const lovelace = utxo.output?.amount?.find((asset: any) => asset.unit === "lovelace");
        const value = BigInt(lovelace?.quantity || "0");
        selectedUtxos.push(utxo);
        selectedTotal += value;
      }
      const utxosToUse = selectedUtxos.length > 0 ? selectedUtxos : filteredUtxos;

      const txBuilder = new MeshTxBuilder({
        fetcher: provider,
        evaluator,
        submitter: provider,
        verbose: true,
      });

      txBuilder.setNetwork(networkId === 1 ? "mainnet" : "preprod");

      const unsignedTx = await txBuilder
        .txOut(address, [{ unit: "lovelace", quantity: amountLovelace.toString() }])
        .changeAddress(changeAddress)
        .selectUtxosFrom(utxosToUse)
        .complete();

      const signedTx = await faucetWallet.signTx(unsignedTx, true);
      const txHash = await faucetWallet.submitTx(signedTx);

      return { txHash, amountLovelace };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const badInput = parseBadInput(message);
      if (badInput) {
        ignoredInputs.add(badInput);
      }
      if (attempt >= maxAttempts) {
        throw new FaucetError("Faucet submit failed", {
          attempt,
          maxAttempts,
          message,
          badInput: badInput ?? undefined,
          ignoredInputs: Array.from(ignoredInputs),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  throw new FaucetError("Faucet submit failed", {
    attempt: maxAttempts,
    maxAttempts,
  });
};
