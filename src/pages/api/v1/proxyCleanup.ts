import type { NextApiRequest, NextApiResponse } from "next";
import type { UTxO } from "@meshsdk/core";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import {
  applyRateLimit,
  applyBotRateLimit,
  enforceBodySize,
} from "@/lib/security/requestGuards";
import { authorizeWalletSignerForV1Tx } from "@/lib/server/v1WalletAuth";
import { loadActiveProxyForWallet } from "@/lib/server/proxyAccess";
import { resolveWalletScriptAddress } from "@/lib/server/walletScriptAddress";
import { resolveUtxoRefsFromChain } from "@/lib/server/resolveUtxoRefsFromChain";
import {
  requireAuthTokenUtxo,
  resolveCollateralRefFromChain,
  resolveSingleUtxoRefFromChain,
  type UtxoRef,
} from "@/lib/server/proxyUtxos";
import { createPendingMultisigTransaction } from "@/lib/server/createPendingMultisigTransaction";
import { getProvider } from "@/utils/get-provider";
import { getTxBuilder } from "@/utils/get-tx-builder";
import {
  buildProxyCleanupSweepTx,
  buildProxyCleanupTx,
  deriveProxyScripts,
} from "@/lib/server/proxyTxBuilders";
import type { DbWalletWithLegacy } from "@/types/wallet";

type MeshTxBuilderWithBody = ReturnType<typeof getTxBuilder> & {
  meshTxBuilderBody: unknown;
};

type CleanupMetadata =
  | { phase: "sweep"; sweptProxyUtxos: string; preservedAuthTokens: string }
  | { phase: "burn"; burnedAuthTokens: string };

function parseParamUtxo(value: string): UtxoRef | null {
  try {
    const parsed = JSON.parse(value) as Partial<UtxoRef>;
    if (
      typeof parsed.txHash === "string" &&
      typeof parsed.outputIndex === "number" &&
      Number.isInteger(parsed.outputIndex)
    ) {
      return { txHash: parsed.txHash, outputIndex: parsed.outputIndex };
    }
  } catch {
    return null;
  }
  return null;
}

function refKey(ref: UtxoRef): string {
  return `${ref.txHash}:${ref.outputIndex}`;
}

async function resolveProxyCleanupUtxos(args: {
  network: number;
  proxyAddress: string;
  proxyUtxoRefs?: UtxoRef[];
}): Promise<{ utxos: UTxO[] } | { error: string; status: number }> {
  let visibleUtxos: UTxO[];
  try {
    visibleUtxos = await getProvider(args.network).fetchAddressUTxOs(args.proxyAddress);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Failed to fetch proxy UTxOs",
      status: 400,
    };
  }

  if (!Array.isArray(args.proxyUtxoRefs) || args.proxyUtxoRefs.length === 0) {
    return { utxos: visibleUtxos };
  }

  const visibleRefs = new Set(visibleUtxos.map((utxo) => refKey(utxo.input)));
  const requestedRefs = new Set(args.proxyUtxoRefs.map(refKey));
  for (const visibleRef of visibleRefs) {
    if (!requestedRefs.has(visibleRef)) {
      return {
        error: "proxyUtxoRefs must include every currently visible proxy UTxO for cleanup",
        status: 400,
      };
    }
  }

  const utxos: UTxO[] = [];
  for (const ref of args.proxyUtxoRefs) {
    const resolved = await resolveSingleUtxoRefFromChain({
      network: args.network,
      ref,
      expectedAddress: args.proxyAddress,
    });
    if ("error" in resolved) {
      return resolved;
    }
    utxos.push(resolved.utxo);
  }

  return { utxos };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/proxyCleanup" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }
  if (!enforceBodySize(req, res, 200 * 1024)) {
    return;
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized - Missing token" });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
  if (isBotJwt(payload) && !applyBotRateLimit(req, res, payload.botId)) {
    return;
  }

  const body = req.body as {
    walletId?: string;
    address?: string;
    proxyId?: string;
    utxoRefs?: UtxoRef[];
    proxyUtxoRefs?: UtxoRef[];
    collateralRef?: UtxoRef;
    deactivateProxy?: boolean;
    description?: string;
  };

  const walletId = typeof body.walletId === "string" ? body.walletId : "";
  const address = typeof body.address === "string" ? body.address : "";
  const proxyId = typeof body.proxyId === "string" ? body.proxyId : "";
  if (!walletId || !address || !proxyId) {
    return res.status(400).json({ error: "walletId, address, and proxyId are required" });
  }

  let walletRow;
  try {
    const authorized = await authorizeWalletSignerForV1Tx(payload, walletId, address);
    walletRow = authorized.wallet;
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "NOT_FOUND") {
      return res.status(404).json({ error: "Wallet not found" });
    }
    return res.status(403).json({
      error: error instanceof Error ? error.message : "Not authorized for this wallet",
    });
  }

  let proxy;
  try {
    proxy = await loadActiveProxyForWallet({ db, walletId, proxyId });
  } catch (error) {
    return res.status(404).json({
      error: error instanceof Error ? error.message : "Proxy not found",
    });
  }

  const paramUtxo = parseParamUtxo(proxy.paramUtxo);
  if (!paramUtxo) {
    return res.status(500).json({ error: "Stored proxy paramUtxo is invalid" });
  }

  const network = address.includes("test") ? 0 : 1;
  const scripts = deriveProxyScripts({ paramUtxo, network });
  if (scripts.authTokenId !== proxy.authTokenId || scripts.proxyAddress !== proxy.proxyAddress) {
    return res.status(409).json({ error: "Stored proxy metadata does not match derived scripts" });
  }

  let walletAddress: string;
  try {
    walletAddress = resolveWalletScriptAddress(walletRow as DbWalletWithLegacy, address);
  } catch (error) {
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : "Wallet script address resolution failed",
    });
  }

  const resolvedWalletUtxos = await resolveUtxoRefsFromChain({
    network,
    utxoRefs: body.utxoRefs ?? [],
    expectedSpendAddress: walletAddress,
  });
  if ("error" in resolvedWalletUtxos) {
    return res.status(resolvedWalletUtxos.status).json({ error: resolvedWalletUtxos.error });
  }

  const resolvedCollateral = await resolveCollateralRefFromChain({
    network,
    collateralRef: body.collateralRef,
    expectedAddress: address,
  });
  if ("error" in resolvedCollateral) {
    return res.status(resolvedCollateral.status).json({ error: resolvedCollateral.error });
  }

  const proxyUtxosResult = await resolveProxyCleanupUtxos({
    network,
    proxyAddress: proxy.proxyAddress,
    proxyUtxoRefs: body.proxyUtxoRefs,
  });
  if ("error" in proxyUtxosResult) {
    return res.status(proxyUtxosResult.status).json({ error: proxyUtxosResult.error });
  }

  const txBuilder = getTxBuilder(network) as MeshTxBuilderWithBody;
  let cleanup: CleanupMetadata;
  try {
    if (proxyUtxosResult.utxos.length > 0) {
      const authTokenUtxo = requireAuthTokenUtxo(
        resolvedWalletUtxos.utxos,
        proxy.authTokenId,
      );
      if ("error" in authTokenUtxo) {
        return res.status(authTokenUtxo.status).json({ error: authTokenUtxo.error });
      }
      cleanup = {
        phase: "sweep",
        ...buildProxyCleanupSweepTx({
          txBuilder,
          network,
          paramUtxo,
          proxyAddress: proxy.proxyAddress,
          proxyUtxos: proxyUtxosResult.utxos,
          walletUtxos: resolvedWalletUtxos.utxos,
          authTokenUtxo,
          collateral: resolvedCollateral.collateral,
          walletAddress,
          multisigScriptCbor: walletRow.scriptCbor,
        }),
      };
    } else {
      cleanup = {
        phase: "burn",
        ...buildProxyCleanupTx({
          txBuilder,
          network,
          paramUtxo,
          walletUtxos: resolvedWalletUtxos.utxos,
          collateral: resolvedCollateral.collateral,
          walletAddress,
          authTokenId: proxy.authTokenId,
          multisigScriptCbor: walletRow.scriptCbor,
        }),
      };
    }
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to build proxy cleanup",
    });
  }

  let txCbor: string;
  try {
    txCbor = await txBuilder.complete();
  } catch (error) {
    console.error("proxyCleanup complete error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to build transaction",
    });
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : "Proxy cleanup transaction";
  const txJson = {
    ...(typeof txBuilder.meshTxBuilderBody === "object" &&
    txBuilder.meshTxBuilderBody !== null
      ? (txBuilder.meshTxBuilderBody as Record<string, unknown>)
      : {}),
    proxyBot: {
      kind: "proxyCleanup",
      proxyId,
      cleanup,
      deactivateProxy: body.deactivateProxy !== false,
      description,
    },
  };

  try {
    const transaction = await createPendingMultisigTransaction(db, {
      walletId,
      wallet: {
        numRequiredSigners: walletRow.numRequiredSigners,
        type: walletRow.type,
      },
      proposerAddress: address,
      txCbor,
      txJson,
      description,
      network,
      initialSignedAddresses: [],
    });
    return res.status(201).json({ transaction, cleanup });
  } catch (error) {
    console.error("proxyCleanup persist error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
