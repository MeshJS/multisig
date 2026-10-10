/** Shareable invite URL for a NewWallet draft. */
export function inviteUrlFor(walletId: string): string {
  const origin =
    typeof window !== "undefined"
      ? window.location.origin
      : "https://multisig.meshjs.dev";
  return `${origin}/wallets/invite/${walletId}`;
}
