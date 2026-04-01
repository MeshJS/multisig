import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import { NextApiRequest, NextApiResponse } from "next";
import { Wallet as DbWallet } from "@prisma/client";
import { buildMultisigWallet } from "@/utils/common";
import { verifyJwt } from "@/lib/verifyJwt";
import { createCaller } from "@/server/api/root";
import { db } from "@/server/db";
import { DbWalletWithLegacy } from "@/types/wallet";
import { applyRateLimit } from "@/lib/security/requestGuards";
import { getClientIP } from "@/lib/security/rateLimit";
import {
  decodeNativeScriptFromCbor,
  decodedToNativeScript,
} from "@/utils/nativeScriptUtils";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  if (!applyRateLimit(req, res, { keySuffix: "v1/nativeScript" })) {
    return;
  }

  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { walletId, address } = req.query;

  if (typeof address !== "string") {
    return res.status(400).json({ error: "Invalid address parameter" });
  }
  if (typeof walletId !== "string") {
    return res.status(400).json({ error: "Invalid walletId parameter" });
  }

  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Unauthorized - Missing token" });
    }

    const payload = verifyJwt(token);
    if (!payload) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }

    const session = {
      user: { id: payload.address },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };

    if (payload.address !== address) {
      return res.status(403).json({ error: "Address mismatch" });
    }

    const caller = createCaller({
      db,
      session,
      sessionAddress: payload.address,
      sessionWallets: [payload.address],
      primaryWallet: payload.address,
      ip: getClientIP(req),
    });
    const walletFetch: DbWallet | null = await caller.wallet.getWallet({ walletId, address });
    if (!walletFetch) {
      return res.status(404).json({ error: "Wallet not found" });
    }
    const dbWallet = walletFetch as DbWalletWithLegacy;
    const multisig = dbWallet.rawImportBodies?.multisig;
    const decodedScripts: Array<{ type: string; script: unknown }> = [];
    const addDecodedScript = (type: "payment" | "stake", scriptCbor?: string | null) => {
      const cbor = scriptCbor?.trim();
      if (!cbor) {
        return;
      }
      try {
        const decoded = decodeNativeScriptFromCbor(cbor);
        decodedScripts.push({ type, script: decodedToNativeScript(decoded) });
      } catch {
        // Fall through to other canonical sources/fallbacks.
      }
    };

    // Canonical source for the wallet payment script.
    addDecodedScript("payment", dbWallet.scriptCbor);
    if (decodedScripts.length === 0) {
      // Imported wallets can carry payment script in raw import body.
      addDecodedScript("payment", multisig?.payment_script);
    }
    addDecodedScript("stake", multisig?.stake_script);

    if (decodedScripts.length > 0) {
      res.setHeader(
        "Cache-Control",
        "private, max-age=300, stale-while-revalidate=600",
      );
      return res.status(200).json(decodedScripts);
    }

    const mWallet = buildMultisigWallet(dbWallet);
    if (!mWallet) {
      return res.status(500).json({
        error: "Wallet could not be constructed",
      });
    }

    const types = mWallet.getAvailableTypes();
    if (!types) {
      return res.status(500).json({ error: "Wallet could not be constructed" });
    }

    // Cache wallet scripts for 5 minutes (they don't change often)
    res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=600');
    return res.status(200).json(
      types.map((m) => ({
        type: m,
        script: mWallet.buildScript(m),
      })),
    );
  } catch (error) {
    console.error("Error fetching wallet IDs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
}
