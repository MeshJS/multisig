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
import { loadActiveProxyForWallet } from "@/lib/server/proxyAccess";
import { resolveWalletScriptAddress } from "@/lib/server/walletScriptAddress";
import { resolveUtxoRefsFromChain } from "@/lib/server/resolveUtxoRefsFromChain";
import {
  requireAuthTokenUtxo,
  resolveCollateralRefFromChain,
  type UtxoRef,
} from "@/lib/server/proxyUtxos";
import { createPendingMultisigTransaction } from "@/lib/server/createPendingMultisigTransaction";
import { getTxBuilder } from "@/utils/get-tx-builder";
import {
  buildProxyVoteTx,
  deriveProxyScripts,
  type ProxyVoteInput,
} from "@/lib/server/proxyTxBuilders";
import { parseProposalId } from "@/lib/governance";
import type { DbWalletWithLegacy } from "@/types/wallet";

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

function validateVotes(votes: unknown): ProxyVoteInput[] | { error: string } {
  if (!Array.isArray(votes) || votes.length === 0) {
    return { error: "votes must be a non-empty array" };
  }

  const normalized: ProxyVoteInput[] = [];
  for (const vote of votes) {
    const candidate = vote as Partial<ProxyVoteInput>;
    const proposalId =
      typeof candidate.proposalId === "string" ? candidate.proposalId.trim() : "";
    if (!proposalId) {
      return { error: "Each vote requires proposalId" };
    }
    try {
      parseProposalId(proposalId);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Invalid proposalId",
      };
    }
    if (
      candidate.voteKind !== "Yes" &&
      candidate.voteKind !== "No" &&
      candidate.voteKind !== "Abstain"
    ) {
      return { error: "voteKind must be Yes, No, or Abstain" };
    }
    normalized.push({
      proposalId,
      voteKind: candidate.voteKind,
      metadata: candidate.metadata,
    });
  }

  return normalized;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  addCorsCacheBustingHeaders(res);

  if (!applyRateLimit(req, res, { keySuffix: "v1/proxyVote" })) {
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
    votes?: unknown;
    utxoRefs?: UtxoRef[];
    collateralRef?: UtxoRef;
    description?: string;
  };

  const walletId = typeof body.walletId === "string" ? body.walletId : "";
  const address = typeof body.address === "string" ? body.address : "";
  const proxyId = typeof body.proxyId === "string" ? body.proxyId : "";
  if (!walletId || !address || !proxyId) {
    return res.status(400).json({ error: "walletId, address, and proxyId are required" });
  }

  const votes = validateVotes(body.votes);
  if ("error" in votes) {
    return res.status(400).json({ error: votes.error });
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

  const authTokenUtxo = requireAuthTokenUtxo(
    resolvedWalletUtxos.utxos,
    proxy.authTokenId,
  );
  if ("error" in authTokenUtxo) {
    return res.status(authTokenUtxo.status).json({ error: authTokenUtxo.error });
  }

  const resolvedCollateral = await resolveCollateralRefFromChain({
    network,
    collateralRef: body.collateralRef,
  });
  if ("error" in resolvedCollateral) {
    return res.status(resolvedCollateral.status).json({ error: resolvedCollateral.error });
  }

  const txBuilder = getTxBuilder(network) as MeshTxBuilderWithBody;
  let details: { dRepId: string };
  try {
    details = buildProxyVoteTx({
      txBuilder,
      network,
      paramUtxo,
      walletUtxos: resolvedWalletUtxos.utxos,
      authTokenUtxo,
      collateral: resolvedCollateral.collateral,
      walletAddress,
      votes,
      multisigScriptCbor: walletRow.scriptCbor,
    });
  } catch (error) {
    return res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to build proxy vote",
    });
  }

  let txCbor: string;
  try {
    txCbor = await txBuilder.complete();
  } catch (error) {
    console.error("proxyVote complete error:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to build transaction",
    });
  }

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim()
      : "Proxy governance vote";

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
          kind: "proxyVote",
          proxyId,
          dRepId: details.dRepId,
          votes,
        },
      },
      description,
      network,
    });
    return res.status(201).json(transaction);
  } catch (error) {
    console.error("proxyVote persist error:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
