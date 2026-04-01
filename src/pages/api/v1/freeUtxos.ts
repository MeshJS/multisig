import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
//get all utxos for wallet
//get all pending txs for the wallet
//remove all wallet input utxos found in pending txs from the whole pool of txs.
import type { Wallet as DbWallet } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { buildMultisigWallet } from "@/utils/common";
import { getProvider } from "@/utils/get-provider";
import { addressToNetwork } from "@/utils/multisigSDK";
import type { UTxO } from "@meshsdk/core";
import { serializeNativeScript } from "@meshsdk/core";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { verifyJwt, isBotJwt } from "@/lib/verifyJwt";
import { DbWalletWithLegacy } from "@/types/wallet";
import { applyRateLimit, applyBotRateLimit } from "@/lib/security/requestGuards";
import { getClientIP } from "@/lib/security/rateLimit";
import { assertBotWalletAccess, getBotWalletAccess } from "@/lib/auth/botAccess";
import {
  decodeNativeScriptFromCbor,
  decodedToNativeScript,
} from "@/utils/nativeScriptUtils";

function resolveWalletScriptAddress(
  wallet: DbWalletWithLegacy,
  fallbackAddress: string,
): string {
  const mWallet = buildMultisigWallet(wallet);
  if (mWallet) {
    return mWallet.getScript().address;
  }

  const canonicalScriptCbor = wallet.scriptCbor?.trim();
  if (!canonicalScriptCbor) {
    throw new Error("Wallet is missing canonical scriptCbor");
  }

  const decoded = decodeNativeScriptFromCbor(canonicalScriptCbor);
  const nativeScript = decodedToNativeScript(decoded);
  const signerAddress = wallet.signersAddresses.find(
    (candidate) => typeof candidate === "string" && candidate.trim().length > 0,
  );
  const network = addressToNetwork(signerAddress ?? fallbackAddress);
  return serializeNativeScript(
    nativeScript,
    wallet.stakeCredentialHash ?? undefined,
    network,
  ).address;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  if (!applyRateLimit(req, res, { keySuffix: "v1/freeUtxos" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
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

  const session = {
    user: { id: payload.address },
    expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  };

  const caller = createCaller({
    db,
    session,
    sessionAddress: payload.address,
    sessionWallets: [payload.address],
    primaryWallet: payload.address,
    ip: getClientIP(req),
  });

  const { walletId, address } = req.query;

  if (typeof address !== "string") {
    return res.status(400).json({ error: "Invalid address parameter" });
  }
  if (payload.address !== address) {
    return res.status(403).json({ error: "Address mismatch" });
  }
  if (typeof walletId !== "string") {
    return res.status(400).json({ error: "Invalid walletId parameter" });
  }

  try {
    let pendingTxsResult: Awaited<ReturnType<ReturnType<typeof createCaller>["transaction"]["getPendingTransactions"]>>;
    let walletFetch: DbWallet | null;

    if (isBotJwt(payload)) {
      const access = await getBotWalletAccess(db, walletId, payload.botId);
      if (!access.allowed) {
        return res.status(403).json({ error: "Not authorized for this wallet" });
      }
      pendingTxsResult = await db.transaction.findMany({
        where: { walletId, state: 0 },
      });
      const result = await assertBotWalletAccess(db, walletId, payload, false);
      walletFetch = result.wallet as DbWallet;
    } else {
      pendingTxsResult = await caller.transaction.getPendingTransactions({
        walletId,
      });
      if (!pendingTxsResult) {
        return res.status(500).json({ error: "Wallet could not fetch pending Txs" });
      }
      walletFetch = await caller.wallet.getWallet({
        walletId,
        address,
      });
    }

    if (!walletFetch) {
      return res.status(404).json({ error: "Wallet not found" });
    }
    let addr: string;
    try {
      addr = resolveWalletScriptAddress(
        walletFetch as DbWalletWithLegacy,
        address,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      return res.status(500).json({
        error: `Wallet script address resolution failed: ${message}`,
      });
    }
    const network = addressToNetwork(addr);

    const blockchainProvider = getProvider(network);

    // Use cached UTxO fetch to reduce Blockfrost API calls
    const { cachedFetchAddressUTxOs } = await import("@/utils/blockchain-cache");
    const utxos: UTxO[] = await cachedFetchAddressUTxOs(blockchainProvider, addr, network);

    const blockedUtxos: { hash: string; index: number }[] =
      pendingTxsResult.flatMap((m): { hash: string; index: number }[] => {
        try {
          const txJson: {
            inputs: { txIn: { txHash: string; txIndex: number } }[];
          } = JSON.parse(m.txJson);
          return txJson.inputs.map((n) => ({
            hash: n.txIn.txHash,
            index: n.txIn.txIndex,
          }));
        } catch (e) {
          console.error("Failed to parse txJson:", m.txJson, e);
          return [];
        }
      });

    const freeUtxos = utxos.filter(
      (utxo) =>
        !blockedUtxos.some(
          (bU) =>
            bU.hash === utxo.input.txHash &&
            bU.index === utxo.input.outputIndex,
        ),
    );

    // Set cache headers for CDN/edge caching
    res.setHeader(
      "Cache-Control",
      "public, s-maxage=30, stale-while-revalidate=60",
    );
    res.status(200).json(freeUtxos);
  } catch (error) {
    console.error("Error in freeUtxos handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
}
