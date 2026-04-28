import type { PrismaClient } from "@prisma/client";
import type { UTxO } from "@meshsdk/core";
import { getProvider } from "@/utils/get-provider";
import { hasAsset, type UtxoRef } from "@/lib/server/proxyUtxos";

export type ProxySetupMetadata = {
  proxyAddress: string;
  authTokenId: string;
  paramUtxo: UtxoRef;
  description?: string;
};

type AddressUtxoFetcher = {
  fetchAddressUTxOs: (address: string) => Promise<UTxO[]>;
};

function normalizeSetupMetadata(
  metadata: Partial<ProxySetupMetadata>,
): ProxySetupMetadata | { error: string; status: number } {
  const proxyAddress =
    typeof metadata.proxyAddress === "string" ? metadata.proxyAddress.trim() : "";
  const authTokenId =
    typeof metadata.authTokenId === "string" ? metadata.authTokenId.trim() : "";
  const paramUtxo = metadata.paramUtxo;
  const txHash =
    typeof paramUtxo?.txHash === "string" ? paramUtxo.txHash.trim() : "";
  const outputIndex =
    typeof paramUtxo?.outputIndex === "number" &&
    Number.isInteger(paramUtxo.outputIndex)
      ? paramUtxo.outputIndex
      : -1;

  if (!proxyAddress || !authTokenId || !txHash || outputIndex < 0) {
    return {
      error: "proxyAddress, authTokenId, and paramUtxo are required",
      status: 400,
    };
  }

  return {
    proxyAddress,
    authTokenId,
    paramUtxo: { txHash, outputIndex },
    description:
      typeof metadata.description === "string" && metadata.description.trim()
        ? metadata.description.trim()
        : undefined,
  };
}

export async function finalizeConfirmedProxySetup(args: {
  db: PrismaClient;
  network: number;
  walletId: string;
  walletAddress: string;
  setup: Partial<ProxySetupMetadata>;
  provider?: AddressUtxoFetcher;
}) {
  const setup = normalizeSetupMetadata(args.setup);
  if ("error" in setup) {
    return setup;
  }

  const provider = args.provider ?? getProvider(args.network);

  let walletUtxos: UTxO[];
  let proxyUtxos: UTxO[];
  try {
    [walletUtxos, proxyUtxos] = await Promise.all([
      provider.fetchAddressUTxOs(args.walletAddress),
      provider.fetchAddressUTxOs(setup.proxyAddress),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: `Unable to validate confirmed proxy setup from chain: ${message}`,
      status: 400,
    };
  }

  const authTokenAtWallet = walletUtxos.some((utxo) =>
    hasAsset(utxo, setup.authTokenId),
  );
  if (!authTokenAtWallet) {
    return {
      error:
        "Confirmed setup not found: auth token is not present at the multisig wallet address",
      status: 400,
    };
  }

  if (proxyUtxos.length === 0) {
    return {
      error: "Confirmed setup not found: proxy address has no on-chain UTxOs",
      status: 400,
    };
  }

  const existing = await args.db.proxy.findFirst({
    where: {
      walletId: args.walletId,
      proxyAddress: setup.proxyAddress,
      authTokenId: setup.authTokenId,
    },
  });

  if (existing) {
    if (!existing.isActive) {
      return args.db.proxy.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    }
    return existing;
  }

  return args.db.proxy.create({
    data: {
      walletId: args.walletId,
      proxyAddress: setup.proxyAddress,
      authTokenId: setup.authTokenId,
      paramUtxo: JSON.stringify(setup.paramUtxo),
      description: setup.description,
      isActive: true,
    },
  });
}
