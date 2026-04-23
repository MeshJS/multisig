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
import { buildMultisigWallet, buildWallet, getWalletType } from "@/utils/common";
import { getTxBuilder } from "@/utils/get-tx-builder";
import { resolveWalletScriptAddress } from "@/lib/server/walletScriptAddress";
import { resolveUtxoRefsFromChain } from "@/lib/server/resolveUtxoRefsFromChain";
import { createPendingMultisigTransaction } from "@/lib/server/createPendingMultisigTransaction";
import { resolveDRepAnchorFromUrl } from "@/lib/server/resolveDRepAnchorFromUrl";
import type { DbWalletWithLegacy } from "@/types/wallet";
import type { Wallet as AppWallet } from "@/types/wallet";
import type { MultisigWallet } from "@/utils/multisigSDK";

type DRepAction = "register" | "retire";

function resolveDRepScripts(args: {
  multisigWallet: MultisigWallet | undefined;
  appWallet: AppWallet;
}): { dRepId: string; drepCbor: string; scriptCbor: string; changeAddress: string } | null {
  const { multisigWallet, appWallet } = args;
  if (multisigWallet) {
    const drepData = multisigWallet.getDRep(appWallet);
    if (!drepData) return null;
    const dRepId = drepData.dRepId;
    const drepCbor = drepData.drepCbor;
    const multisigScript = multisigWallet.getScript();
    const multisigScriptCbor = multisigScript.scriptCbor;
    const appScriptCbor = appWallet.scriptCbor;
    if (!multisigScriptCbor && !appScriptCbor) return null;
    const scriptCbor = multisigWallet.getKeysByRole(3)
      ? multisigScriptCbor || appScriptCbor!
      : appScriptCbor || multisigScriptCbor!;
    const changeAddress = multisigScript.address;
    return { dRepId, drepCbor, scriptCbor, changeAddress };
  }
  if (!appWallet.dRepId || !appWallet.scriptCbor) return null;
  return {
    dRepId: appWallet.dRepId,
    drepCbor: appWallet.scriptCbor,
    scriptCbor: appWallet.scriptCbor,
    changeAddress: appWallet.address,
  };
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/botDRepCertificate" })) {
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
    action?: string;
    utxoRefs?: { txHash: string; outputIndex: number }[];
    description?: string;
    anchorUrl?: string;
    anchorDataHash?: string;
  };

  const walletId = typeof body.walletId === "string" ? body.walletId : "";
  const address = typeof body.address === "string" ? body.address : "";
  const action = body.action as DRepAction | undefined;

  if (!walletId) {
    return res.status(400).json({ error: "Missing required field walletId" });
  }
  if (!address) {
    return res.status(400).json({ error: "Missing required field address" });
  }
  if (action !== "register" && action !== "retire") {
    return res.status(400).json({ error: "Invalid or missing action (register or retire)" });
  }

  try {
    await authorizeWalletSignerForV1Tx(payload, walletId, address);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "INSUFFICIENT_SCOPE") {
      return res.status(403).json({ error: (err as Error).message });
    }
    return res.status(403).json({
      error: err instanceof Error ? err.message : "Not authorized for this wallet",
    });
  }

  const walletRow = await db.wallet.findUnique({ where: { id: walletId } });
  if (!walletRow) {
    return res.status(404).json({ error: "Wallet not found" });
  }

  const wallet = walletRow as DbWalletWithLegacy;
  const wt = getWalletType(wallet);
  if (wt === "summon") {
    return res.status(400).json({
      error: "DRep certificates are not supported for Summon wallets in this API version",
    });
  }

  const network = address.includes("test") ? 0 : 1;
  const appWallet = buildWallet(wallet, network);
  const multisigWallet = buildMultisigWallet(wallet);

  const scripts = resolveDRepScripts({ multisigWallet, appWallet });
  if (!scripts) {
    return res.status(400).json({
      error: "DRep is not configured for this wallet (could not derive DRep id and scripts)",
    });
  }

  const { dRepId, drepCbor, scriptCbor, changeAddress } = scripts;

  let spendAddress: string;
  try {
    spendAddress = resolveWalletScriptAddress(wallet, address);
  } catch (e) {
    return res.status(500).json({
      error:
        e instanceof Error ? e.message : "Wallet script address resolution failed",
    });
  }

  const resolved = await resolveUtxoRefsFromChain({
    network,
    utxoRefs: body.utxoRefs ?? [],
    expectedSpendAddress: spendAddress,
  });
  if ("error" in resolved) {
    return res.status(resolved.status).json({ error: resolved.error });
  }
  const { utxos } = resolved;

  const txBuilder = getTxBuilder(network);

  if (action === "register") {
    const anchorUrl =
      typeof body.anchorUrl === "string" ? body.anchorUrl.trim() : "";
    if (!anchorUrl) {
      return res.status(400).json({ error: "anchorUrl is required for register" });
    }
    let resolvedAnchorUrl: string;
    let anchorDataHash: string;
    try {
      const r = await resolveDRepAnchorFromUrl(
        anchorUrl,
        typeof body.anchorDataHash === "string" ? body.anchorDataHash : undefined,
      );
      resolvedAnchorUrl = r.anchorUrl;
      anchorDataHash = r.anchorDataHash;
    } catch (e) {
      return res.status(400).json({
        error: e instanceof Error ? e.message : "Failed to resolve anchor",
      });
    }

    for (const utxo of utxos) {
      txBuilder.txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
      );
      txBuilder.txInScript(scriptCbor);
    }

    txBuilder
      .drepRegistrationCertificate(dRepId, {
        anchorUrl: resolvedAnchorUrl,
        anchorDataHash,
      })
      .certificateScript(drepCbor)
      .changeAddress(changeAddress);
  } else {
    for (const utxo of utxos) {
      txBuilder.txIn(
        utxo.input.txHash,
        utxo.input.outputIndex,
        utxo.output.amount,
        utxo.output.address,
      );
      txBuilder.txInScript(scriptCbor);
    }
    txBuilder
      .changeAddress(changeAddress)
      .drepDeregistrationCertificate(dRepId)
      .certificateScript(drepCbor);
  }

  let txHex: string;
  let txJson: unknown;
  try {
    txHex = await txBuilder.complete();
    txJson = txBuilder.meshTxBuilderBody;
  } catch (e) {
    console.error("botDRepCertificate complete error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to build transaction",
    });
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : action === "register"
        ? "DRep registration"
        : "DRep retirement";

  try {
    const newTx = await createPendingMultisigTransaction(db, {
      walletId,
      wallet: {
        numRequiredSigners: walletRow.numRequiredSigners,
        type: walletRow.type,
      },
      proposerAddress: address,
      txCbor: txHex,
      txJson,
      description,
      network,
    });
    return res.status(201).json(newTx);
  } catch (error) {
    console.error("botDRepCertificate persist error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
