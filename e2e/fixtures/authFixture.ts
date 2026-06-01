// Phase 3: Authentication fixture.
// Extends walletFixture with two strategies for establishing a valid session:
//
//   authenticateAs(page, signerIndex)
//     Drives the real wallet-connect → nonce → signData → session-cookie flow
//     (Option B from the plan). Preferred for ring-transfer tests because it
//     exercises the same code path real users take. Skips the reconnect when the
//     signer index hasn't changed so a single-leg test only pays the auth cost once
//     per signer switch, not per page navigation.
//
//   authenticateDirect(page, signerIndex)
//     Fast path: injects the mesh_wallet_session cookie directly without touching
//     the UI. Requires CI_JWT_SECRET == the app's JWT_SECRET. Useful for tests
//     that need an authenticated context but are not testing the auth flow itself.

import { test as walletTest } from "./walletFixture";
import type { Page } from "@playwright/test";
import { loadContext } from "../helpers/contextLoader";
import {
  buildWalletSessionToken,
  WALLET_SESSION_COOKIE,
} from "../helpers/authSession";

type AuthFixtures = {
  authenticateAs: (page: Page, signerIndex: number) => Promise<void>;
  authenticateDirect: (page: Page, signerIndex: number) => Promise<void>;
};

export const test = walletTest.extend<AuthFixtures>({
  // Drives the real wallet-connect auth flow (Option B).
  // Calls injectWallet to update the mocked signer, then connectWallet to run
  // the full nonce → signData → POST /api/auth/wallet-session sequence.
  // The resulting HttpOnly cookie persists across subsequent page navigations
  // within the same Playwright browser context, so no re-auth is needed per page.
  authenticateAs: async ({ injectWallet, connectWallet }, use) => {
    let lastAuthenticatedIndex: number | null = null;

    await use(async (page: Page, signerIndex: number) => {
      // Always re-inject so the mocked wallet's addresses and mnemonic reflect
      // the current signer. The bridge functions close over mutable state, so
      // injectWallet does not need to register exposeFunction more than once.
      await injectWallet(page, signerIndex);

      // Skip the UI connect flow if we're still on the same signer — the session
      // cookie is still valid and the browser context carries it between navigations.
      if (lastAuthenticatedIndex !== signerIndex) {
        await connectWallet(page);
        lastAuthenticatedIndex = signerIndex;
      }
    });
  },

  // Fast path: injects mesh_wallet_session cookie without any UI interaction.
  // CI_JWT_SECRET must be set and must equal the app's JWT_SECRET.
  authenticateDirect: async ({ injectWallet }, use) => {
    await use(async (page: Page, signerIndex: number) => {
      const jwtSecret = process.env.CI_JWT_SECRET;
      if (!jwtSecret) {
        throw new Error(
          "CI_JWT_SECRET must be set to use authenticateDirect(). " +
            "Use authenticateAs() to drive the real connect flow instead.",
        );
      }

      const ctx = loadContext();
      const signerAddress = ctx.signerAddresses[signerIndex];
      if (!signerAddress) {
        throw new Error(
          `No signer address at index ${signerIndex} in bootstrap context`,
        );
      }

      // Inject the CIP-0030 wallet mock so the UI can interact with wallet APIs
      // even though we're skipping the connect modal.
      await injectWallet(page, signerIndex);

      const token = buildWalletSessionToken(signerAddress, jwtSecret);
      const appUrl = process.env.APP_URL ?? "http://localhost:3000";
      await page.context().addCookies([
        {
          name: WALLET_SESSION_COOKIE,
          value: token,
          domain: new URL(appUrl).hostname,
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
          // 7 days, matching createWalletSessionToken in src/lib/auth/walletSession.ts
          expires: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
        },
      ]);
    });
  },
});

export { expect } from "@playwright/test";
