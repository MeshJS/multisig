import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import type { Wallet as DbWallet } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { buildMultisigWallet } from "@/utils/common";
import { addressToNetwork } from "@/utils/multisigSDK";
import { resolvePaymentKeyHash, serializeNativeScript } from "@meshsdk/core";
import { db } from "@/server/db";
import type { NativeScript } from "@meshsdk/core";

interface WalletInfo {
  walletId: string;
  walletName: string;
  signersAddresses: string[];
  numRequiredSigners: number;
  type: string;
  stakeCredentialHash: string | null;
  isArchived: boolean;
  network: number;
  paymentAddress: string;
  stakeableAddress: string;
}

interface WalletsResponse {
  wallets: WalletInfo[];
  walletCount: number;
  activeWalletCount: number;
  archivedWalletCount: number;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WalletsResponse | { error: string }>,
) {
  // Add cache-busting headers for CORS
  addCorsCacheBustingHeaders(res);
  
  await cors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  // Verify authentication for all requests
  const authToken = req.headers.authorization?.replace('Bearer ', '');
  const expectedToken = process.env.SNAPSHOT_AUTH_TOKEN;
  
  if (!expectedToken) {
    console.error('SNAPSHOT_AUTH_TOKEN environment variable not set');
    return res.status(500).json({ error: "Server configuration error" });
  }
  
  if (!authToken || authToken !== expectedToken) {
    console.warn('Unauthorized request attempt', {
      ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,
      userAgent: req.headers['user-agent'],
      authToken: authToken ? 'present' : 'missing',
      query: req.query
    });
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // Get ALL wallets from the database
    const allWallets: DbWallet[] = await db.wallet.findMany();

    if (!allWallets || allWallets.length === 0) {
      return res.status(200).json({
        wallets: [],
        walletCount: 0,
        activeWalletCount: 0,
        archivedWalletCount: 0,
      });
    }

    const wallets: WalletInfo[] = [];
    let activeWalletCount = 0;
    let archivedWalletCount = 0;

    // Process each wallet to extract wallet information
    for (const wallet of allWallets) {
      try {
        // Determine network from signer addresses
        let network = 1; // Default to mainnet
        if (wallet.signersAddresses.length > 0) {
          const signerAddr = wallet.signersAddresses[0]!;
          network = addressToNetwork(signerAddr);
        }
        
        const mWallet = buildMultisigWallet(wallet, network);
        if (!mWallet) {
          console.warn(`Failed to build multisig wallet for wallet ${wallet.id}`);
          continue;
        }

        // Use the same address logic as the frontend buildWallet function
        const nativeScript = {
          type: wallet.type ? wallet.type : "atLeast",
          scripts: wallet.signersAddresses.map((addr) => ({
            type: "sig",
            keyHash: resolvePaymentKeyHash(addr),
          })),
        };
        if (nativeScript.type == "atLeast") {
          //@ts-ignore
          nativeScript.required = wallet.numRequiredSigners!;
        }

        const paymentAddress = serializeNativeScript(
          nativeScript as NativeScript,
          wallet.stakeCredentialHash as undefined | string,
          network,
        ).address;

        const stakeableAddress = mWallet.getScript().address;

        // Count wallet types
        if (wallet.isArchived) {
          archivedWalletCount++;
        } else {
          activeWalletCount++;
        }

        wallets.push({
          walletId: wallet.id,
          walletName: wallet.name,
          signersAddresses: wallet.signersAddresses,
          numRequiredSigners: wallet.numRequiredSigners!,
          type: wallet.type || "atLeast",
          stakeCredentialHash: wallet.stakeCredentialHash,
          isArchived: wallet.isArchived,
          network,
          paymentAddress,
          stakeableAddress,
        });

      } catch (error) {
        console.error(`Error processing wallet ${wallet.id}:`, error);
        // Continue with other wallets even if one fails
      }
    }

    const response: WalletsResponse = {
      wallets,
      walletCount: allWallets.length,
      activeWalletCount,
      archivedWalletCount,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error in wallets handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
}
