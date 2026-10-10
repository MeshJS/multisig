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
import { BotAccessError, botHasScope } from "@/lib/auth/botAccess";
import { buildMultisigWallet, buildWallet, getWalletType } from "@/utils/common";
import { getTxBuilder } from "@/utils/get-tx-builder";
import {
  buildStakingCertificateActions,
  type StakingActionApi,
} from "@/utils/stakingCertificates";
import { normalizePoolIdForDelegation } from "@/utils/normalizePoolId";
import { resolveWalletScriptAddress } from "@/lib/server/walletScriptAddress";
import { resolveUtxoRefsFromChain } from "@/lib/server/resolveUtxoRefsFromChain";
import { createPendingMultisigTransaction } from "@/lib/server/createPendingMultisigTransaction";
import type { DbWalletWithLegacy } from "@/types/wallet";

const ACTIONS: StakingActionApi[] = [
  "register",
  "deregister",
  "delegate",
  "register_and_delegate",
];

function isStakingActionApi(s: string): s is StakingActionApi {
  return (ACTIONS as string[]).includes(s);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/botStakeCertificate" })) {
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
    return res.status(401).json({ error: "Unauthorized - Missing or malformed Authorization header (expected: Bearer <token>)" });
  }

  const payload = verifyJwt(token);
  if (!payload) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }

  if (isBotJwt(payload) && !applyBotRateLimit(req, res, payload.botId)) {
    return;
  }

  // Scope gate before body validation: a scope-less bot gets a clean 403
  // instead of misleading 400s from payload shape checks.
  if (isBotJwt(payload) && !(await botHasScope(db, payload.botId, "multisig:sign"))) {
    return res.status(403).json({ error: "Insufficient scope: multisig:sign required" });
  }

  const body = req.body as {
    walletId?: string;
    address?: string;
    action?: string;
    poolId?: string;
    utxoRefs?: { txHash: string; outputIndex: number }[];
    description?: string;
  };

  const walletId = typeof body.walletId === "string" ? body.walletId : "";
  const address = typeof body.address === "string" ? body.address : "";
  const actionRaw = typeof body.action === "string" ? body.action : "";

  if (!walletId) {
    return res.status(400).json({ error: "Missing required field walletId" });
  }
  if (!address) {
    return res.status(400).json({ error: "Missing required field address" });
  }
  if (!isStakingActionApi(actionRaw)) {
    return res.status(400).json({
      error:
        "Invalid or missing action (expected register, deregister, delegate, register_and_delegate)",
    });
  }
  const action = actionRaw;

  if (
    (action === "delegate" || action === "register_and_delegate") &&
    (typeof body.poolId !== "string" || !body.poolId.trim())
  ) {
    return res.status(400).json({ error: "poolId is required for this action" });
  }

  try {
    await authorizeWalletSignerForV1Tx(payload, walletId, address);
  } catch (err) {
    if (err instanceof BotAccessError) {
      // Convention: 404 = unknown wallet, 403 = known but not permitted.
      return res.status(err.status).json({ error: err.message });
    }
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
  if (getWalletType(wallet) !== "sdk") {
    return res.status(400).json({
      error:
        "Stake certificates are only supported for SDK multisig wallets (legacy and Summon are not supported)",
    });
  }

  const mWallet = buildMultisigWallet(wallet);
  if (!mWallet?.stakingEnabled()) {
    return res.status(400).json({
      error: "Staking is not enabled for this wallet (payment/stake key counts)",
    });
  }

  const network = address.includes("test") ? 0 : 1;
  const appWallet = buildWallet(wallet, network);

  const rewardAddress = mWallet.getStakeAddress();
  const stakingScript = appWallet.stakeScriptCbor || mWallet.getStakingScript();
  if (!rewardAddress || !stakingScript) {
    return res.status(400).json({
      error: "Could not derive reward address or staking script for this wallet",
    });
  }

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

  let poolHex = "";
  if (action === "delegate" || action === "register_and_delegate") {
    try {
      poolHex = normalizePoolIdForDelegation(body.poolId!);
    } catch (e) {
      return res.status(400).json({
        error: e instanceof Error ? e.message : "Invalid poolId",
      });
    }
  }

  const txBuilder = await getTxBuilder(network);
  const spendScriptCbor = mWallet.getScript().scriptCbor || appWallet.scriptCbor;
  for (const utxo of utxos) {
    txBuilder.txIn(
      utxo.input.txHash,
      utxo.input.outputIndex,
      utxo.output.amount,
      utxo.output.address,
    );
    txBuilder.txInScript(spendScriptCbor);
  }

  const certActions = buildStakingCertificateActions({
    txBuilder,
    rewardAddress,
    stakingScript,
    poolHex,
  });
  certActions[action].execute();
  txBuilder.changeAddress(mWallet.getScript().address);

  let txHex: string;
  let txJson: unknown;
  try {
    txHex = await txBuilder.complete();
    txJson = txBuilder.meshTxBuilderBody;
  } catch (e) {
    console.error("botStakeCertificate complete error:", e);
    return res.status(500).json({
      error: e instanceof Error ? e.message : "Failed to build transaction",
    });
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : certActions[action].description;

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
    console.error("botStakeCertificate persist error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
