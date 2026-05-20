import type { NextApiRequest, NextApiResponse } from "next";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import {
  applyRateLimit,
  applyBotRateLimit,
  enforceBodySize,
} from "@/lib/security/requestGuards";
import { authorizeWalletSignerForV1Tx } from "@/lib/server/v1WalletAuth";
import { resolveWalletScriptAddress } from "@/lib/server/walletScriptAddress";
import { resolveUtxoRefsFromChain } from "@/lib/server/resolveUtxoRefsFromChain";
import { resolveCollateralRefFromChain, type UtxoRef } from "@/lib/server/proxyUtxos";
import { createPendingMultisigTransaction } from "@/lib/server/createPendingMultisigTransaction";
import { completeTxWithFreshCostModels } from "@/lib/server/completeTxWithFreshCostModels";
import { getTxBuilder } from "@/utils/get-tx-builder";
import {
  buildProxySetupTx,
  DEFAULT_PROXY_SETUP_LOVELACE,
} from "@/lib/server/proxyTxBuilders";
import type { DbWalletWithLegacy } from "@/types/wallet";

type MeshTxBuilderWithBody = ReturnType<typeof getTxBuilder> & {
  meshTxBuilderBody: unknown;
};

function validateInitialProxyLovelace(
  value: unknown,
): string | { error: string } | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const initialProxyLovelace = typeof value === "string" ? value.trim() : "";
  if (!/^[0-9]+$/.test(initialProxyLovelace)) {
    return { error: "initialProxyLovelace must be a positive integer string" };
  }

  const lovelace = BigInt(initialProxyLovelace);
  if (lovelace <= BigInt(0)) {
    return { error: "initialProxyLovelace must be a positive integer string" };
  }
  if (lovelace < BigInt(DEFAULT_PROXY_SETUP_LOVELACE)) {
    return {
      error: `initialProxyLovelace must be at least ${DEFAULT_PROXY_SETUP_LOVELACE}`,
    };
  }

  return initialProxyLovelace;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/proxySetup" })) {
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
    utxoRefs?: UtxoRef[];
    collateralRef?: UtxoRef;
    initialProxyLovelace?: string;
    description?: string;
  };

  const walletId = typeof body.walletId === "string" ? body.walletId : "";
  const address = typeof body.address === "string" ? body.address : "";
  if (!walletId) {
    return res.status(400).json({ error: "Missing required field walletId" });
  }
  if (!address) {
    return res.status(400).json({ error: "Missing required field address" });
  }

  const initialProxyLovelace = validateInitialProxyLovelace(
    body.initialProxyLovelace,
  );
  if (initialProxyLovelace && typeof initialProxyLovelace !== "string") {
    return res.status(400).json({ error: initialProxyLovelace.error });
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

  const wallet = walletRow as DbWalletWithLegacy;
  const network = address.includes("test") ? 0 : 1;

  let walletAddress: string;
  try {
    walletAddress = resolveWalletScriptAddress(wallet, address);
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
    return res
      .status(resolvedWalletUtxos.status)
      .json({ error: resolvedWalletUtxos.error });
  }

  const resolvedCollateral = await resolveCollateralRefFromChain({
    network,
    collateralRef: body.collateralRef,
    expectedAddress: address,
  });
  if ("error" in resolvedCollateral) {
    return res
      .status(resolvedCollateral.status)
      .json({ error: resolvedCollateral.error });
  }

  const txBuilder = getTxBuilder(network, true) as MeshTxBuilderWithBody;
  let setup;
  try {
    setup = buildProxySetupTx({
      txBuilder,
      network,
      walletUtxos: resolvedWalletUtxos.utxos,
      walletAddress,
      collateral: resolvedCollateral.collateral,
      multisigScriptCbor: walletRow.scriptCbor,
      initialProxyLovelace,
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to build proxy setup",
    });
  }

  let txCbor: string;
  try {
    txCbor = await completeTxWithFreshCostModels(txBuilder, network);
  } catch (error) {
    console.error("proxySetup complete error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to build transaction",
    });
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : "Proxy setup transaction";
  const txJson = {
    ...(typeof txBuilder.meshTxBuilderBody === "object" &&
    txBuilder.meshTxBuilderBody !== null
      ? (txBuilder.meshTxBuilderBody as Record<string, unknown>)
      : {}),
    proxyBot: {
      kind: "proxySetup",
      setup,
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
    return res.status(201).json({ transaction, setup });
  } catch (error) {
    console.error("proxySetup persist error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
