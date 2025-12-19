import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { csl, calculateTxHash } from "@meshsdk/core-csl";
import { resolvePaymentKeyHash } from "@meshsdk/core";
import { buildMultisigWallet } from "@/utils/common";
import { getProvider } from "@/utils/get-provider";
import { addressToNetwork } from "@/utils/multisigSDK";

import { createTRPCRouter, protectedProcedure } from "@/server/api/trpc";

function toHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

function normalizeHex(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/^0x/, "");
  if (trimmed.length === 0 || trimmed.length % 2 !== 0 || !/^[0-9a-f]+$/.test(trimmed)) {
    throw new Error("Invalid hex string");
  }
  return trimmed;
}

const getSessionAddresses = (ctx: any): string[] => {
  const sessionWallets: string[] = (ctx as any).sessionWallets ?? [];
  if (Array.isArray(sessionWallets) && sessionWallets.length > 0) {
    return sessionWallets;
  }
  const single = ctx.session?.user?.id ?? ctx.sessionAddress;
  return single ? [single] : [];
};

const assertWalletAccess = async (ctx: any, walletId: string) => {
  const wallet = await ctx.db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Wallet not found" });
  }

  const addresses = getSessionAddresses(ctx);
  if (addresses.length === 0) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const authorized = addresses.some((addr: string) => {
    const isSigner =
      Array.isArray(wallet.signersAddresses) && wallet.signersAddresses.includes(addr);
    const isOwner = wallet.ownerAddress === addr || wallet.ownerAddress === "all";
    return isSigner || isOwner;
  });

  if (!authorized) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Not authorized for this wallet" });
  }

  return wallet;
};

export const transactionRouter = createTRPCRouter({
  createTransaction: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        txJson: z.string().min(1),
        signedAddresses: z.array(z.string()),
        txCbor: z.string().min(1),
        state: z.number(),
        description: z.string().optional(),
        txHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      return ctx.db.transaction.create({
        data: {
          walletId: input.walletId,
          txJson: input.txJson,
          signedAddresses: input.signedAddresses,
          txCbor: input.txCbor,
          state: input.state,
          description: input.description,
          txHash: input.txHash,
        },
      });
    }),

  updateTransaction: protectedProcedure
    .input(
      z.object({
        transactionId: z.string(),
        signedAddresses: z.array(z.string()),
        rejectedAddresses: z.array(z.string()),
        txCbor: z.string().min(1),
        state: z.number(),
        txHash: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const tx = await ctx.db.transaction.findUnique({ where: { id: input.transactionId } });
      if (!tx) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
      }
      await assertWalletAccess(ctx, tx.walletId);
      return ctx.db.transaction.update({
        where: {
          id: input.transactionId,
        },
        data: {
          signedAddresses: input.signedAddresses,
          rejectedAddresses: input.rejectedAddresses,
          txCbor: input.txCbor,
          state: input.state,
          txHash: input.txHash,
        },
      });
    }),

  deleteTransaction: protectedProcedure
    .input(z.object({ transactionId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tx = await ctx.db.transaction.findUnique({ where: { id: input.transactionId } });
      if (!tx) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
      }
      await assertWalletAccess(ctx, tx.walletId);
      return ctx.db.transaction.delete({
        where: {
          id: input.transactionId,
        },
      });
    }),

  // Read-only queries require authenticated session whose address is a signer/owner
  getAllTransactions: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      return await ctx.db.transaction.findMany({
        where: {
          walletId: input.walletId,
          state: 1,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  getPendingTransactions: protectedProcedure
    .input(z.object({ walletId: z.string() }))
    .query(async ({ ctx, input }) => {
      await assertWalletAccess(ctx, input.walletId);
      return await ctx.db.transaction.findMany({
        where: {
          walletId: input.walletId,
          state: 0,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
    }),

  importTransaction: protectedProcedure
    .input(
      z.object({
        walletId: z.string(),
        txCbor: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const wallet = await assertWalletAccess(ctx, input.walletId);

      // Normalize and parse CBOR
      let txHex: string;
      try {
        txHex = normalizeHex(input.txCbor);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Invalid CBOR hex string",
        });
      }

      // Deserialize transaction
      let parsedTx: ReturnType<typeof csl.Transaction.from_hex>;
      try {
        parsedTx = csl.Transaction.from_hex(txHex);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Failed to deserialize transaction CBOR",
        });
      }

      // Extract witness set and verify signatures
      const witnessSet = parsedTx.witness_set();
      const vkeyWitnesses = witnessSet.vkeys();

      if (!vkeyWitnesses || vkeyWitnesses.len() === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Transaction has no signatures",
        });
      }

      // Get wallet signer keyhashes
      const walletSignerKeyHashes = new Set<string>();
      wallet.signersAddresses.forEach((addr: string) => {
        try {
          const keyHash = resolvePaymentKeyHash(addr).toLowerCase();
          walletSignerKeyHashes.add(keyHash);
        } catch {
          // Skip invalid addresses
        }
      });

      // Check if any signature matches wallet signers
      let hasValidSignature = false;
      const signedAddresses: string[] = [];
      const txHashHex = calculateTxHash(parsedTx.to_hex()).toLowerCase();
      const txHashBytes = Buffer.from(txHashHex, "hex");

      for (let i = 0; i < vkeyWitnesses.len(); i++) {
        const witness = vkeyWitnesses.get(i);
        const publicKey = witness.vkey().public_key();
        const signature = witness.signature();
        const keyHash = toHex(publicKey.hash().to_bytes()).toLowerCase();

        // Verify signature
        const isValid = publicKey.verify(txHashBytes, signature);
        if (!isValid) {
          continue; // Skip invalid signatures
        }

        // Check if keyhash matches any wallet signer
        if (walletSignerKeyHashes.has(keyHash)) {
          hasValidSignature = true;
          // Find the address that matches this keyhash
          const matchingAddress = wallet.signersAddresses.find((addr: string) => {
            try {
              return resolvePaymentKeyHash(addr).toLowerCase() === keyHash;
            } catch {
              return false;
            }
          });
          if (matchingAddress && !signedAddresses.includes(matchingAddress)) {
            signedAddresses.push(matchingAddress);
          }
        }
      }

      if (!hasValidSignature) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Transaction is not signed by any wallet signer",
        });
      }

      // Verify that the transaction uses the wallet's script
      // Get wallet script address
      const network = wallet.signersAddresses.length > 0
        ? addressToNetwork(wallet.signersAddresses[0]!)
        : 0; // Default to preprod/testnet
      
      const mWallet = buildMultisigWallet(wallet as any, network);
      if (!mWallet) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to build wallet script",
        });
      }
      
      const walletScriptAddress = mWallet.getScript().address;
      const blockchainProvider = getProvider(network);

      // Convert transaction body to txJson format
      const txBody = parsedTx.body();
      const inputs: any[] = [];
      const outputs: any[] = [];

      // Extract inputs and try to fetch UTXO data for amount information
      const txInputs = txBody.inputs();
      if (txInputs) {

        // Fetch UTXO data for all inputs in parallel
        const inputPromises = [];
        for (let i = 0; i < txInputs.len(); i++) {
          const input = txInputs.get(i);
          const txHash = toHex(input.transaction_id().to_bytes());
          const txIndex = input.index();

          // Try to fetch UTXO data from the source transaction
          inputPromises.push(
            blockchainProvider
              .get(`/txs/${txHash}/utxos`)
              .then((txUtxos: any) => {
                // Find the specific UTXO by index
                const utxo = txUtxos.outputs?.find(
                  (out: any) => out.output_index === txIndex
                );
                if (utxo) {
                  return {
                    txHash,
                    txIndex,
                    amount: utxo.amount || [],
                    address: utxo.address || "",
                  };
                }
                return { txHash, txIndex, amount: [], address: "" };
              })
              .catch(() => {
                // If fetch fails, return without amount data
                return { txHash, txIndex, amount: [], address: "" };
              })
          );
        }

        const inputData = await Promise.all(inputPromises);
        
        // Verify that at least one input is spending from wallet's script address
        const usesWalletScript = inputData.some(
          (data) => data.address === walletScriptAddress
        );

        if (!usesWalletScript) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Transaction does not use the wallet's script address",
          });
        }
        inputs.push(
          ...inputData.map((data) => ({
            txIn: {
              txHash: data.txHash,
              txIndex: data.txIndex,
              ...(data.amount.length > 0 && { amount: data.amount }),
              ...(data.address && { address: data.address }),
            },
          }))
        );
      }

      // Extract outputs
      const txOutputs = txBody.outputs();
      if (txOutputs) {
        for (let i = 0; i < txOutputs.len(); i++) {
          const output = txOutputs.get(i);
          const address = output.address().to_bech32();
          const amount = output.amount();
          const amountList: any[] = [];

          // Extract lovelace
          const coin = amount.coin();
          if (coin !== undefined && coin !== null) {
            // Handle BigNum conversion properly - CSL BigNum may be a number or object with to_str()
            let coinStr: string;
            try {
              const coinValue = coin as unknown;
              if (typeof coinValue === "number") {
                coinStr = coinValue.toString();
              } else if (typeof coinValue === "bigint") {
                coinStr = coinValue.toString();
              } else if (coinValue && typeof coinValue === "object") {
                // Try to_str() first (CSL BigNum method)
                if ("to_str" in coinValue && typeof (coinValue as any).to_str === "function") {
                  coinStr = (coinValue as any).to_str();
                } else if ("to_string" in coinValue && typeof (coinValue as any).to_string === "function") {
                  coinStr = (coinValue as any).to_string();
                } else {
                  coinStr = String(coinValue);
                }
              } else {
                coinStr = String(coinValue);
              }
              if (coinStr && coinStr !== "0" && coinStr !== "") {
                amountList.push({
                  unit: "lovelace",
                  quantity: coinStr,
                });
              }
            } catch (error) {
              console.warn("Failed to convert coin to string:", error);
            }
          }

          // Extract multiasset (native tokens)
          const multiasset = amount.multiasset();
          if (multiasset) {
            const keys = multiasset.keys();
            if (keys) {
              for (let j = 0; j < keys.len(); j++) {
                const policyId = keys.get(j);
                const assets = multiasset.get(policyId);
                if (assets) {
                  const assetNames = assets.keys();
                  if (assetNames) {
                    for (let k = 0; k < assetNames.len(); k++) {
                      const assetName = assetNames.get(k);
                      const quantity = assets.get(assetName);
                      if (quantity !== undefined && quantity !== null) {
                        const policyIdHex = toHex(policyId.to_bytes());
                        const assetNameHex = toHex(assetName.name());
                        const unit = policyIdHex + assetNameHex;
                        // Handle BigNum conversion properly
                        let quantityStr: string;
                        try {
                          const quantityValue = quantity as unknown;
                          if (typeof quantityValue === "number") {
                            quantityStr = quantityValue.toString();
                          } else if (typeof quantityValue === "bigint") {
                            quantityStr = quantityValue.toString();
                          } else if (quantityValue && typeof quantityValue === "object") {
                            // Try to_str() first (CSL BigNum method)
                            if ("to_str" in quantityValue && typeof (quantityValue as any).to_str === "function") {
                              quantityStr = (quantityValue as any).to_str();
                            } else if ("to_string" in quantityValue && typeof (quantityValue as any).to_string === "function") {
                              quantityStr = (quantityValue as any).to_string();
                            } else {
                              quantityStr = String(quantityValue);
                            }
                          } else {
                            quantityStr = String(quantityValue);
                          }
                          if (quantityStr && quantityStr !== "0" && quantityStr !== "") {
                            amountList.push({
                              unit: unit,
                              quantity: quantityStr,
                            });
                          }
                        } catch (error) {
                          console.warn("Failed to convert quantity to string:", error);
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          outputs.push({
            address: address,
            amount: amountList,
          });
        }
      }

      // Get change address (first output or fee payer)
      const changeAddress = outputs.length > 0 ? outputs[0]!.address : "";

      // Extract fee properly (handle BigNum)
      const fee = txBody.fee();
      let feeStr: string;
      try {
        const feeValue = fee as unknown;
        if (typeof feeValue === "number") {
          feeStr = feeValue.toString();
        } else if (typeof feeValue === "bigint") {
          feeStr = feeValue.toString();
        } else if (feeValue && typeof feeValue === "object") {
          // Try to_str() first (CSL BigNum method)
          if ("to_str" in feeValue && typeof (feeValue as any).to_str === "function") {
            feeStr = (feeValue as any).to_str();
          } else if ("to_string" in feeValue && typeof (feeValue as any).to_string === "function") {
            feeStr = (feeValue as any).to_string();
          } else {
            feeStr = String(feeValue);
          }
        } else {
          feeStr = String(feeValue);
        }
      } catch (error) {
        console.warn("Failed to convert fee to string:", error);
        feeStr = "0";
      }

      // Extract other optional fields
      const ttl = txBody.ttl();
      const validityStartInterval = txBody.validity_start_interval();

      // Build txJson
      const txJson = {
        inputs: inputs,
        outputs: outputs,
        changeAddress: changeAddress,
        fee: feeStr,
        ...(ttl && { ttl: ttl.toString() }),
        ...(validityStartInterval && { validityStartInterval: validityStartInterval.toString() }),
      };

      // Create pending transaction
      return await ctx.db.transaction.create({
        data: {
          walletId: input.walletId,
          txJson: JSON.stringify(txJson),
          txCbor: txHex,
          signedAddresses: signedAddresses,
          rejectedAddresses: [],
          state: 0,
          description: input.description || "Imported transaction",
        },
      });
    }),
});
