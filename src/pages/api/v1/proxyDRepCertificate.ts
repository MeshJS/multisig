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
  loadBlockedUtxoRefsForWallet,
  resolveCollateralRefFromChain,
  type UtxoRef,
} from "@/lib/server/proxyUtxos";
import { selectAuthTokenUtxo } from "@/lib/proxy/utxoUtils";
import { createPendingMultisigTransaction } from "@/lib/server/createPendingMultisigTransaction";
import { completeTxWithFreshCostModels } from "@/lib/server/completeTxWithFreshCostModels";
import { getTxBuilder } from "@/utils/get-tx-builder";
import {
  buildProxyDRepCertificateTx,
  deriveProxyScripts,
} from "@/lib/server/proxyTxBuilders";
import type { DbWalletWithLegacy } from "@/types/wallet";

type ProxyDRepAction = "register" | "update" | "deregister";
type MeshTxBuilderWithBody = ReturnType<typeof getTxBuilder> & {
  meshTxBuilderBody: unknown;
};

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

function isProxyDRepAction(action: string): action is ProxyDRepAction {
  return action === "register" || action === "update" || action === "deregister";
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/proxyDRepCertificate" })) {
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
    action?: string;
    utxoRefs?: UtxoRef[];
    collateralRef?: UtxoRef;
    anchorUrl?: string;
    anchorJson?: unknown;
    description?: string;
  };

  const walletId = typeof body.walletId === "string" ? body.walletId : "";
  const address = typeof body.address === "string" ? body.address : "";
  const proxyId = typeof body.proxyId === "string" ? body.proxyId : "";
  const actionRaw = typeof body.action === "string" ? body.action : "";
  if (!walletId || !address || !proxyId) {
    return res.status(400).json({ error: "walletId, address, and proxyId are required" });
  }
  if (!isProxyDRepAction(actionRaw)) {
    return res.status(400).json({ error: "Invalid or missing action (register, update, deregister)" });
  }
  const action = actionRaw;

  const anchorUrl = typeof body.anchorUrl === "string" ? body.anchorUrl.trim() : "";
  const anchorJson =
    body.anchorJson && typeof body.anchorJson === "object" && !Array.isArray(body.anchorJson)
      ? (body.anchorJson as object)
      : undefined;
  if ((action === "register" || action === "update") && (!anchorUrl || !anchorJson)) {
    return res.status(400).json({ error: "anchorUrl and anchorJson are required for register and update" });
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

  const blockedRefs = await loadBlockedUtxoRefsForWallet(db, walletId);
  let authTokenUtxo: UTxO;
  try {
    authTokenUtxo = selectAuthTokenUtxo(resolvedWalletUtxos.utxos, proxy.authTokenId, blockedRefs);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "No free auth token UTxO" });
  }

  const resolvedCollateral = await resolveCollateralRefFromChain({
    network,
    collateralRef: body.collateralRef,
    expectedAddress: address,
  });
  if ("error" in resolvedCollateral) {
    return res.status(resolvedCollateral.status).json({ error: resolvedCollateral.error });
  }

  const txBuilder = getTxBuilder(network, true) as MeshTxBuilderWithBody;
  let details: { dRepId: string; anchorDataHash?: string };
  try {
    details = buildProxyDRepCertificateTx({
      txBuilder,
      network,
      paramUtxo,
      walletUtxos: resolvedWalletUtxos.utxos,
      authTokenUtxo,
      collateral: resolvedCollateral.collateral,
      walletAddress,
      action,
      anchorUrl,
      anchorJson,
      multisigScriptCbor: walletRow.scriptCbor,
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to build proxy DRep certificate",
    });
  }

  let txCbor: string;
  try {
    txCbor = await completeTxWithFreshCostModels(txBuilder, network);
  } catch (error) {
    console.error("proxyDRepCertificate complete error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to build transaction",
    });
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : `Proxy DRep ${action}`;

  try {
    const transaction = await createPendingMultisigTransaction(db, {
      walletId,
      wallet: {
        numRequiredSigners: walletRow.numRequiredSigners,
        type: walletRow.type,
      },
      proposerAddress: address,
      txCbor,
      txJson: {
        ...(typeof txBuilder.meshTxBuilderBody === "object" &&
        txBuilder.meshTxBuilderBody !== null
          ? (txBuilder.meshTxBuilderBody as Record<string, unknown>)
          : {}),
        proxyBot: {
          kind: "proxyDRepCertificate",
          proxyId,
          action,
          dRepId: details.dRepId,
          anchorDataHash: details.anchorDataHash,
        },
      },
      description,
      network,
      initialSignedAddresses: [],
    });
    return res.status(201).json(transaction);
  } catch (error) {
    console.error("proxyDRepCertificate persist error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
