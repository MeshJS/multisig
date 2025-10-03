import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import type { Wallet as DbWallet } from "@prisma/client";
import type { NextApiRequest, NextApiResponse } from "next";
import { buildMultisigWallet } from "@/utils/common";
import { getProvider } from "@/utils/get-provider";
import { addressToNetwork } from "@/utils/multisigSDK";
import type { UTxO, NativeScript } from "@meshsdk/core";
import { resolvePaymentKeyHash, serializeNativeScript } from "@meshsdk/core";
import { db } from "@/server/db";
import { getBalance } from "@/utils/getBalance";

interface WalletBalance {
  walletId: string;
  walletName: string;
  address: string;
  balance: Record<string, string>;
  adaBalance: number;
  isArchived: boolean;
}

interface TVLResponse {
  totalValueLocked: {
    ada: number;
    assets: Record<string, string>;
  };
  walletCount: number;
  activeWalletCount: number;
  archivedWalletCount: number;
  walletBalances: WalletBalance[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<TVLResponse | { error: string }>,
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

  try {
    // Get ALL wallets from the database for TVL calculation
    const allWallets: DbWallet[] = await db.wallet.findMany();

    if (!allWallets || allWallets.length === 0) {
      return res.status(200).json({
        totalValueLocked: {
          ada: 0,
          assets: {},
        },
        walletCount: 0,
        activeWalletCount: 0,
        archivedWalletCount: 0,
        walletBalances: [],
      });
    }

    const walletBalances: WalletBalance[] = [];
    const totalAssets: Record<string, number> = {};
    let totalAdaBalance = 0;
    let activeWalletCount = 0;
    let archivedWalletCount = 0;

    // Process each wallet
    for (const wallet of allWallets) {
      try {
        // Determine network from signer addresses
        let network = 1; // Default to mainnet
        if (wallet.signersAddresses.length > 0) {
          const signerAddr = wallet.signersAddresses[0]!;
          network = addressToNetwork(signerAddr);
          console.log(`Network detection for wallet ${wallet.id}:`, {
            signerAddress: signerAddr,
            detectedNetwork: network,
            isTestnet: signerAddr.includes("test")
          });
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

        let walletAddress = paymentAddress;
        const stakeableAddress = mWallet.getScript().address;

        // Check if payment address is empty and use stakeable address if staking is enabled
        // We'll fetch UTxOs for both addresses to determine which one to use
        const blockchainProvider = getProvider(network);
        
        let paymentUtxos: UTxO[] = [];
        let stakeableUtxos: UTxO[] = [];
        
        try {
          paymentUtxos = await blockchainProvider.fetchAddressUTxOs(paymentAddress);
          stakeableUtxos = await blockchainProvider.fetchAddressUTxOs(stakeableAddress);
        } catch (utxoError) {
          console.error(`Failed to fetch UTxOs for wallet ${wallet.id}:`, utxoError);
          // Continue with empty UTxOs
        }

        const paymentAddrEmpty = paymentUtxos.length === 0;
        if (paymentAddrEmpty && mWallet.stakingEnabled()) {
          walletAddress = stakeableAddress;
        }

        console.log(`Processing wallet ${wallet.id}:`, {
          walletName: wallet.name,
          signerAddresses: wallet.signersAddresses,
          network,
          paymentAddress,
          stakeableAddress,
          selectedAddress: walletAddress,
          paymentUtxos: paymentUtxos.length,
          stakeableUtxos: stakeableUtxos.length,
        });

        // Use the UTxOs from the selected address
        let utxos: UTxO[] = walletAddress === stakeableAddress ? stakeableUtxos : paymentUtxos;
        
        // If we still have no UTxOs, try the other network as fallback
        if (utxos.length === 0) {
          const fallbackNetwork = network === 0 ? 1 : 0;
          try {
            const fallbackProvider = getProvider(fallbackNetwork);
            utxos = await fallbackProvider.fetchAddressUTxOs(walletAddress);
            console.log(`Successfully fetched ${utxos.length} UTxOs for wallet ${wallet.id} on fallback network ${fallbackNetwork}`);
          } catch (fallbackError) {
            console.error(`Failed to fetch UTxOs for wallet ${wallet.id} on fallback network ${fallbackNetwork}:`, fallbackError);
            // Continue with empty UTxOs - this wallet will show 0 balance
          }
        }
        
        // Get balance for this wallet
        const balance = getBalance(utxos);
        
        // Calculate ADA balance
        const adaBalance = balance.lovelace ? parseInt(balance.lovelace) / 1000000 : 0;
        const roundedAdaBalance = Math.round(adaBalance * 100) / 100;

        // Count wallet types
        if (wallet.isArchived) {
          archivedWalletCount++;
        } else {
          activeWalletCount++;
        }

        // Add to wallet balances
        walletBalances.push({
          walletId: wallet.id,
          walletName: wallet.name,
          address: walletAddress,
          balance,
          adaBalance: roundedAdaBalance,
          isArchived: wallet.isArchived,
        });

        // Aggregate total balances
        totalAdaBalance += roundedAdaBalance;
        
        // Aggregate all assets
        Object.entries(balance).forEach(([asset, amount]) => {
          const numericAmount = parseFloat(amount);
          if (totalAssets[asset]) {
            totalAssets[asset] += numericAmount;
          } else {
            totalAssets[asset] = numericAmount;
          }
        });

      } catch (error) {
        console.error(`Error processing wallet ${wallet.id}:`, error);
        // Continue with other wallets even if one fails
      }
    }

    // Convert total assets back to string format
    const totalAssetsString = Object.fromEntries(
      Object.entries(totalAssets).map(([key, value]) => [
        key,
        value.toString(),
      ]),
    );

    const response: TVLResponse = {
      totalValueLocked: {
        ada: Math.round(totalAdaBalance * 100) / 100,
        assets: totalAssetsString,
      },
      walletCount: allWallets.length,
      activeWalletCount,
      archivedWalletCount,
      walletBalances,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error in aggregatedBalances handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
}
