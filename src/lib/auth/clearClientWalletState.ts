/**
 * Remove browser-side traces of the last connected wallet so that, after
 * logout, nothing auto-reconnects and the user has to authorize again.
 * Mesh persists the connected wallet under `mesh-wallet-persist`; the UTXOS
 * store persists its network id under `utxos-state`.
 */
export function clearClientWalletState() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("mesh-wallet-persist");
    localStorage.removeItem("utxos-state");
  } catch (error) {
    console.error("[Logout] Failed to clear persisted wallet state:", error);
  }
}
