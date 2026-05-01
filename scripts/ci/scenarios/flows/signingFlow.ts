import type { CIBootstrapContext, CIWalletType } from "../../framework/types";
import { requestJson } from "../../framework/http";
import { getBotForSignerIndex } from "../../framework/botContext";
import { authenticateBot } from "../../framework/botAuth";
import { stringifyRedacted } from "../../framework/redact";
import { parseMnemonic } from "../../framework/mnemonic";
import { normalizeWalletTypeFromLabel } from "../../framework/walletType";

export type PendingTransactionForSigning = { id: string; txCbor?: string };

// signTransaction mutates the pending tx before broadcast. Retrying a 502 can
// turn the useful submission error into a duplicate-signature 409.
export const SIGN_TRANSACTION_REQUEST_OPTIONS = {
  retries: 0,
} as const;

export function selectPendingTransactionForSigning(
  pendingTransactions: PendingTransactionForSigning[],
  preferredTransactionId?: string,
): PendingTransactionForSigning & { txCbor: string } {
  if (preferredTransactionId) {
    const tx = pendingTransactions.find((p) => p.id === preferredTransactionId);
    if (!tx) {
      throw new Error(`Preferred pending transaction ${preferredTransactionId} was not found`);
    }
    if (!tx.txCbor) {
      throw new Error(`Preferred pending transaction ${preferredTransactionId} does not include txCbor`);
    }
    return { ...tx, txCbor: tx.txCbor };
  }

  const tx = pendingTransactions.find((p) => typeof p.txCbor === "string" && p.txCbor.length > 0);
  if (!tx) {
    throw new Error("Pending transactions exist but none include txCbor");
  }
  const txCbor = tx.txCbor;
  if (!txCbor) {
    throw new Error("Pending transactions exist but none include txCbor");
  }
  return { ...tx, txCbor };
}

export async function runSigningFlow(args: {
  ctx: CIBootstrapContext;
  mnemonic: string;
  signWalletType?: string;
  signerIndex?: number;
  signerLabel?: string;
  signBroadcast?: boolean;
  preferredTransactionId?: string;
  requireBroadcastSuccess?: boolean;
}): Promise<{
  walletType: CIWalletType;
  walletId: string;
  transactionId: string;
  signerAddress: string;
  status: number;
  submitted?: boolean;
  txHash?: string;
}> {
  const { ctx, mnemonic } = args;
  const targetWalletType = normalizeWalletTypeFromLabel(args.signWalletType ?? "legacy");
  const signerIndex = args.signerIndex ?? 1;
  const signerLabel = args.signerLabel ?? `signer${signerIndex}`;
  const shouldBroadcast = args.signBroadcast ?? true;
  const requireBroadcastSuccess = args.requireBroadcastSuccess ?? true;

  const selectedWallet = ctx.wallets.find((w) => w.type === targetWalletType);
  if (!selectedWallet) {
    throw new Error(`Unable to find wallet context for type ${targetWalletType}`);
  }

  const { bot: signerBot, signerAddress: signAddress } = getBotForSignerIndex({
    ctx,
    wallet: selectedWallet,
    signerIndex,
  });

  const [{ MeshWallet, resolvePaymentKeyHash }, { csl }] = await Promise.all([
    import("@meshsdk/core"),
    import("@meshsdk/core-csl"),
  ]);
  const signerWallet = new MeshWallet({
    networkId: ctx.networkId,
    key: { type: "mnemonic", words: parseMnemonic(mnemonic) },
  });
  await signerWallet.init();
  const signerAddress = await signerWallet.getChangeAddress();
  if (signerAddress !== signAddress) {
    throw new Error(
      `${signerLabel} mnemonic does not derive signer address index ${signerIndex} from context`,
    );
  }

  const signerToken = await authenticateBot({ ctx, bot: signerBot });

  const pendingResponse = await requestJson<PendingTransactionForSigning[] | { error?: string }>({
    url: `${ctx.apiBaseUrl}/api/v1/pendingTransactions?walletId=${encodeURIComponent(selectedWallet.walletId)}&address=${encodeURIComponent(signerAddress)}`,
    method: "GET",
    token: signerToken,
  });
  if (pendingResponse.status !== 200 || !Array.isArray(pendingResponse.data)) {
    throw new Error(
      `pendingTransactions lookup failed (${pendingResponse.status}): ${stringifyRedacted(pendingResponse.data)}`,
    );
  }
  if (!pendingResponse.data.length) {
    throw new Error(`No pending transactions to sign for wallet type ${targetWalletType}`);
  }

  const tx = selectPendingTransactionForSigning(pendingResponse.data, args.preferredTransactionId);

  const signedPayloadHex = await signerWallet.signTx(tx.txCbor, true);

  let vkeys: any = null;
  try {
    const signedTx = csl.Transaction.from_hex(signedPayloadHex);
    vkeys = signedTx.witness_set().vkeys();
  } catch {
    const witnessSet = csl.TransactionWitnessSet.from_hex(signedPayloadHex);
    vkeys = witnessSet.vkeys();
  }

  if (!vkeys || vkeys.len() === 0) {
    throw new Error("No vkey witness found in signed payload");
  }

  const addressKeyHash = resolvePaymentKeyHash(signerAddress).toLowerCase();
  let selected = vkeys.get(0);
  for (let i = 0; i < vkeys.len(); i++) {
    const candidate = vkeys.get(i);
    const keyHash = Buffer.from(candidate.vkey().public_key().hash().to_bytes())
      .toString("hex")
      .toLowerCase();
    if (keyHash === addressKeyHash) {
      selected = candidate;
      break;
    }
  }

  const keyHex = selected.vkey().public_key().to_hex().toLowerCase();
  const signatureHex = selected.signature().to_hex().toLowerCase();
  const signResponse = await requestJson<
    { submitted?: boolean; txHash?: string; error?: string; submissionError?: string }
  >({
    url: `${ctx.apiBaseUrl}/api/v1/signTransaction`,
    method: "POST",
    token: signerToken,
    ...SIGN_TRANSACTION_REQUEST_OPTIONS,
    body: {
      walletId: selectedWallet.walletId,
      transactionId: tx.id,
      address: signerAddress,
      signature: signatureHex,
      key: keyHex,
      broadcast: shouldBroadcast,
    },
  });

  if (signResponse.status !== 200 && signResponse.status !== 502) {
    throw new Error(
      `signTransaction failed (${signResponse.status}): ${stringifyRedacted(signResponse.data)}`,
    );
  }
  if (requireBroadcastSuccess && signResponse.status === 502) {
    throw new Error(
      `signTransaction broadcast failed (${signResponse.status}): ${stringifyRedacted(signResponse.data)}`,
    );
  }

  return {
    walletType: selectedWallet.type,
    walletId: selectedWallet.walletId,
    transactionId: tx.id,
    signerAddress,
    status: signResponse.status,
    submitted: signResponse.data?.submitted,
    txHash: signResponse.data?.txHash,
  };
}
