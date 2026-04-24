import type { CIBootstrapContext, CIWalletType } from "../../framework/types";
import { requestJson } from "../../framework/http";
import { getBotForSignerIndex } from "../../framework/botContext";
import { authenticateBot } from "../../framework/botAuth";
import { stringifyRedacted } from "../../framework/redact";
import { parseMnemonic } from "../../framework/mnemonic";

/**
 * Signs a pending certificate transaction using BOTH the signer's payment key
 * (required for the spending native script) and, when available, their stake key
 * (required for the staking certificate native script).
 *
 * Both witnesses are submitted in a single signTransaction call so that the
 * address-already-signed guard is not hit on a second call.
 *
 * This is needed for botStakeCertificate transactions where the certificate
 * script is built from role-2 (stake) key hashes that differ from the payment
 * key hashes used by the spending script.
 */
export async function runStakeCertSigningFlow(args: {
  ctx: CIBootstrapContext;
  mnemonic: string;
  signerIndex?: number;
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
  submissionError?: string;
  stakeWitnessIncluded: boolean;
}> {
  const { ctx, mnemonic } = args;
  const signerIndex = args.signerIndex ?? 1;
  const shouldBroadcast = args.signBroadcast ?? true;
  const requireBroadcastSuccess = args.requireBroadcastSuccess ?? true;

  // Staking cert scenarios always target the SDK wallet.
  const targetWalletType: CIWalletType = "sdk";
  const selectedWallet = ctx.wallets.find((w) => w.type === targetWalletType);
  if (!selectedWallet) {
    throw new Error(`Unable to find wallet context for type ${targetWalletType}`);
  }

  const { bot: signerBot, signerAddress: signAddress } = getBotForSignerIndex({
    ctx,
    wallet: selectedWallet,
    signerIndex,
  });

  const [{ MeshWallet, resolvePaymentKeyHash, resolveStakeKeyHash }, { csl, calculateTxHash }] = await Promise.all([
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
      `Mnemonic does not derive signer address index ${signerIndex} from context`,
    );
  }

  const signerToken = await authenticateBot({ ctx, bot: signerBot });

  const pendingResponse = await requestJson<Array<{ id: string; txCbor?: string }> | { error?: string }>({
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
    throw new Error("No pending transactions to sign for sdk wallet");
  }

  const tx =
    pendingResponse.data.find((p) => p.id === args.preferredTransactionId) ??
    pendingResponse.data.find((p) => typeof p.txCbor === "string" && p.txCbor.length > 0);
  if (!tx?.txCbor) {
    throw new Error("Pending transactions exist but none include txCbor");
  }

  const signedPayloadHex = await signerWallet.signTx(tx.txCbor, true);

  // Parse the full vkey witness set from the signed payload.
  let vkeys: ReturnType<typeof csl.Vkeywitnesses.new> | null = null;
  try {
    const signedTx = csl.Transaction.from_hex(signedPayloadHex);
    vkeys = signedTx.witness_set().vkeys() ?? csl.Vkeywitnesses.new();
  } catch {
    const witnessSet = csl.TransactionWitnessSet.from_hex(signedPayloadHex);
    vkeys = witnessSet.vkeys() ?? csl.Vkeywitnesses.new();
  }
  if (!vkeys || vkeys.len() === 0) {
    throw new Error("No vkey witnesses found in signed payload");
  }

  // ── Extract payment key witness ──────────────────────────────────────────
  const paymentKeyHash = resolvePaymentKeyHash(signerAddress).toLowerCase();
  let paymentVkey: typeof vkeys extends { get: (i: number) => infer V } ? V : never;
  let foundPayment = false;
  for (let i = 0; i < vkeys.len(); i++) {
    const candidate = vkeys.get(i);
    const kh = Buffer.from(candidate.vkey().public_key().hash().to_bytes()).toString("hex").toLowerCase();
    if (kh === paymentKeyHash) {
      paymentVkey = candidate;
      foundPayment = true;
      break;
    }
  }
  if (!foundPayment) {
    // Fall back to first witness if payment key not found by hash match.
    paymentVkey = vkeys.get(0);
  }

  const keyHex = paymentVkey!.vkey().public_key().to_hex().toLowerCase();
  const signatureHex = paymentVkey!.signature().to_hex().toLowerCase();

  // ── Extract stake key witness ────────────────────────────────────────────
  // MeshWallet.signTx produces only payment key witnesses for native script
  // spending inputs. Staking certificate native scripts require role-2 (stake)
  // key witnesses, derived via BIP32 path m/1852'/1815'/0'/2/0 and signed
  // against the transaction hash — the same path used by bootstrap.ts.
  const signerStakeAddr = ctx.signerStakeAddresses[signerIndex];
  let stakeKeyHex: string | undefined;
  let stakeSignatureHex: string | undefined;

  if (signerStakeAddr) {
    try {
      const expectedStakeHash = resolveStakeKeyHash(signerStakeAddr).toLowerCase();

      // Primary: check if the regular signing already included the stake witness
      // (MeshWallet may sign with all required keys in some versions).
      for (let i = 0; i < vkeys.len(); i++) {
        const candidate = vkeys.get(i);
        const kh = Buffer.from(candidate.vkey().public_key().hash().to_bytes()).toString("hex").toLowerCase();
        if (kh === expectedStakeHash) {
          stakeKeyHex = candidate.vkey().public_key().to_hex().toLowerCase();
          stakeSignatureHex = candidate.signature().to_hex().toLowerCase();
          break;
        }
      }

      // Fallback: derive stake key directly from mnemonic via BIP32 and sign
      // the tx hash manually. This is reliable regardless of wallet version.
      if (!stakeKeyHex) {
        const { mnemonicToEntropy } = await import("bip39");
        const entropy = mnemonicToEntropy(parseMnemonic(mnemonic).join(" "));
        const rootKey = csl.Bip32PrivateKey.from_bip39_entropy(
          Buffer.from(entropy, "hex"),
          Buffer.from(""),
        );
        const stakeRawKey = rootKey
          .derive(2147483648 + 1852)
          .derive(2147483648 + 1815)
          .derive(2147483648 + 0)
          .derive(2)
          .derive(0)
          .to_raw_key();
        const stakePubKey = stakeRawKey.to_public();
        const derivedHash = Buffer.from(stakePubKey.hash().to_bytes()).toString("hex").toLowerCase();
        if (derivedHash === expectedStakeHash) {
          const txHashBytes = Buffer.from(calculateTxHash(tx.txCbor), "hex");
          stakeKeyHex = stakePubKey.to_hex().toLowerCase();
          stakeSignatureHex = Buffer.from(stakeRawKey.sign(txHashBytes).to_bytes()).toString("hex").toLowerCase();
        }
      }
    } catch {
      // Cannot produce stake witness — broadcast may fail without it
    }
  }

  const stakeWitnessIncluded = !!(stakeKeyHex && stakeSignatureHex);

  // ── Submit to signTransaction ────────────────────────────────────────────
  const signBody: Record<string, unknown> = {
    walletId: selectedWallet.walletId,
    transactionId: tx.id,
    address: signerAddress,
    signature: signatureHex,
    key: keyHex,
    broadcast: shouldBroadcast,
  };
  if (stakeWitnessIncluded) {
    signBody.stakeKey = stakeKeyHex;
    signBody.stakeSignature = stakeSignatureHex;
  }

  const signResponse = await requestJson<
    { submitted?: boolean; txHash?: string; error?: string; submissionError?: string }
  >({
    url: `${ctx.apiBaseUrl}/api/v1/signTransaction`,
    method: "POST",
    token: signerToken,
    body: signBody,
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
    submissionError: signResponse.data?.submissionError,
    stakeWitnessIncluded,
  };
}
