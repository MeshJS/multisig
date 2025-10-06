import { cors, addCorsCacheBustingHeaders } from "@/lib/cors";
import type { NextApiRequest, NextApiResponse } from "next";
import { buildMultisigWallet } from "@/utils/common";
import { getProvider } from "@/utils/get-provider";
import { resolvePaymentKeyHash, serializeNativeScript } from "@meshsdk/core";
import type { UTxO, NativeScript } from "@meshsdk/core";
import { getBalance } from "@/utils/getBalance";

interface WalletBalance {
  walletId: string;
  walletName: string;
  address: string;
  balance: Record<string, string>;
  adaBalance: number;
  isArchived: boolean;
}

interface BalanceResponse {
  walletBalance: WalletBalance;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<BalanceResponse | { error: string }>,
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

  const { walletId, walletName, signersAddresses, numRequiredSigners, type, stakeCredentialHash, isArchived, network, paymentAddress, stakeableAddress } = req.query;

  // Validate required parameters
  if (!walletId || !walletName || !signersAddresses || !numRequiredSigners || !type || !network || !paymentAddress || !stakeableAddress) {
    return res.status(400).json({ error: "Missing required parameters" });
  }

  try {
    const walletIdStr = walletId as string;
    const walletNameStr = walletName as string;
    const signersAddressesArray = JSON.parse(signersAddresses as string);
    const numRequiredSignersNum = parseInt(numRequiredSigners as string);
    const typeStr = type as string;
    const stakeCredentialHashStr = stakeCredentialHash as string;
    const isArchivedBool = isArchived === 'true';
    const networkNum = parseInt(network as string);
    const paymentAddressStr = paymentAddress as string;
    const stakeableAddressStr = stakeableAddress as string;

    // Build multisig wallet for address determination
    const walletData = {
      id: walletIdStr,
      name: walletNameStr,
      signersAddresses: signersAddressesArray,
      numRequiredSigners: numRequiredSignersNum,
      type: typeStr,
      stakeCredentialHash: stakeCredentialHashStr,
      isArchived: isArchivedBool,
      description: null,
      signersStakeKeys: [],
      signersDRepKeys: [],
      signersDescriptions: [],
      clarityApiKey: null,
      drepKey: null,
      scriptType: null,
      scriptCbor: "", // Required field for DbWallet type
      verified: [], // Required field for DbWallet type
    };

    const mWallet = buildMultisigWallet(walletData, networkNum);
    if (!mWallet) {
      return res.status(400).json({ error: "Failed to build multisig wallet" });
    }

    // Determine which address to use
    const blockchainProvider = getProvider(networkNum);
    
    let paymentUtxos: UTxO[] = [];
    let stakeableUtxos: UTxO[] = [];
    
    try {
      paymentUtxos = await blockchainProvider.fetchAddressUTxOs(paymentAddressStr);
      stakeableUtxos = await blockchainProvider.fetchAddressUTxOs(stakeableAddressStr);
    } catch (utxoError) {
      console.error(`Failed to fetch UTxOs for wallet ${walletIdStr}:`, utxoError);
      // Continue with empty UTxOs
    }

    const paymentAddrEmpty = paymentUtxos.length === 0;
    let walletAddress = paymentAddressStr;
    
    if (paymentAddrEmpty && mWallet.stakingEnabled()) {
      walletAddress = stakeableAddressStr;
    }

    // Use the UTxOs from the selected address
    let utxos: UTxO[] = walletAddress === stakeableAddressStr ? stakeableUtxos : paymentUtxos;
    
    // If we still have no UTxOs, try the other network as fallback
    if (utxos.length === 0) {
      const fallbackNetwork = networkNum === 0 ? 1 : 0;
      try {
        const fallbackProvider = getProvider(fallbackNetwork);
        utxos = await fallbackProvider.fetchAddressUTxOs(walletAddress);
        console.log(`Successfully fetched ${utxos.length} UTxOs for wallet ${walletIdStr} on fallback network ${fallbackNetwork}`);
      } catch (fallbackError) {
        console.error(`Failed to fetch UTxOs for wallet ${walletIdStr} on fallback network ${fallbackNetwork}:`, fallbackError);
        // Continue with empty UTxOs - this wallet will show 0 balance
      }
    }
    
    // Get balance for this wallet
    const balance = getBalance(utxos);
    
    // Calculate ADA balance
    const adaBalance = balance.lovelace ? parseInt(balance.lovelace) / 1000000 : 0;
    const roundedAdaBalance = Math.round(adaBalance * 100) / 100;

    const walletBalance: WalletBalance = {
      walletId: walletIdStr,
      walletName: walletNameStr,
      address: walletAddress,
      balance,
      adaBalance: roundedAdaBalance,
      isArchived: isArchivedBool,
    };

    const response: BalanceResponse = {
      walletBalance,
    };

    res.status(200).json(response);
  } catch (error) {
    console.error("Error in balance handler", {
      message: (error as Error)?.message,
      stack: (error as Error)?.stack,
    });
    res.status(500).json({ error: "Internal Server Error" });
  }
}
