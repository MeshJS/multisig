// Phase 3: Builds a signed mesh_wallet_session cookie token for direct injection.
// The app uses a custom wallet session system (not next-auth) backed by a JWT
// signed with JWT_SECRET. This helper creates a matching token so e2e tests can
// bypass the wallet-connect UI flow when testing non-auth paths.
//
// Requires CI_JWT_SECRET == the app's JWT_SECRET env var.

import { sign } from "jsonwebtoken";

export const WALLET_SESSION_COOKIE = "mesh_wallet_session";

export type WalletSessionPayload = {
  wallets: string[];
  primaryWallet?: string | null;
};

/**
 * Returns a signed JWT that the app accepts as a valid mesh_wallet_session cookie.
 * Inject it via page.context().addCookies() to authenticate without the UI flow.
 */
export function buildWalletSessionToken(
  address: string,
  jwtSecret: string,
): string {
  const payload: WalletSessionPayload = {
    wallets: [address],
    primaryWallet: address,
  };
  return sign(payload, jwtSecret, { expiresIn: "7d" });
}
