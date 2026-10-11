/**
 * Browser-side gate in front of `wallet.signTx` for multisig transactions.
 *
 * The server audits proxy auth-token movements in `createTransaction`,
 * `updateTransaction` and v1 `signTransaction`, but the final signer in the UI
 * broadcasts to the chain *before* recording the signature, so a server refusal
 * at that point would be too late. Asking the server first closes that window.
 *
 * Fails closed: if the audit cannot be reached, the caller must not sign.
 */
export type PreSignProxyAuditOutcome =
  | { ok: true }
  | { ok: false; message: string };

export const PRE_SIGN_AUDIT_UNAVAILABLE =
  "Could not verify proxy auth-token safety for this transaction. Check your connection and try again; the transaction was not signed.";

export async function runPreSignProxyAudit(args: {
  fetchAudit: (input: { walletId: string; txCbor: string }) => Promise<{ error: string | null }>;
  walletId: string;
  txCbor: string;
}): Promise<PreSignProxyAuditOutcome> {
  let result: { error: string | null };
  try {
    result = await args.fetchAudit({ walletId: args.walletId, txCbor: args.txCbor });
  } catch (error) {
    console.error("preSignProxyAudit request failed", error);
    return { ok: false, message: PRE_SIGN_AUDIT_UNAVAILABLE };
  }
  if (result.error) return { ok: false, message: result.error };
  return { ok: true };
}
